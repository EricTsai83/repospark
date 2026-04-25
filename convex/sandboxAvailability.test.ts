import { describe, expect, test } from 'vitest';
import { getSandboxAvailability, getSandboxModeStatus } from './lib/sandboxAvailability';

describe('getSandboxModeStatus', () => {
  test('returns only the public status fields while matching availability semantics', () => {
    const sandbox = {
      status: 'ready' as const,
      ttlExpiresAt: 10_000,
      remoteId: 'remote-1',
      repoPath: '/workspace/repo',
    };

    const availability = getSandboxAvailability(sandbox, 5_000);
    const status = getSandboxModeStatus(sandbox, 5_000);

    expect(status).toEqual({
      reasonCode: 'available',
      message: null,
    });
    expect(status).toEqual({
      reasonCode: availability.reasonCode,
      message: availability.message,
    });
    expect(Object.keys(status).sort()).toEqual(['message', 'reasonCode']);
  });
});
