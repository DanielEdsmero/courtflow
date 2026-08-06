/* ─────────────────────────────────────────────
   DEVICE PREFERENCES
   Animations and sound are per-DEVICE, not per-club: the tablet at the front
   desk and the laptop in the office can reasonably disagree, and one staff
   member muting the desk should not silence everyone. So these live in
   localStorage rather than in the venue's session blob.
   ───────────────────────────────────────────── */

const KEY = 'courtflow:prefs';

export const DEFAULT_PREFS = { animations: true, sound: true };

// Someone who has asked their OS to reduce motion has already answered the
// animations question. Used only to pick the FIRST-RUN default — once they
// touch the toggle, their explicit choice is what is stored and honoured.
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Tolerant by design: a missing key, malformed JSON, or a blob written by an
// older version all fall back to the defaults rather than throwing on boot.
export function loadPrefs() {
  const fallback = { ...DEFAULT_PREFS, animations: !prefersReducedMotion() };
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return fallback;
    return {
      animations: typeof saved.animations === 'boolean' ? saved.animations : fallback.animations,
      sound: typeof saved.sound === 'boolean' ? saved.sound : fallback.sound,
    };
  } catch {
    return fallback; // private mode, quota, or corrupt value
  }
}

// Never throws: failing to remember a preference is not worth breaking a click
// over, and the in-memory state is already correct by the time this runs.
export function savePrefs(prefs) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      animations: !!prefs.animations,
      sound: !!prefs.sound,
    }));
  } catch {
    /* ignore */
  }
}
