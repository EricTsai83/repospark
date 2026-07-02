/**
 * Constant-time string comparison for use on authentication boundaries
 * (webhook HMAC/signature verification, secret comparison). Exists to avoid
 * timing side-channels: comparing byte-by-byte with an early `return false`
 * on the first mismatch lets an attacker infer how many leading characters
 * they guessed correctly from response latency.
 *
 * The XOR-accumulate loop below must never gain an early exit on content —
 * only the length check may return early, since length is not considered
 * sensitive here.
 *
 * Kept dependency-free (no Node `crypto.timingSafeEqual`) because this
 * module is imported from `convex/http.ts`, which runs in the default
 * Convex runtime and does not have access to Node built-ins.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
