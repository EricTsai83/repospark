import type { Id } from '../../convex/_generated/dataModel';

export type RepositoryId = Id<'repositories'>;
export type ThreadId = Id<'threads'>;
export type MessageId = Id<'messages'>;
export type ChatMode = 'fast' | 'deep';

export type ActiveMessageStream = {
  assistantMessageId: MessageId;
  content: string;
  startedAt: number;
  lastAppendedAt: number;
};

export type DeepModeReasonCode =
  | 'available'
  | 'missing_sandbox'
  | 'sandbox_unavailable'
  | 'sandbox_expired'
  | 'sandbox_provisioning';

export type DeepModeStatus = {
  reasonCode: DeepModeReasonCode;
  message: string | null;
};
