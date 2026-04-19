import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const repositoryStatus = v.union(
  v.literal('idle'),
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

const importStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

const jobKind = v.union(
  v.literal('import'),
  v.literal('index'),
  v.literal('deep_analysis'),
  v.literal('chat'),
  v.literal('cleanup'),
);

const jobStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);

const sandboxStatus = v.union(
  v.literal('provisioning'),
  v.literal('ready'),
  v.literal('stopped'),
  v.literal('archived'),
  v.literal('failed'),
);

const artifactKind = v.union(
  v.literal('manifest'),
  v.literal('readme_summary'),
  v.literal('architecture'),
  v.literal('entrypoints'),
  v.literal('dependency_overview'),
  v.literal('deep_analysis'),
  v.literal('risk_report'),
);

const threadMode = v.union(v.literal('fast'), v.literal('deep'));

const messageRole = v.union(
  v.literal('system'),
  v.literal('user'),
  v.literal('assistant'),
  v.literal('tool'),
);

const messageStatus = v.union(
  v.literal('pending'),
  v.literal('streaming'),
  v.literal('completed'),
  v.literal('failed'),
);

export default defineSchema({
  repositories: defineTable({
    ownerTokenIdentifier: v.string(),
    sourceHost: v.literal('github'),
    sourceUrl: v.string(),
    sourceRepoFullName: v.string(),
    sourceRepoOwner: v.string(),
    sourceRepoName: v.string(),
    defaultBranch: v.optional(v.string()),
    visibility: v.union(v.literal('public'), v.literal('private'), v.literal('unknown')),
    accessMode: v.union(v.literal('public'), v.literal('private')),
    importStatus: repositoryStatus,
    latestImportId: v.optional(v.id('imports')),
    latestImportJobId: v.optional(v.id('jobs')),
    latestAnalysisJobId: v.optional(v.id('jobs')),
    latestSandboxId: v.optional(v.id('sandboxes')),
    defaultThreadId: v.optional(v.id('threads')),
    summary: v.optional(v.string()),
    readmeSummary: v.optional(v.string()),
    architectureSummary: v.optional(v.string()),
    detectedLanguages: v.array(v.string()),
    packageManagers: v.array(v.string()),
    entrypoints: v.array(v.string()),
    lastImportedAt: v.optional(v.number()),
    lastIndexedAt: v.optional(v.number()),
    lastSyncedCommitSha: v.optional(v.string()),
    latestRemoteSha: v.optional(v.string()),
    lastCheckedForUpdatesAt: v.optional(v.number()),
  })
    .index('by_ownerTokenIdentifier', ['ownerTokenIdentifier'])
    .index('by_ownerTokenIdentifier_and_sourceUrl', ['ownerTokenIdentifier', 'sourceUrl'])
    .index('by_sourceRepoFullName', ['sourceRepoFullName']),

  imports: defineTable({
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    sourceUrl: v.string(),
    branch: v.optional(v.string()),
    adapterKind: v.union(v.literal('git_clone'), v.literal('source_service')),
    status: importStatus,
    jobId: v.id('jobs'),
    sandboxId: v.optional(v.id('sandboxes')),
    remoteSandboxId: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index('by_repositoryId', ['repositoryId'])
    .index('by_jobId', ['jobId'])
    .index('by_ownerTokenIdentifier', ['ownerTokenIdentifier']),

  sandboxes: defineTable({
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    provider: v.literal('daytona'),
    sourceAdapter: v.union(v.literal('git_clone'), v.literal('source_service')),
    remoteId: v.string(),
    status: sandboxStatus,
    workDir: v.string(),
    repoPath: v.string(),
    cpuLimit: v.number(),
    memoryLimitGiB: v.number(),
    diskLimitGiB: v.number(),
    ttlExpiresAt: v.number(),
    autoStopIntervalMinutes: v.number(),
    autoArchiveIntervalMinutes: v.number(),
    autoDeleteIntervalMinutes: v.number(),
    networkBlockAll: v.boolean(),
    networkAllowList: v.optional(v.string()),
    lastHeartbeatAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    lastErrorMessage: v.optional(v.string()),
  })
    .index('by_repositoryId', ['repositoryId'])
    .index('by_remoteId', ['remoteId'])
    .index('by_status_and_ttlExpiresAt', ['status', 'ttlExpiresAt']),

  jobs: defineTable({
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    sandboxId: v.optional(v.id('sandboxes')),
    threadId: v.optional(v.id('threads')),
    kind: jobKind,
    status: jobStatus,
    stage: v.string(),
    progress: v.number(),
    costCategory: v.union(v.literal('indexing'), v.literal('deep_analysis'), v.literal('chat'), v.literal('ops')),
    triggerSource: v.union(v.literal('user'), v.literal('system')),
    requestedCommand: v.optional(v.string()),
    outputSummary: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    estimatedInputTokens: v.optional(v.number()),
    estimatedOutputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index('by_repositoryId', ['repositoryId'])
    .index('by_repositoryId_and_status', ['repositoryId', 'status'])
    .index('by_threadId', ['threadId'])
    .index('by_ownerTokenIdentifier', ['ownerTokenIdentifier']),

  analysisArtifacts: defineTable({
    repositoryId: v.id('repositories'),
    jobId: v.optional(v.id('jobs')),
    ownerTokenIdentifier: v.string(),
    kind: artifactKind,
    title: v.string(),
    summary: v.string(),
    contentMarkdown: v.string(),
    source: v.union(v.literal('heuristic'), v.literal('llm'), v.literal('sandbox')),
    version: v.number(),
  })
    .index('by_repositoryId', ['repositoryId'])
    .index('by_repositoryId_and_kind', ['repositoryId', 'kind'])
    .index('by_jobId', ['jobId']),

  repoFiles: defineTable({
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    importId: v.id('imports'),
    path: v.string(),
    parentPath: v.string(),
    fileType: v.union(v.literal('file'), v.literal('dir')),
    extension: v.optional(v.string()),
    language: v.optional(v.string()),
    sizeBytes: v.number(),
    isEntryPoint: v.boolean(),
    isConfig: v.boolean(),
    isImportant: v.boolean(),
    summary: v.optional(v.string()),
  })
    .index('by_repositoryId_and_path', ['repositoryId', 'path'])
    .index('by_repositoryId_and_parentPath', ['repositoryId', 'parentPath'])
    .index('by_importId', ['importId']),

  repoChunks: defineTable({
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    importId: v.id('imports'),
    fileId: v.id('repoFiles'),
    path: v.string(),
    chunkIndex: v.number(),
    startLine: v.number(),
    endLine: v.number(),
    chunkKind: v.union(v.literal('code'), v.literal('summary'), v.literal('readme')),
    symbolName: v.optional(v.string()),
    symbolKind: v.optional(v.string()),
    summary: v.string(),
    content: v.string(),
  })
    .index('by_repositoryId_and_path', ['repositoryId', 'path'])
    .index('by_fileId_and_chunkIndex', ['fileId', 'chunkIndex'])
    .index('by_repositoryId_and_symbolName', ['repositoryId', 'symbolName']),

  threads: defineTable({
    repositoryId: v.id('repositories'),
    ownerTokenIdentifier: v.string(),
    title: v.string(),
    mode: threadMode,
    lastMessageAt: v.number(),
    lastAssistantMessageAt: v.optional(v.number()),
  })
    .index('by_repositoryId_and_lastMessageAt', ['repositoryId', 'lastMessageAt'])
    .index('by_ownerTokenIdentifier_and_lastMessageAt', ['ownerTokenIdentifier', 'lastMessageAt']),

  messages: defineTable({
    repositoryId: v.id('repositories'),
    threadId: v.id('threads'),
    jobId: v.optional(v.id('jobs')),
    ownerTokenIdentifier: v.string(),
    role: messageRole,
    status: messageStatus,
    mode: threadMode,
    content: v.string(),
    errorMessage: v.optional(v.string()),
    estimatedInputTokens: v.optional(v.number()),
    estimatedOutputTokens: v.optional(v.number()),
  })
    .index('by_threadId', ['threadId'])
    .index('by_threadId_and_status', ['threadId', 'status'])
    .index('by_jobId', ['jobId']),

  githubInstallations: defineTable({
    ownerTokenIdentifier: v.string(),
    installationId: v.number(),
    accountLogin: v.string(),
    accountType: v.union(v.literal('User'), v.literal('Organization')),
    status: v.union(v.literal('active'), v.literal('suspended'), v.literal('deleted')),
    repositorySelection: v.union(v.literal('all'), v.literal('selected')),
    connectedAt: v.number(),
    suspendedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_ownerTokenIdentifier', ['ownerTokenIdentifier'])
    .index('by_ownerTokenIdentifier_and_status', ['ownerTokenIdentifier', 'status'])
    .index('by_installationId', ['installationId']),

  githubOAuthStates: defineTable({
    state: v.string(),
    ownerTokenIdentifier: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    consumed: v.boolean(),
  })
    .index('by_state', ['state']),
});
