/* ─────────────────────────────────────────────
   TIME
   One canonical timestamp representation for the whole app: an epoch
   MILLISECOND NUMBER. Everything persisted — check-in, queue-group creation,
   court assignment, match start and finish, checkout, activity-log entries —
   is written in that shape, and everything that reads a timestamp comes through
   here first.

   Pure and clock-free: every function that needs the current time takes `now`
   as an argument. Nothing in this file calls Date.now().

   Why a module rather than a helper per screen: the queue card, the checkout
   sheet and the activity log each used to do their own subtraction, so a value
   in the wrong unit produced a different wrong answer on each screen and none
   of them could tell you it had happened.
   ───────────────────────────────────────────── */

// What a broken timestamp renders as. Never a number — a wrong duration reads as
// fact, where a dash reads as "we don't know", which is the truth.
export const TIME_UNAVAILABLE = '—';

/* Deciding what a bare number means. A real epoch-millisecond timestamp for any
   date this app will ever see is >= 1e11 (1973); a real epoch-SECOND timestamp is
   between 1e8 (1973) and 1e11. The two ranges do not overlap, so a legacy value
   written in seconds can be recognised and converted exactly once — the failure
   we are guarding against is a 55-year-old check-in time, not an ambiguous one. */
const MS_FLOOR = 1e11;
const SECONDS_FLOOR = 1e8;

// A timestamp a little ahead of `now` is clock skew between the front-desk
// tablet and the server, not corruption. Beyond this it cannot be explained and
// must not be allowed to become a negative duration.
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/* Normalise any persisted timestamp to epoch ms.
   → { ms, ok, source, reason }
     source: 'ms' | 'seconds' | 'iso' | 'missing' | 'invalid' | 'future'
   `reason` is staff-facing diagnostic text, present only when ok is false.

   Deliberately does NOT rewrite the stored record. A group that really was
   created nineteen hours ago is nineteen hours old, and normalisation must not
   become an excuse to quietly reset it. */
export function normalizeTimestamp(value, { now = null } = {}) {
  if (value === null || value === undefined || value === '') {
    return { ms: null, ok: false, source: 'missing', reason: 'no timestamp recorded' };
  }

  let n = null;
  let source = null;

  if (typeof value === 'number') {
    n = value;
    source = 'number';
  } else if (value instanceof Date) {
    n = value.getTime();
    source = 'iso';
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      // A number that survived a JSON round-trip through Postgres as a string.
      n = Number(trimmed);
      source = 'number';
    } else {
      n = Date.parse(trimmed);
      source = 'iso';
    }
  } else {
    return { ms: null, ok: false, source: 'invalid', reason: `unsupported type ${typeof value}` };
  }

  if (!Number.isFinite(n)) {
    return { ms: null, ok: false, source: 'invalid', reason: 'not a parseable date' };
  }

  if (source === 'number') {
    const abs = Math.abs(n);
    if (abs >= MS_FLOOR) {
      source = 'ms';
    } else if (abs >= SECONDS_FLOOR) {
      n *= 1000; // legacy epoch seconds — converted once, on read
      source = 'seconds';
    } else {
      // Too small to be any real date. Almost always a duration or a counter
      // that was written into a timestamp field by mistake.
      return { ms: null, ok: false, source: 'invalid', reason: `implausible epoch value ${n}` };
    }
  }

  if (now != null && n > now + MAX_FUTURE_SKEW_MS) {
    return { ms: n, ok: false, source: 'future', reason: 'timestamp is in the future' };
  }

  return { ms: n, ok: true, source, reason: null };
}

// Convenience for writers: whatever you have, store this.
export const toEpochMs = (value, opts) => normalizeTimestamp(value, opts).ms;

/* Elapsed milliseconds between two persisted timestamps, both normalised.
   → { ms, ok, reason }. A pair that cannot be trusted returns ok:false rather
   than a plausible-looking number. */
export function durationBetween(startRaw, endRaw, { now = null } = {}) {
  const start = normalizeTimestamp(startRaw, { now });
  const end = normalizeTimestamp(endRaw, { now });
  if (!start.ok) return { ms: null, ok: false, reason: `start: ${start.reason}` };
  if (!end.ok) return { ms: null, ok: false, reason: `end: ${end.reason}` };
  const ms = end.ms - start.ms;
  if (ms < 0) return { ms: null, ok: false, reason: 'end precedes start' };
  return { ms, ok: true, reason: null };
}

/* How long ago something happened, as a compact label:

     0–59s     Just now
     1–59m     7m
     1–23h     2h 14m
     24h+      1d 2h

   Sub-minute reads as "Just now" rather than "0m", because a group that has just
   been created has not been waiting — and "0 min" on a fresh card is the kind of
   detail that makes staff distrust every other number on the screen. */
export function formatRelative(now, raw) {
  const t = normalizeTimestamp(raw, { now });
  if (!t.ok) return { text: TIME_UNAVAILABLE, ok: false, reason: t.reason, ms: null };

  // Inside the skew window a future timestamp reads as "now", never as negative.
  const ms = Math.max(0, now - t.ms);
  return { text: formatSpan(ms), ok: true, reason: null, ms };
}

// The same ladder, for a duration already held in milliseconds.
export function formatSpan(ms) {
  if (!Number.isFinite(ms) || ms < 0) return TIME_UNAVAILABLE;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'Just now';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/* A completed span — a session length, a match length. Differs from formatSpan
   in one way that matters: it never says "Just now", because a finished thing has
   a length, and a match that lasted forty seconds lasted "0m". Rounds to the
   nearest minute, so an 89-second game reads as 1m. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return TIME_UNAVAILABLE;
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/* When a fixed-length match ends. One calculation, in one place: a 10-minute
   court assigned at T ends at exactly T + 600000, and the court card counts down
   to that number rather than re-deriving it on every render. */
export function matchEndsAt(assignedAtRaw, durationMin, { now = null } = {}) {
  if (!durationMin) return null; // an open-ended session has no end
  const t = normalizeTimestamp(assignedAtRaw, { now });
  if (!t.ok) return null;
  return t.ms + durationMin * 60_000;
}
