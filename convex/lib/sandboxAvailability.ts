export type DeepModeSandboxLike = {
  status: 'provisioning' | 'ready' | 'stopped' | 'archived' | 'failed';
  ttlExpiresAt: number;
  remoteId?: string;
  repoPath?: string;
};

export function getDeepModeUnavailableReason(
  sandbox: DeepModeSandboxLike | null | undefined,
  now = Date.now(),
) {
  if (!sandbox) {
    return 'Deep analysis is unavailable because no sandbox is ready for this repository yet. Sync the repository to provision one.';
  }

  if (sandbox.status === 'archived' || sandbox.status === 'failed') {
    return 'Deep analysis is unavailable because the sandbox is no longer available. Sync the repository to provision a fresh sandbox.';
  }

  if (now > sandbox.ttlExpiresAt) {
    return 'Deep analysis is unavailable because the sandbox expired. Sync the repository to provision a fresh sandbox.';
  }

  if (!sandbox.remoteId || !sandbox.repoPath) {
    return 'Deep analysis is unavailable because the sandbox is still provisioning. Wait for the import to finish or sync the repository again.';
  }

  return null;
}

export function isDeepModeAvailable(
  sandbox: DeepModeSandboxLike | null | undefined,
  now = Date.now(),
) {
  return getDeepModeUnavailableReason(sandbox, now) === null;
}
