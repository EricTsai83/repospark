"use node";

import { CodeLanguage, Daytona, type Sandbox } from '@daytona/sdk';
import { shouldReadFile, type RepositorySnapshot } from './lib/repoAnalysis';
import {
  DEFAULT_AUTO_STOP_MINUTES,
  DEFAULT_AUTO_ARCHIVE_MINUTES,
  DEFAULT_AUTO_DELETE_MINUTES,
  MAX_LISTED_FILES,
  MAX_TREE_DEPTH,
} from './lib/constants';

const DEFAULT_CPU_LIMIT = 2;
const DEFAULT_MEMORY_GIB = 4;
const DEFAULT_DISK_GIB = 10;

type CreateSandboxOptions = {
  repositoryKey: string;
  accessMode: 'public' | 'private';
  sourceAdapter: 'git_clone' | 'source_service';
};

export type SandboxProvisionResult = {
  remoteId: string;
  workDir: string;
  repoPath: string;
  cpuLimit: number;
  memoryLimitGiB: number;
  diskLimitGiB: number;
  autoStopIntervalMinutes: number;
  autoArchiveIntervalMinutes: number;
  autoDeleteIntervalMinutes: number;
  networkBlockAll: boolean;
  networkAllowList?: string;
};

export async function provisionSandbox(options: CreateSandboxOptions): Promise<SandboxProvisionResult> {
  const daytona = createDaytonaClient();
  const sandboxName = `architect-${safeLabel(options.repositoryKey)}`;

  // Clean up any pre-existing Daytona sandbox with the same name to avoid
  // "already exists" conflicts. This handles both DB-tracked sandboxes and
  // orphans left behind by previously failed imports.
  try {
    const existing = await daytona.get(sandboxName);
    await daytona.delete(existing);
    console.log(`[daytona] Deleted pre-existing sandbox: ${sandboxName}`);
  } catch {
    // Sandbox doesn't exist on Daytona — no cleanup needed
  }

  const networkAllowList = process.env.DAYTONA_NETWORK_ALLOW_LIST;
  const cpuLimit = readNumberEnv('DAYTONA_CPU_LIMIT', DEFAULT_CPU_LIMIT);
  const memoryLimitGiB = readNumberEnv('DAYTONA_MEMORY_GIB', DEFAULT_MEMORY_GIB);
  const diskLimitGiB = readNumberEnv('DAYTONA_DISK_GIB', DEFAULT_DISK_GIB);
  const sandbox = await daytona.create({
    name: sandboxName,
    language: CodeLanguage.TYPESCRIPT,
    labels: {
      app: 'architect-agent',
      access: options.accessMode,
      adapter: options.sourceAdapter,
    },
    autoStopInterval: readNumberEnv('DAYTONA_AUTO_STOP_MINUTES', DEFAULT_AUTO_STOP_MINUTES),
    autoArchiveInterval: readNumberEnv('DAYTONA_AUTO_ARCHIVE_MINUTES', DEFAULT_AUTO_ARCHIVE_MINUTES),
    autoDeleteInterval: readNumberEnv('DAYTONA_AUTO_DELETE_MINUTES', DEFAULT_AUTO_DELETE_MINUTES),
    networkBlockAll: false,
    networkAllowList,
  });

  const workDir = (await sandbox.getWorkDir()) ?? 'workspace';
  return {
    remoteId: sandbox.id,
    workDir,
    repoPath: `${workDir}/repo`,
    cpuLimit,
    memoryLimitGiB,
    diskLimitGiB,
    autoStopIntervalMinutes: sandbox.autoStopInterval ?? DEFAULT_AUTO_STOP_MINUTES,
    autoArchiveIntervalMinutes: sandbox.autoArchiveInterval ?? DEFAULT_AUTO_ARCHIVE_MINUTES,
    autoDeleteIntervalMinutes: sandbox.autoDeleteInterval ?? DEFAULT_AUTO_DELETE_MINUTES,
    networkBlockAll: sandbox.networkBlockAll ?? false,
    networkAllowList: sandbox.networkAllowList ?? undefined,
  };
}

export async function deleteSandbox(remoteId: string) {
  const sandbox = await getSandbox(remoteId);
  await sandbox.delete();
}

/**
 * Stops a running sandbox to release CPU and memory resources.
 * The sandbox remains on disk and can be auto-woken by any subsequent
 * SDK interaction (e.g., `process.executeCommand`).
 */
export async function stopSandbox(remoteId: string) {
  const sandbox = await getSandbox(remoteId);
  await sandbox.stop(60);
}

/**
 * Returns the current Daytona-side state of a sandbox.
 * Useful for syncing Convex DB status with reality.
 */
export async function getSandboxState(
  remoteId: string,
): Promise<'started' | 'stopped' | 'archived' | 'destroyed' | 'unknown'> {
  try {
    const sandbox = await getSandbox(remoteId);
    await sandbox.refreshData();
    const state = sandbox.state;
    if (state === 'started' || state === 'stopped' || state === 'archived') {
      return state;
    }
    // Daytona may report other transient states (e.g., 'stopping', 'starting')
    return 'unknown';
  } catch {
    // If the sandbox can't be retrieved at all it has been destroyed/deleted
    return 'destroyed';
  }
}

