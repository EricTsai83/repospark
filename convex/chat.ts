import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query, internalAction, internalMutation, internalQuery } from './_generated/server';
import { requireViewerIdentity } from './lib/auth';
import {
  CHAT_BASELINE_CHUNKS,
  CHAT_CANDIDATE_POOL_LIMIT,
  CHAT_SEARCH_RESULTS_PER_INDEX,
  MAX_CONTEXT_ARTIFACTS,
  MAX_CONTEXT_MESSAGES,
  MAX_VISIBLE_MESSAGES,
  MAX_RELEVANT_CHUNKS,
  STREAM_FLUSH_THRESHOLD,
} from './lib/constants';
import {
  CHAT_JOB_LEASE_MS,
  consumeChatGlobalRateLimit,
  consumeChatRateLimit,
  getLeaseRetryAfterMs,
  isLeaseActive,
  throwOperationAlreadyInProgress,
} from './lib/rateLimit';

type ReplyContext = {
  ownerTokenIdentifier: string;
  repositorySummary?: string;
  readmeSummary?: string;
  architectureSummary?: string;
  sourceRepoFullName: string;
  artifacts: Array<{ title: string; summary: string; contentMarkdown: string }>;
  chunks: Array<{ path: string; summary: string; content: string }>;
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
};

const STALE_CHAT_JOB_ERROR_MESSAGE =
  'The assistant reply stalled and was automatically marked as failed.';

async function getActiveChatJobForThread(
  ctx: MutationCtx,
  threadId: Id<'threads'>,
  now: number,
) {
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(25);

  return jobs.find(
    (job) =>
      job.kind === 'chat' &&
      (job.status === 'queued' || job.status === 'running') &&
      isLeaseActive(job.leaseExpiresAt, now),
  );
}

export const listThreads = query({
  args: {
    repositoryId: v.id('repositories'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    return await ctx.db
      .query('threads')
      .withIndex('by_repositoryId_and_lastMessageAt', (q) => q.eq('repositoryId', args.repositoryId))
      .order('desc')
      .take(20);
  },
});

export const listMessages = query({
  args: {
    threadId: v.id('threads'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }

    const repository = await ctx.db.get(thread.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Thread not found.');
    }

    return await loadRecentMessages(ctx, args.threadId, MAX_VISIBLE_MESSAGES);
  },
});

export const createThread = mutation({
  args: {
    repositoryId: v.id('repositories'),
    title: v.optional(v.string()),
    mode: v.optional(v.union(v.literal('fast'), v.literal('deep'))),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const repository = await ctx.db.get(args.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Repository not found.');
    }

    return await ctx.db.insert('threads', {
      repositoryId: args.repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      title: args.title ?? `${repository.sourceRepoName} chat`,
      mode: args.mode ?? 'fast',
      lastMessageAt: Date.now(),
    });
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.id('threads'),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Thread not found.');
    }

    // Delete all messages in this thread
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .take(500);
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    // Clear defaultThreadId reference on the repository if needed
    const repository = await ctx.db.get(thread.repositoryId);
    if (repository && repository.defaultThreadId === args.threadId) {
      await ctx.db.patch(thread.repositoryId, { defaultThreadId: undefined });
    }

    // Delete the thread itself
    await ctx.db.delete(args.threadId);

    // If there might be more messages, schedule continuation cleanup
    if (messages.length === 500) {
      await ctx.scheduler.runAfter(0, internal.chat.cleanupOrphanedMessages, {
        threadId: args.threadId,
      });
    }
  },
});

