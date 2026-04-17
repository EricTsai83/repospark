"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { cloneRepositoryInSandbox, collectRepositorySnapshot, isDaytonaConfigured, provisionSandbox } from './daytona';
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

      const cloneResult = await cloneRepositoryInSandbox({
        remoteId: sandbox.remoteId,
        url: importContext.sourceUrl,
        branch: importContext.branch,
        accessMode: importContext.accessMode,
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
        detectedFramework: manifest.detectedFramework,
        detectedLanguages: manifest.detectedLanguages,
        packageManagers: manifest.packageManagers,
        entrypoints: manifest.entrypoints,
        summary: manifest.summary,
        readmeSummary: summarizeReadme(snapshot.readmeContent),
        architectureSummary: manifest.detectedFramework
          ? `${manifest.detectedFramework} workspace with ${manifest.entrypoints.length || 1} likely entrypoint(s).`
          : 'Repository imported and indexed for architecture review.',
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
            summary: manifest.detectedFramework
              ? `${manifest.detectedFramework} structure detected.`
              : 'Initial architecture map created from repository layout.',
            contentMarkdown: createArchitectureArtifactMarkdown(manifest, {
              ...snapshot,
              files: fileRecords,
            }),
            source: 'heuristic' as const,
          },
        ],
      });
    } catch (error) {
      await ctx.runMutation(internal.imports.markImportFailed, {
        importId: args.importId,
        jobId: importContext.jobId,
        errorMessage: error instanceof Error ? error.message : 'Unknown import error',
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
