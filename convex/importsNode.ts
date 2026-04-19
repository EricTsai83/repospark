"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { cloneRepositoryInSandbox, collectRepositorySnapshot, isDaytonaConfigured, provisionSandbox, stopSandbox } from './daytona';
import { getInstallationAccessToken } from './githubAppNode';
import {
  buildRepositoryManifest,
  createArchitectureArtifactMarkdown,
  createChunkRecords,
  createManifestArtifactMarkdown,
  createRepoFileRecords,
} from './lib/repoAnalysis';

type ImportContext = {
  repositoryId: Id<'repositories'>;
  jobId: Id<'jobs'>;
  branch?: string;
  sourceUrl: string;
  ownerTokenIdentifier: string;
  accessMode: 'public' | 'private';
  sourceRepoFullName: string;
};

export const runImportPipeline = internalAction({
  args: {
    importId: v.id('imports'),
  },
  handler: async (ctx, args) => {
    const importContext = (await ctx.runQuery(internal.imports.getImportContext, {
      importId: args.importId,
    })) as ImportContext;

    await ctx.runMutation(internal.imports.markImportRunning, {
      importId: args.importId,
      jobId: importContext.jobId,
    });

    try {
      if (!isDaytonaConfigured()) {
        throw new Error('DAYTONA_API_KEY is missing. Add Daytona credentials before importing repositories.');
      }

      // -----------------------------------------------------------------------
      // Early permission check: verify the GitHub App installation can access
      // this repo BEFORE provisioning a sandbox. This avoids wasting resources
      // when the repo is not included in the installation's repo selection.
      // -----------------------------------------------------------------------
      const installationId: number | null = await ctx.runQuery(
        internal.github.getInstallationIdForOwner,
        { ownerTokenIdentifier: importContext.ownerTokenIdentifier },
      );

      if (!installationId) {
        throw new Error(
          'No active GitHub App installation found. Please connect your GitHub account first.',
        );
      }

      // Parse owner/repo from sourceRepoFullName (format: "owner/repo")
      const [repoOwner, repoName] = importContext.sourceRepoFullName.split('/');
      if (!repoOwner || !repoName) {
        throw new Error(`Invalid repository name: ${importContext.sourceRepoFullName}`);
      }

      const accessCheck = (await ctx.runAction(internal.githubAppNode.checkRepoAccess, {
        installationId,
        owner: repoOwner,
        repo: repoName,
      })) as { accessible: boolean; isPrivate?: boolean; message?: string };

      if (!accessCheck.accessible) {
        throw new Error(
          accessCheck.message ??
            `Repository "${importContext.sourceRepoFullName}" is not accessible with your current GitHub App permissions.`,
        );
      }

      // Update the repository's visibility now that we know the actual value
      const detectedVisibility = accessCheck.isPrivate ? 'private' as const : 'public' as const;
      await ctx.runMutation(internal.repositories.updateRepoVisibility, {
        repositoryId: importContext.repositoryId,
        visibility: detectedVisibility,
      });

      // -----------------------------------------------------------------------
      // Repo is accessible — proceed with sandbox provisioning
      // -----------------------------------------------------------------------

      // Archive the previous sandbox record in DB so it won't be referenced again.
      // The Daytona-level cleanup (deleting the actual remote sandbox) is handled
      // inside provisionSandbox via name-based lookup.
      const existingSandbox = await ctx.runQuery(internal.imports.getExistingSandboxForRepo, {
        repositoryId: importContext.repositoryId,
      });
      if (existingSandbox) {
        await ctx.runMutation(internal.imports.archiveSandbox, {
          sandboxId: existingSandbox.sandboxId,
        });
      }

      const sandbox = await provisionSandbox({
        repositoryKey: importContext.sourceRepoFullName,
        accessMode: importContext.accessMode,
        sourceAdapter: 'git_clone',
      });

      const sandboxId = await ctx.runMutation(internal.imports.registerSandbox, {
        importId: args.importId,
        repositoryId: importContext.repositoryId,
        ownerTokenIdentifier: importContext.ownerTokenIdentifier,
        sourceAdapter: 'git_clone',
        remoteId: sandbox.remoteId,
        workDir: sandbox.workDir,
        repoPath: sandbox.repoPath,
        cpuLimit: sandbox.cpuLimit,
        memoryLimitGiB: sandbox.memoryLimitGiB,
        diskLimitGiB: sandbox.diskLimitGiB,
        autoStopIntervalMinutes: sandbox.autoStopIntervalMinutes,
        autoArchiveIntervalMinutes: sandbox.autoArchiveIntervalMinutes,
        autoDeleteIntervalMinutes: sandbox.autoDeleteIntervalMinutes,
        networkBlockAll: sandbox.networkBlockAll,
        networkAllowList: sandbox.networkAllowList,
      });

      // Retrieve GitHub access token — required for private repos
      let githubToken: string | undefined;
      if (detectedVisibility === 'private') {
        githubToken = await getInstallationAccessToken(installationId);
      } else {
        try {
          githubToken = await getInstallationAccessToken(installationId);
        } catch (error) {
          console.warn(
            '[import] GitHub token unavailable, falling back to unauthenticated:',
            error instanceof Error ? error.message : error,
          );
        }
      }

      const cloneResult = await cloneRepositoryInSandbox({
        remoteId: sandbox.remoteId,
        url: importContext.sourceUrl,
        branch: importContext.branch,
        token: githubToken,
      });

      const snapshot = await collectRepositorySnapshot(sandbox.remoteId, sandbox.repoPath);
      const fileRecords = createRepoFileRecords(
        snapshot.files.map((file) => ({
          path: file.path,
          fileType: file.fileType,
          sizeBytes: file.sizeBytes,
        })),
      );
      const manifest = buildRepositoryManifest({
        ...snapshot,
        files: fileRecords,
      });
      const chunkRecords = createChunkRecords({
        ...snapshot,
        files: fileRecords,
      });

      await ctx.runMutation(internal.imports.persistImportResults, {
        importId: args.importId,
        repositoryId: importContext.repositoryId,
        jobId: importContext.jobId,
        sandboxId,
        commitSha: cloneResult.commitSha,
        branch: cloneResult.branch,
        detectedLanguages: manifest.detectedLanguages,
        packageManagers: manifest.packageManagers,
        entrypoints: manifest.entrypoints,
        summary: manifest.summary,
        readmeSummary: summarizeReadme(snapshot.readmeContent),
        architectureSummary: 'Repository imported and indexed for architecture review.',
        repoFiles: fileRecords,
        repoChunks: chunkRecords,
        artifacts: [
          {
            kind: 'manifest' as const,
            title: 'Repository Manifest',
            summary: manifest.summary,
            contentMarkdown: createManifestArtifactMarkdown(manifest),
            source: 'heuristic' as const,
          },
          {
            kind: 'readme_summary' as const,
            title: 'README Summary',
            summary: summarizeReadme(snapshot.readmeContent),
            contentMarkdown:
              snapshot.readmeContent && snapshot.readmePath
                ? `# README Summary\n\nSource: \`${snapshot.readmePath}\`\n\n${snapshot.readmeContent.slice(0, 6000)}`
                : '# README Summary\n\nNo README detected during import.',
            source: 'heuristic' as const,
          },
          {
            kind: 'architecture' as const,
            title: 'Architecture Overview',
            summary: 'Initial architecture map created from repository layout.',
            contentMarkdown: createArchitectureArtifactMarkdown(manifest, {
              ...snapshot,
              files: fileRecords,
            }),
            source: 'heuristic' as const,
          },
        ],
      });

      // Immediately stop the sandbox to release CPU and memory.
      // All indexed data is now persisted in Convex. The sandbox stays on disk
      // and will auto-wake if Deep Path needs it later.
      try {
        await stopSandbox(sandbox.remoteId);
        console.log(`[import] Sandbox ${sandbox.remoteId} stopped after import to save resources.`);
      } catch (stopError) {
        // Non-fatal: sandbox will auto-stop after the idle interval anyway.
        console.warn(
          `[import] Failed to eagerly stop sandbox ${sandbox.remoteId}:`,
          stopError instanceof Error ? stopError.message : stopError,
        );
      }
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : 'Unknown import error';

      // Provide helpful error message for auth/access failures.
      // When a repo is not included in the GitHub App installation,
      // clone failures typically surface as "not found" (404) or permission denied.
      const lowerMsg = errorMessage.toLowerCase();
      const isAuthFailure =
        lowerMsg.includes('not found') ||
        lowerMsg.includes('authentication failed') ||
        lowerMsg.includes('could not read from remote') ||
        lowerMsg.includes('private') ||
        lowerMsg.includes('401') ||
        lowerMsg.includes('403') ||
        lowerMsg.includes('404') ||
        lowerMsg.includes('permission denied');

      if (isAuthFailure) {
        errorMessage +=
          '\n\nThis repository may not be accessible. Make sure it is included in your GitHub App installation. You can update your repo selection in GitHub Settings > Applications.';
      }

      await ctx.runMutation(internal.imports.markImportFailed, {
        importId: args.importId,
        jobId: importContext.jobId,
        errorMessage,
      });
    }
  },
});

function summarizeReadme(readme?: string) {
  if (!readme) {
    return 'No README was detected during import.';
  }

  return readme
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4)
    .join(' ')
    .slice(0, 240);
}