export const cleanupOrphanedMessages = internalMutation({
  args: {
    threadId: v.id('threads'),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .take(500);
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }
    if (messages.length === 500) {
      await ctx.scheduler.runAfter(0, internal.chat.cleanupOrphanedMessages, {
        threadId: args.threadId,
      });
    }
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.id('threads'),
    content: v.string(),
    mode: v.optional(v.union(v.literal('fast'), v.literal('deep'))),
  },
  handler: async (ctx, args) => {
    const identity = await requireViewerIdentity(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }

    const repository = await ctx.db.get(thread.repositoryId);
    if (!repository || repository.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error('Thread not found.');
    }

    const mode = args.mode ?? thread.mode;
    const now = Date.now();
    const trimmedContent = args.content.trim();
    const activeJob = await getActiveChatJobForThread(ctx, args.threadId, now);

    if (activeJob) {
      throwOperationAlreadyInProgress(
        'threadChatInFlight',
        'An assistant reply is already in progress for this thread.',
        getLeaseRetryAfterMs(activeJob.leaseExpiresAt, now),
      );
    }

    await consumeChatRateLimit(ctx, identity.tokenIdentifier);
    await consumeChatGlobalRateLimit(ctx);

    const jobId = await ctx.db.insert('jobs', {
      repositoryId: thread.repositoryId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      sandboxId: repository.latestSandboxId,
      threadId: args.threadId,
      kind: 'chat',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      costCategory: mode === 'deep' ? 'deep_analysis' : 'chat',
      triggerSource: 'user',
      leaseExpiresAt: now + CHAT_JOB_LEASE_MS,
    });

    const userMessageId = await ctx.db.insert('messages', {
      repositoryId: thread.repositoryId,
      threadId: args.threadId,
      jobId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      role: 'user',
      status: 'completed',
      mode,
      content: trimmedContent,
    });

    const assistantMessageId = await ctx.db.insert('messages', {
      repositoryId: thread.repositoryId,
      threadId: args.threadId,
      jobId,
      ownerTokenIdentifier: identity.tokenIdentifier,
      role: 'assistant',
      status: 'pending',
      mode,
      content: '',
    });

    await ctx.db.patch(args.threadId, {
      mode,
      lastMessageAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.chat.generateAssistantReply, {
      threadId: args.threadId,
      userMessageId,
      assistantMessageId,
      jobId,
    });

    return {
      jobId,
      userMessageId,
      assistantMessageId,
    };
  },
});

export const getReplyContext = internalQuery({
  args: {
    threadId: v.id('threads'),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }

    const repository = await ctx.db.get(thread.repositoryId);
    if (!repository) {
      throw new Error('Repository not found.');
    }

    const importArtifacts = repository.latestImportJobId
      ? await ctx.db
          .query('analysisArtifacts')
          .withIndex('by_jobId', (q) => q.eq('jobId', repository.latestImportJobId!))
          .take(10)
      : [];
    const deepAnalysisArtifacts = await ctx.db
      .query('analysisArtifacts')
      .withIndex('by_repositoryId_and_kind', (q) =>
        q.eq('repositoryId', thread.repositoryId).eq('kind', 'deep_analysis'),
      )
      .order('desc')
      .take(10);
    const artifacts = [...importArtifacts, ...deepAnalysisArtifacts];
    const messages = await loadRecentMessages(ctx, args.threadId, MAX_CONTEXT_MESSAGES);
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    const chunks = repository.latestImportId
      ? await loadCandidateChunks(ctx, repository.latestImportId, latestUserMessage?.content ?? '')
      : [];

    return {
      ownerTokenIdentifier: repository.ownerTokenIdentifier,
      repositorySummary: repository.summary,
      readmeSummary: repository.readmeSummary,
      architectureSummary: repository.architectureSummary,
      sourceRepoFullName: repository.sourceRepoFullName,
      artifacts: artifacts.map((artifact) => ({
        title: artifact.title,
        summary: artifact.summary,
        contentMarkdown: artifact.contentMarkdown,
      })),
      chunks: chunks.map((chunk) => ({
        path: chunk.path,
        summary: chunk.summary,
        content: chunk.content,
      })),
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
  },
});

