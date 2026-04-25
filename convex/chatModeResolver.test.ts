import { describe, expect, test } from 'vitest';
import {
  getDefaultThreadMode,
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
    name: 'no repo + no sandbox: only discuss available, docs+sandbox disabled with unlock hints',
    hasAttachedRepo: false,
    sandboxStatus: 'none',
    expectedAvailableModes: ['discuss'],
    expectedDefaultMode: 'discuss',
    expectedDisabledModes: ['docs', 'sandbox'],
  },
  {
    name: 'no repo + provisioning sandbox: sandbox status ignored, docs+sandbox still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'provisioning',
    expectedAvailableModes: ['discuss'],
    expectedDefaultMode: 'discuss',
    expectedDisabledModes: ['docs', 'sandbox'],
  },
  {
    name: 'no repo + ready sandbox: sandbox status ignored, docs+sandbox still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'ready',
    expectedAvailableModes: ['discuss'],
    expectedDefaultMode: 'discuss',
    expectedDisabledModes: ['docs', 'sandbox'],
  },
  {
    name: 'no repo + expired sandbox: sandbox status ignored, docs+sandbox still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'expired',
    expectedAvailableModes: ['discuss'],
    expectedDefaultMode: 'discuss',
    expectedDisabledModes: ['docs', 'sandbox'],
  },
  {
    name: 'no repo + failed sandbox: sandbox status ignored, docs+sandbox still disabled',
    hasAttachedRepo: false,
    sandboxStatus: 'failed',
    expectedAvailableModes: ['discuss'],
    expectedDefaultMode: 'discuss',
    expectedDisabledModes: ['docs', 'sandbox'],
  },
  {
    name: 'repo + no sandbox: discuss+docs available, sandbox disabled (no sandbox)',
    hasAttachedRepo: true,
    sandboxStatus: 'none',
    expectedAvailableModes: ['discuss', 'docs'],
    expectedDefaultMode: 'docs',
    expectedDisabledModes: ['sandbox'],
  },
  {
    name: 'repo + provisioning sandbox: discuss+docs available, sandbox disabled (provisioning)',
    hasAttachedRepo: true,
    sandboxStatus: 'provisioning',
    expectedAvailableModes: ['discuss', 'docs'],
    expectedDefaultMode: 'docs',
    expectedDisabledModes: ['sandbox'],
  },
  {
    name: 'repo + ready sandbox: all three available, default still docs (sandbox is opt-in)',
    hasAttachedRepo: true,
    sandboxStatus: 'ready',
    expectedAvailableModes: ['discuss', 'docs', 'sandbox'],
    expectedDefaultMode: 'docs',
    expectedDisabledModes: [],
  },
  {
    name: 'repo + expired sandbox: discuss+docs available, sandbox disabled (expired)',
    hasAttachedRepo: true,
    sandboxStatus: 'expired',
    expectedAvailableModes: ['discuss', 'docs'],
    expectedDefaultMode: 'docs',
    expectedDisabledModes: ['sandbox'],
  },
  {
    name: 'repo + failed sandbox: discuss+docs available, sandbox disabled (failed)',
    hasAttachedRepo: true,
    sandboxStatus: 'failed',
    expectedAvailableModes: ['discuss', 'docs'],
    expectedDefaultMode: 'docs',
    expectedDisabledModes: ['sandbox'],
  },
];

describe('resolveChatModes', () => {
  test('getDefaultThreadMode centralizes the repo-attached default-mode rule', () => {
    expect(getDefaultThreadMode(false)).toBe('discuss');
    expect(getDefaultThreadMode(true)).toBe('docs');
  });

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

  test('sandbox disabled reasons differ across sandbox states when a repo is attached', () => {
    // Sanity check: each non-ready sandbox state should give a distinct
    // sandbox-mode hint so the UI tooltip can guide the user to the right
    // next step.
    const provisioning = resolveChatModes(true, 'provisioning').disabledReasons.sandbox;
    const failed = resolveChatModes(true, 'failed').disabledReasons.sandbox;
    const expired = resolveChatModes(true, 'expired').disabledReasons.sandbox;
    const noSandbox = resolveChatModes(true, 'none').disabledReasons.sandbox;

    const reasons = [provisioning, failed, expired, noSandbox];
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) {
      expect(reason).toBeTruthy();
    }
  });
});
