import type { Id } from '../../convex/_generated/dataModel';

export type RepositoryId = Id<'repositories'>;
export type ThreadId = Id<'threads'>;
export type ChatMode = 'fast' | 'deep';

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