export const generateAssistantReply = internalAction({
  args: {
    threadId: v.id('threads'),
    userMessageId: v.id('messages'),
    assistantMessageId: v.id('messages'),
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.chat.markAssistantReplyRunning, {
      assistantMessageId: args.assistantMessageId,
      jobId: args.jobId,
    });

    try {
      // Cast required: ctx.runAction/runQuery cannot infer return types for
      // functions in the same file due to Convex TypeScript circularity limits.
      const replyContext = (await ctx.runQuery(internal.chat.getReplyContext, {
        threadId: args.threadId,
      })) as ReplyContext;

      const latestUserMessage = [...replyContext.messages].reverse().find((message) => message.role === 'user');
      const userPrompt = latestUserMessage?.content ?? 'Summarize this repository.';
      const relevantChunks = selectRelevantChunks(replyContext.chunks, userPrompt);

      if (!process.env.OPENAI_API_KEY) {
        const heuristicAnswer = buildHeuristicAnswer(replyContext, userPrompt, relevantChunks);
        await ctx.runMutation(internal.chat.completeAssistantReply, {
          threadId: args.threadId,
          assistantMessageId: args.assistantMessageId,
          jobId: args.jobId,
          content: heuristicAnswer,
        });
        return;
      }

      const response = streamText({
        model: openai(process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
        system: buildSystemPrompt(),
        prompt: buildUserPrompt(replyContext, userPrompt, relevantChunks),
      });

      let content = '';
      let lastFlushedLength = 0;
      for await (const delta of response.textStream) {
        content += delta;
        if (content.length - lastFlushedLength >= STREAM_FLUSH_THRESHOLD) {
          const nextDelta = content.slice(lastFlushedLength);
          lastFlushedLength = content.length;
          await ctx.runMutation(internal.chat.appendAssistantDelta, {
            assistantMessageId: args.assistantMessageId,
            delta: nextDelta,
          });
        }
      }

      const remainingDelta = content.slice(lastFlushedLength);
      await ctx.runMutation(internal.chat.completeAssistantReply, {
        threadId: args.threadId,
        assistantMessageId: args.assistantMessageId,
        jobId: args.jobId,
        content: remainingDelta,
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.failAssistantReply, {
        assistantMessageId: args.assistantMessageId,
        jobId: args.jobId,
        errorMessage: error instanceof Error ? error.message : 'Unknown assistant error',
      });
    }
  },
});

export const markAssistantReplyRunning = internalMutation({
  args: {
    assistantMessageId: v.id('messages'),
    jobId: v.id('jobs'),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.assistantMessageId, {
      status: 'streaming',
    });
    await ctx.db.patch(args.jobId, {
      status: 'running',
      stage: 'generating_reply',
      progress: 0.15,
      startedAt: now,
      leaseExpiresAt: now + CHAT_JOB_LEASE_MS,
    });
  },
});

export const appendAssistantDelta = internalMutation({
  args: {
    assistantMessageId: v.id('messages'),
    delta: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message) {
      return;
    }

    await ctx.db.patch(args.assistantMessageId, {
      content: `${message.content}${args.delta}`,
      status: 'streaming',
    });
  },
});

export const completeAssistantReply = internalMutation({
  args: {
    threadId: v.id('threads'),
    assistantMessageId: v.id('messages'),
    jobId: v.id('jobs'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.assistantMessageId);
    if (!message) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch(args.assistantMessageId, {
      content: `${message.content}${args.content}`,
      status: 'completed',
    });
    await ctx.db.patch(args.threadId, {
      lastAssistantMessageAt: now,
      lastMessageAt: now,
    });
    await ctx.db.patch(args.jobId, {
      status: 'completed',
      stage: 'completed',
      progress: 1,
      completedAt: now,
      outputSummary: 'Assistant reply generated.',
      leaseExpiresAt: undefined,
    });
  },
});

