export type OpenAIPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

// Snapshot pricing table for models we currently expect to use.
// Missing entries should not break the chat flow; callers can treat
// `undefined` as "cost unavailable for this model/version".
const PRICING: Record<string, OpenAIPricing> = {
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
  'gpt-4o': {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
  },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  const pricing = PRICING[model];
  if (!pricing || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}
