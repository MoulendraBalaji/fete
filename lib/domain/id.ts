/**
 * URL-safe record ids (must satisfy `recordIdSchema` in lib/schemas/core.ts).
 * `crypto.randomUUID` is available in every supported browser and in Node 18+.
 */
export function newId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  // Deterministic-length fallback for exotic runtimes: base36 only.
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
