export type SandboxAvailabilityInput = {
  status: 'provisioning' | 'ready' | 'stopped' | 'archived' | 'failed';
  ttlExpiresAt: number;
  remoteId?: string;
  repoPath?: string;
};

export type SandboxUnavailableCode =
  | 'missing_sandbox'
  | 'sandbox_unavailable'
  | 'sandbox_expired'
  | 'sandbox_provisioning';

export type SandboxAvailability = {
  available: boolean;
  reasonCode: 'available' | SandboxUnavailableCode;
  message: string | null;
};

export type SandboxModeStatus = Pick<SandboxAvailability, 'reasonCode' | 'message'>;

export function getSandboxAvailability(
  sandbox: SandboxAvailabilityInput | null | undefined,
  now = Date.now(),
): SandboxAvailability {
  if (!sandbox) {
    return {
      available: false,
      reasonCode: 'missing_sandbox',
      message:
        'A live sandbox is unavailable because no sandbox is ready for this repository yet. Sync the repository to provision one.',
    };
  }

  if (sandbox.status === 'archived' || sandbox.status === 'failed') {
    return {
      available: false,
      reasonCode: 'sandbox_unavailable',
      message:
        'A live sandbox is unavailable because the sandbox is no longer available. Sync the repository to provision a fresh sandbox.',
    };
  }

  if (now > sandbox.ttlExpiresAt) {
    return {
      available: false,
      reasonCode: 'sandbox_expired',
      message:
        'A live sandbox is unavailable because the sandbox expired. Sync the repository to provision a fresh sandbox.',
    };
  }

  if (!sandbox.remoteId || !sandbox.repoPath) {
    return {
      available: false,
      reasonCode: 'sandbox_provisioning',
      message:
        'A live sandbox is unavailable because the sandbox is still provisioning. Wait for the import to finish or sync the repository again.',
    };
  }

  return {
    available: true,
    reasonCode: 'available',
    message: null,
  };
}

export function getSandboxModeStatus(
  sandbox: SandboxAvailabilityInput | null | undefined,
  now = Date.now(),
): SandboxModeStatus {
  const availability = getSandboxAvailability(sandbox, now);
  return {
    reasonCode: availability.reasonCode,
    message: availability.message,
  };
}

export function getSandboxUnavailableReason(
  sandbox: SandboxAvailabilityInput | null | undefined,
  now = Date.now(),
) {
  return getSandboxAvailability(sandbox, now).message;
}

export function isSandboxAvailable(
  sandbox: SandboxAvailabilityInput | null | undefined,
  now = Date.now(),
) {
  return getSandboxAvailability(sandbox, now).available;
}
