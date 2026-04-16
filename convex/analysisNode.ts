"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import { runFocusedInspection } from './daytona';
import { createDeepAnalysisMarkdown } from './lib/repoAnalysis';

type DeepAnalysisContext = {
  repositoryId: Id<'repositories'>;
  ownerTokenIdentifier: string;
  latestSandboxId?: Id<'sandboxes'>;
  remoteSandboxId?: string;
  repoPath?: string;
  sourceRepoFullName: string;
};

export const runDeepAnalysis = internalAction({
  args: {
    repositoryId: v.id('repositories'),
    jobId: v.id('jobs'),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.analysis.markDeepAnalysisRunning, {
      jobId: args.jobId,
    });

    try {
      const context = (await ctx.runQuery(internal.analysis.getDeepAnalysisContext, {
        repositoryId: args.repositoryId,
      })) as DeepAnalysisContext;

      if (!context.remoteSandboxId || !context.repoPath) {
        throw new Error('No Daytona sandbox is available for this repository yet. Import the repo first.');
      }

      const inspectionLog = await runFocusedInspection(context.remoteSandboxId, context.repoPath, args.prompt);
      const markdown = createDeepAnalysisMarkdown(args.prompt, inspectionLog);

      await ctx.runMutation(internal.analysis.completeDeepAnalysis, {
        repositoryId: args.repositoryId,
        jobId: args.jobId,
        ownerTokenIdentifier: context.ownerTokenIdentifier,
        summary: `Focused inspection completed for ${context.sourceRepoFullName}.`,
        contentMarkdown: markdown,
      });
    } catch (error) {
      await ctx.runMutation(internal.analysis.failDeepAnalysis, {
        jobId: args.jobId,
        errorMessage: error instanceof Error ? error.message : 'Unknown deep analysis error',
      });
    }
  },
});