export const failAssistantReply = internalMutation({
  args: {
    assistantMessageId: v.id('messages'),
    jobId: v.id('jobs'),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.assistantMessageId, {
      status: 'failed',
      errorMessage: args.errorMessage,
      content: args.errorMessage,
    });
    await ctx.db.patch(args.jobId, {
      status: 'failed',
      stage: 'failed',
      progress: 1,
      completedAt: now,
      errorMessage: args.errorMessage,
      leaseExpiresAt: undefined,
    });
  },
});

export const recoverStaleChatJob = internalMutation({
  args: {
    jobId: v.id('jobs'),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (
      !job ||
      job.kind !== 'chat' ||
      (job.status !== 'queued' && job.status !== 'running') ||
      typeof job.leaseExpiresAt !== 'number' ||
      job.leaseExpiresAt > now
    ) {
      return;
    }

    const message = args.errorMessage ?? STALE_CHAT_JOB_ERROR_MESSAGE;
    const jobMessages = await ctx.db
      .query('messages')
      .withIndex('by_jobId', (q) => q.eq('jobId', args.jobId))
      .take(10);
    const assistantMessage = jobMessages.find((entry) => entry.role === 'assistant');

    if (assistantMessage) {
      await ctx.db.patch(assistantMessage._id, {
        status: 'failed',
        errorMessage: message,
        content: message,
      });
    }

    await ctx.db.patch(args.jobId, {
      status: 'failed',
      stage: 'failed',
      progress: 1,
      completedAt: now,
      errorMessage: message,
      leaseExpiresAt: undefined,
    });
  },
});

function buildSystemPrompt() {
  return [
    'You are an open source architecture analyst.',
    'Answer questions about the imported repository using the provided artifacts and code excerpts.',
    'Be concrete, mention likely boundaries, and state uncertainty when evidence is weak.',
  ].join(' ');
}

async function loadRecentMessages(
  ctx: Pick<QueryCtx, 'db'>,
  threadId: Id<'threads'>,
  limit: number,
) {
  const recentMessages = await ctx.db
    .query('messages')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(limit);

  return recentMessages.reverse();
}

async function loadCandidateChunks(
  ctx: Pick<QueryCtx, 'db'>,
  importId: Id<'imports'>,
  question: string,
) {
  const headCount = Math.ceil(CHAT_BASELINE_CHUNKS / 2);
  const tailCount = CHAT_BASELINE_CHUNKS - headCount;
  const [headChunks, tailChunks] = await Promise.all([
    ctx.db
      .query('repoChunks')
      .withIndex('by_importId_and_path_and_chunkIndex', (q) => q.eq('importId', importId))
      .take(headCount),
    ctx.db
      .query('repoChunks')
      .withIndex('by_importId_and_path_and_chunkIndex', (q) => q.eq('importId', importId))
      .order('desc')
      .take(tailCount),
  ]);
  const searchQuery = buildChunkSearchQuery(question);
  let summaryMatches: Doc<'repoChunks'>[] = [];
  let contentMatches: Doc<'repoChunks'>[] = [];

  if (searchQuery) {
    [summaryMatches, contentMatches] = await Promise.all([
      ctx.db
        .query('repoChunks')
        .withSearchIndex('search_summary', (q) => q.search('summary', searchQuery).eq('importId', importId))
        .take(CHAT_SEARCH_RESULTS_PER_INDEX),
      ctx.db
        .query('repoChunks')
        .withSearchIndex('search_content', (q) => q.search('content', searchQuery).eq('importId', importId))
        .take(CHAT_SEARCH_RESULTS_PER_INDEX),
    ]);
  }

  const candidatesById = new Map<string, Doc<'repoChunks'>>();
  for (const chunk of [...summaryMatches, ...contentMatches, ...headChunks, ...[...tailChunks].reverse()]) {
    if (candidatesById.has(chunk._id)) {
      continue;
    }

    candidatesById.set(chunk._id, chunk);
    if (candidatesById.size >= CHAT_CANDIDATE_POOL_LIMIT) {
      break;
    }
  }

  return Array.from(candidatesById.values());
}

