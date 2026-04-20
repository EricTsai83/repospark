export type DeepModeSandboxLike = {
  status: 'provisioning' | 'ready' | 'stopped' | 'archived' | 'failed';
  ttlExpiresAt: number;
  remoteId?: string;
  repoPath?: string;
};

export type DeepModeUnavailableCode =
  | 'missing_sandbox'
  | 'sandbox_unavailable'
  | 'sandbox_expired'
  | 'sandbox_provisioning';

export type DeepModeAvailability = {
  available: boolean;
  reasonCode: 'available' | DeepModeUnavailableCode;
  message: string | null;
};

export function getDeepModeAvailability(
  sandbox: DeepModeSandboxLike | null | undefined,
  now = Date.now(),
): DeepModeAvailability {
  if (!sandbox) {
    return {
      available: false,
      reasonCode: 'missing_sandbox',
      message:
        'Deep analysis is unavailable because no sandbox is ready for this repository yet. Sync the repository to provision one.',
    };
  }

  if (sandbox.status === 'archived' || sandbox.status === 'failed') {
    return {
      available: false,
      reasonCode: 'sandbox_unavailable',
      message:
        'Deep analysis is unavailable because the sandbox is no longer available. Sync the repository to provision a fresh sandbox.',
    };
  }

  if (now > sandbox.ttlExpiresAt) {
    return {
      available: false,
      reasonCode: 'sandbox_expired',
      message:
        'Deep analysis is unavailable because the sandbox expired. Sync the repository to provision a fresh sandbox.',
    };
  }

  if (!sandbox.remoteId || !sandbox.repoPath) {
    return {
      available: false,
      reasonCode: 'sandbox_provisioning',
      message:
        'Deep analysis is unavailable because the sandbox is still provisioning. Wait for the import to finish or sync the repository again.',
    };
  }

  return {
    available: true,
    reasonCode: 'available',
    message: null,
  };
}

export function getDeepModeUnavailableReason(
  sandbox: DeepModeSandboxLike | null | undefined,
  now = Date.now(),
) {
  return getDeepModeAvailability(sandbox, now).message;
}

export function isDeepModeAvailable(
  sandbox: DeepModeSandboxLike | null | undefined,
  now = Date.now(),
) {
  return getDeepModeAvailability(sandbox, now).available;
}
