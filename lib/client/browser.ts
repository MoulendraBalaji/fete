'use client';

/**
 * Small browser-side utilities for plan management: downloads, the share link,
 * and clipboard access.
 *
 * These live together because they all share the same constraint — they must
 * degrade quietly. A blocked clipboard, a revoked download URL or a
 * `localStorage` that refuses writes should never break the workspace, so every
 * function reports success rather than throwing.
 */

/** Triggers a file download from a string, revoking the blob URL afterwards. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click has been processed.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Builds a `data:` URL for an .ics file (used for the direct download link). */
export function icsDataUrl(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export type CopyOutcome = 'copied' | 'shared' | 'failed';

/**
 * Copies text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden textarea (needed on insecure origins, where the async API is
 * unavailable). Returns what actually happened so the UI can be truthful.
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The device's best guess at "today" in the user's own timezone. */
export function localTodayIso(now = new Date()): string {
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

/** An absolute URL for a hash, suitable for pasting into a chat. */
export function absoluteUrl(hash: string): string {
  if (typeof window === 'undefined') return hash;
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

export function nowStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}