function buildChunkSearchQuery(question: string) {
  return tokenizeQuestion(question).slice(0, 8).join(' ');
}

function buildUserPrompt(
  context: ReplyContext,
  question: string,
  relevantChunks: Array<{ path: string; summary: string; content: string }>,
) {
  const artifactSection = context.artifacts
    .slice(0, MAX_CONTEXT_ARTIFACTS)
    .map((artifact) => `## ${artifact.title}\n${artifact.summary}\n${artifact.contentMarkdown.slice(0, 1400)}`)
    .join('\n\n');
  const chunkSection = relevantChunks
    .map((chunk) => `### ${chunk.path}\n${chunk.summary}\n${chunk.content.slice(0, 1200)}`)
    .join('\n\n');

  return [
    `Repository: ${context.sourceRepoFullName}`,
    context.repositorySummary ? `Repository summary: ${context.repositorySummary}` : undefined,
    context.readmeSummary ? `README summary: ${context.readmeSummary}` : undefined,
    context.architectureSummary ? `Architecture summary: ${context.architectureSummary}` : undefined,
    '',
    'Artifacts:',
    artifactSection,
    '',
    'Relevant code excerpts:',
    chunkSection || 'No highly relevant chunks were pre-selected.',
    '',
    `User question: ${question}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildHeuristicAnswer(
  context: ReplyContext,
  question: string,
  relevantChunks: Array<{ path: string; summary: string; content: string }>,
) {
  return [
    `目前沒有設定 \`OPENAI_API_KEY\`，所以我先用已索引的 repository artifact 回答。`,
    '',
    `Repository: ${context.sourceRepoFullName}`,
    context.repositorySummary ? `- Summary: ${context.repositorySummary}` : undefined,
    context.architectureSummary ? `- Architecture: ${context.architectureSummary}` : undefined,
    '',
    `你的問題：${question}`,
    '',
    relevantChunks.length > 0
      ? `我目前最相關的線索來自：${relevantChunks.map((chunk) => `\`${chunk.path}\``).join(', ')}`
      : '目前沒有足夠的程式碼片段被選中，建議先執行一次深度分析。',
  ]
    .filter(Boolean)
    .join('\n');
}

const SHORT_TECH_TOKENS = new Set([
  'ai',
  'cd',
  'ci',
  'db',
  'dx',
  'fs',
  'go',
  'io',
  'js',
  'md',
  'os',
  'qa',
  'ts',
  'ui',
  'ux',
  'vm',
]);

const QUESTION_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'does',
  'for',
  'how',
  'in',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'show',
  'tell',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'work',
  'works',
  'you',
  'your',
]);

function tokenizeQuestion(question: string) {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_]+/g)
        .filter(
          (token) =>
            token.length > 0 &&
            !QUESTION_STOPWORDS.has(token) &&
            (token.length > 2 || SHORT_TECH_TOKENS.has(token)),
        ),
    ),
  );
}

export function selectRelevantChunks(
  chunks: Array<{ path: string; summary: string; content: string }>,
  question: string,
) {
  const tokens = tokenizeQuestion(question);

  if (tokens.length === 0) {
    return chunks.slice(0, MAX_RELEVANT_CHUNKS);
  }

  return [...chunks]
    .map((chunk, origIndex) => ({
      ...chunk,
      origIndex,
      score: tokens.reduce((count, token) => {
        let nextScore = count;
        if (chunk.path.toLowerCase().includes(token)) {
          nextScore += 3;
        }
        if (chunk.summary.toLowerCase().includes(token)) {
          nextScore += 2;
        }
        if (chunk.content.toLowerCase().includes(token)) {
          nextScore += 1;
        }
        return nextScore;
      }, 0),
    }))
    .sort((left, right) => right.score - left.score || left.origIndex - right.origIndex)
    .slice(0, MAX_RELEVANT_CHUNKS)
    .map(({ origIndex: _origIndex, score: _score, ...chunk }) => chunk);
}
