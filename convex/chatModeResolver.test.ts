import { describe, expect, test } from 'vitest';
import {
  resolveChatModes,
  type ChatMode,
  type ChatModeSandboxStatus,
} from './chatModeResolver';

interface ChatModeResolverCase {
  name: string;
  hasAttachedRepo: boolean;
  sandboxStatus: ChatModeSandboxStatus;
  expectedAvailableModes: ChatMode[];
  expectedDefaultMode: ChatMode;
  expectedDisabledModes: ChatMode[];
}

// PRD §"Testing Decisions" requires the full cross-product of
// (hasAttachedRepo) × (sandboxStatus ∈ {none, provisioning, ready, expired, failed}).
// That is 2 × 5 = 10 cases. The five !hasAttachedRepo rows assert that sandbox
// status is irrelevant when no repository is attached (a sandbox cannot exist
// without one in the data model, but the resolver must still be total).
const cases: ChatModeResolverCase[] = [
  {
    name: 'no repo + no sandbox: only general available, grounded+deep disabled with unlock hints',
    hasAttachedRepo: false,
    sandboxStatus: 'none',
    expectedAvailableModes: ['general'],
    expectedDefaultMode: 'general',
    expectedDisabledModes: ['grounded', 'deep'],
  },
  {
    name: 'no repo + provisioning sandbox: sandbox status ignored, grounded+deep still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'provisioning',
    expectedAvailableModes: ['general'],
    expectedDefaultMode: 'general',
    expectedDisabledModes: ['grounded', 'deep'],
  },
  {
    name: 'no repo + ready sandbox: sandbox status ignored, grounded+deep still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'ready',
    expectedAvailableModes: ['general'],
    expectedDefaultMode: 'general',
    expectedDisabledModes: ['grounded', 'deep'],
  },
  {
    name: 'no repo + expired sandbox: sandbox status ignored, grounded+deep still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'expired',
    expectedAvailableModes: ['general'],
    expectedDefaultMode: 'general',
    expectedDisabledModes: ['grounded', 'deep'],
  },
  {
    name: 'no repo + failed sandbox: sandbox status ignored, grounded+deep still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'failed',
    expectedAvailableModes: ['general'],
    expectedDefaultMode: 'general',
    expectedDisabledModes: ['grounded', 'deep'],
  },
  {
    name: 'repo + no sandbox: general+grounded available, deep disabled (no sandbox)',
    hasAttachedRepo: true,
    sandboxStatus: 'none',
    expectedAvailableModes: ['general', 'grounded'],
    expectedDefaultMode: 'grounded',
    expectedDisabledModes: ['deep'],
  },
  {
    name: 'repo + provisioning sandbox: general+grounded available, deep disabled (provisioning)',
    hasAttachedRepo: true,
    sandboxStatus: 'provisioning',
    expectedAvailableModes: ['general', 'grounded'],
    expectedDefaultMode: 'grounded',
    expectedDisabledModes: ['deep'],
  },
  {
    name: 'repo + ready sandbox: all three available, default still grounded (deep is opt-in)',
    hasAttachedRepo: true,
    sandboxStatus: 'ready',
    expectedAvailableModes: ['general', 'grounded', 'deep'],
    expectedDefaultMode: 'grounded',
    expectedDisabledModes: [],
  },
  {
    name: 'repo + expired sandbox: general+grounded available, deep disabled (expired)',
    hasAttachedRepo: true,
    sandboxStatus: 'expired',
    expectedAvailableModes: ['general', 'grounded'],
    expectedDefaultMode: 'grounded',
    expectedDisabledModes: ['deep'],
  },
  {
    name: 'repo + failed sandbox: general+grounded available, deep disabled (failed)',
    hasAttachedRepo: true,
    sandboxStatus: 'failed',
    expectedAvailableModes: ['general', 'grounded'],
    expectedDefaultMode: 'grounded',
    expectedDisabledModes: ['deep'],
  },
];

describe('resolveChatModes', () => {
  test.each(cases)('$name', (testCase) => {
    const result = resolveChatModes(testCase.hasAttachedRepo, testCase.sandboxStatus);

    expect(result.availableModes).toEqual(testCase.expectedAvailableModes);
    expect(result.defaultMode).toBe(testCase.expectedDefaultMode);

    expect(Object.keys(result.disabledReasons).sort()).toEqual(
      [...testCase.expectedDisabledModes].sort(),
    );
    for (const mode of testCase.expectedDisabledModes) {
      const reason = result.disabledReasons[mode];
      expect(reason, `disabledReasons.${mode} must be a non-empty string`).toBeTruthy();
      expect(typeof reason).toBe('string');
    }
  });

  test('default mode is always one of the available modes', () => {
    for (const testCase of cases) {
      const result = resolveChatModes(testCase.hasAttachedRepo, testCase.sandboxStatus);
      expect(result.availableModes).toContain(result.defaultMode);
    }
  });

  test('available modes and disabled-reason keys are mutually exclusive', () => {
    for (const testCase of cases) {
      const result = resolveChatModes(testCase.hasAttachedRepo, testCase.sandboxStatus);
      const availableSet = new Set(result.availableModes);
      const disabledKeys = Object.keys(result.disabledReasons) as ChatMode[];
      for (const disabled of disabledKeys) {
        expect(availableSet.has(disabled)).toBe(false);
      }
    }
  });

  test('deep disabled reasons differ across sandbox states when a repo is attached', () => {
    // Sanity check: each non-ready sandbox state should give a distinct deep-mode hint
    // so the UI tooltip can guide the user to the right next step.
    const provisioning = resolveChatModes(true, 'provisioning').disabledReasons.deep;
    const failed = resolveChatModes(true, 'failed').disabledReasons.deep;
    const expired = resolveChatModes(true, 'expired').disabledReasons.deep;
    const noSandbox = resolveChatModes(true, 'none').disabledReasons.deep;

    const reasons = [provisioning, failed, expired, noSandbox];
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) {
      expect(reason).toBeTruthy();
    }
  });
});