export async function cloneRepositoryInSandbox(args: {
  remoteId: string;
  url: string;
  branch?: string;
  token?: string;
}) {
  const sandbox = await getSandbox(args.remoteId);
  await sandbox.git.clone(args.url, 'repo', args.branch, undefined, args.token ? 'x-access-token' : undefined, args.token);

  const branchCommand = await sandbox.process.executeCommand('git branch --show-current', 'repo');
  const shaCommand = await sandbox.process.executeCommand('git rev-parse HEAD', 'repo');

  return {
    branch: branchCommand.result.trim() || args.branch,
    commitSha: shaCommand.result.trim(),
  };
}

export async function collectRepositorySnapshot(remoteId: string, repoPath: string): Promise<RepositorySnapshot> {
  const sandbox = await getSandbox(remoteId);
  const listed = await walkRepositoryTree(sandbox, repoPath, '', 0, []);
  const readmePath = listed.find((entry) => entry.fileType === 'file' && /(^|\/)readme(\.[^.]+)?$/i.test(entry.path))?.path;

  const importantFiles = listed
    .filter((entry) => entry.fileType === 'file' && shouldReadFile(entry.path))
    .sort((left, right) => Number(right.path.includes('README')) - Number(left.path.includes('README')))
    .slice(0, 12);

  const importantFileContents = await Promise.all(
    importantFiles.map(async (file) => ({
      path: file.path,
      content: await downloadUtf8File(sandbox, `${repoPath}/${file.path}`),
    })),
  );

  const packageJsonContent =
    importantFiles.find((file) => file.path === 'package.json')
      ? await downloadUtf8File(sandbox, `${repoPath}/package.json`)
      : undefined;
  const pyprojectContent =
    importantFiles.find((file) => file.path === 'pyproject.toml')
      ? await downloadUtf8File(sandbox, `${repoPath}/pyproject.toml`)
      : undefined;
  const cargoTomlContent =
    importantFiles.find((file) => file.path === 'Cargo.toml')
      ? await downloadUtf8File(sandbox, `${repoPath}/Cargo.toml`)
      : undefined;

  return {
    readmePath,
    readmeContent: readmePath ? await downloadUtf8File(sandbox, `${repoPath}/${readmePath}`) : undefined,
    packageJsonContent,
    pyprojectContent,
    cargoTomlContent,
    importantFileContents: importantFileContents.filter((item) => item.content.length > 0),
    files: listed,
  };
}

export async function runFocusedInspection(remoteId: string, repoPath: string, prompt: string) {
  const sandbox = await getSandbox(remoteId);
  const inspectionCommand = `
python3 - <<'PY'
import json, os, re

repo_path = os.environ["REPO_PATH"]
prompt = os.environ["ANALYSIS_PROMPT"]
terms = [token for token in re.findall(r"[A-Za-z0-9_]+", prompt.lower()) if len(token) > 2][:8]
matches = []
for root, dirs, files in os.walk(repo_path):
    dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "dist", "build", ".next", ".turbo"}]
    rel_root = os.path.relpath(root, repo_path)
    for name in files:
        rel_path = name if rel_root == "." else os.path.join(rel_root, name)
        score = sum(1 for term in terms if term in rel_path.lower())
        if score:
            matches.append((score, rel_path))
matches.sort(key=lambda item: (-item[0], item[1]))
print(json.dumps({
    "terms": terms,
    "matchingFiles": [path for _, path in matches[:20]]
}))
PY`;

  const result = await sandbox.process.executeCommand(
    inspectionCommand,
    undefined,
    {
      REPO_PATH: repoPath,
      ANALYSIS_PROMPT: prompt,
    },
    60,
  );

  return result.result.trim();
}

export function isDaytonaConfigured() {
  return Boolean(process.env.DAYTONA_API_KEY);
}

async function walkRepositoryTree(
  sandbox: Sandbox,
  repoPath: string,
  relativePath: string,
  depth: number,
  acc: RepositorySnapshot['files'],
): Promise<RepositorySnapshot['files']> {
  if (depth > MAX_TREE_DEPTH || acc.length >= MAX_LISTED_FILES) {
    return acc;
  }

  const currentPath = relativePath ? `${repoPath}/${relativePath}` : repoPath;
  const items = await sandbox.fs.listFiles(currentPath);

  for (const item of items) {
    if (acc.length >= MAX_LISTED_FILES) {
      break;
    }

    const nextRelative = relativePath ? `${relativePath}/${item.name}` : item.name;
    if (ignorePath(nextRelative)) {
      continue;
    }

    acc.push({
      path: nextRelative,
      parentPath: relativePath,
      fileType: item.isDir ? 'dir' : 'file',
      extension: undefined,
      language: undefined,
      sizeBytes: item.size,
      isEntryPoint: false,
      isConfig: false,
      isImportant: false,
      summary: undefined,
    });

    if (item.isDir) {
      await walkRepositoryTree(sandbox, repoPath, nextRelative, depth + 1, acc);
    }
  }

  return acc;
}

async function downloadUtf8File(sandbox: Sandbox, path: string) {
  const buffer = await sandbox.fs.downloadFile(path, 30);
  return buffer.toString('utf8').slice(0, 20_000);
}

async function getSandbox(remoteId: string) {
  const daytona = createDaytonaClient();
  return daytona.get(remoteId);
}

function createDaytonaClient() {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is required to provision a sandbox.');
  }

  return new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  });
}

function ignorePath(path: string) {
  return (
    path.startsWith('.git/') ||
    path.startsWith('node_modules/') ||
    path.startsWith('dist/') ||
    path.startsWith('build/') ||
    path.startsWith('.next/') ||
    path.startsWith('.turbo/')
  );
}

function safeLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 48);
}

function readNumberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
