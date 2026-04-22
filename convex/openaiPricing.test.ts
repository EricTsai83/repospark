import { describe, expect, test } from 'vitest';
import { estimateCostUsd } from './lib/openaiPricing';

describe('estimateCostUsd', () => {
  test('calculates cost for a priced model', () => {
    expect(estimateCostUsd('gpt-4o-mini', 1_000_000, 500_000)).toBeCloseTo(0.45);
  });

  test('returns undefined when pricing is unavailable', () => {
    expect(estimateCostUsd('unknown-model', 1_000, 2_000)).toBeUndefined();
  });

  test('returns undefined when usage is incomplete', () => {
    expect(estimateCostUsd('gpt-4o-mini', undefined, 2_000)).toBeUndefined();
    expect(estimateCostUsd('gpt-4o-mini', 1_000, undefined)).toBeUndefined();
  });
});
