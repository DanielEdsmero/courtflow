import { describe, it, expect } from 'vitest';
import {
  normalizeTimestamp,
  durationBetween,
  formatRelative,
  formatSpan,
  formatDuration,
  matchEndsAt,
  toEpochMs,
  TIME_UNAVAILABLE,
  MAX_FUTURE_SKEW_MS,
} from './time.js';

// One fixed instant for the whole file. Nothing here reads a real clock.
const T = Date.parse('2026-08-18T10:00:00.000Z');
const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

/* ── normalisation ───────────────────────────── */
describe('normalizeTimestamp', () => {
  it('passes epoch milliseconds through untouched', () => {
    const r = normalizeTimestamp(T);
    expect(r).toMatchObject({ ms: T, ok: true, source: 'ms' });
  });

  it('parses an ISO-8601 UTC string to the same instant', () => {
    expect(normalizeTimestamp('2026-08-18T10:00:00.000Z').ms).toBe(T);
  });

  it('converts a legacy epoch-second value exactly once', () => {
    const r = normalizeTimestamp(Math.floor(T / 1000));
    expect(r.source).toBe('seconds');
    expect(r.ms).toBe(T);
  });

  it('normalises ISO, epoch ms and legacy epoch seconds to one instant', () => {
    const iso = normalizeTimestamp('2026-08-18T10:00:00.000Z').ms;
    const ms = normalizeTimestamp(T).ms;
    const secs = normalizeTimestamp(T / 1000).ms;
    expect(new Set([iso, ms, secs]).size).toBe(1);
  });

  it('reads a number that came back from Postgres as a string', () => {
    expect(normalizeTimestamp(String(T)).ms).toBe(T);
    expect(normalizeTimestamp(String(Math.floor(T / 1000))).ms).toBe(T);
  });

  it('rejects missing, NaN and unparseable values with a stated reason', () => {
    for (const bad of [null, undefined, '', NaN, 'not-a-date', {}]) {
      const r = normalizeTimestamp(bad);
      expect(r.ok).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });

  it('rejects a number far too small to be any real date', () => {
    // A duration or a counter written into a timestamp field.
    const r = normalizeTimestamp(600_000);
    expect(r.ok).toBe(false);
    expect(r.source).toBe('invalid');
  });

  it('tolerates small clock skew but rejects a clearly future timestamp', () => {
    expect(normalizeTimestamp(T + MAX_FUTURE_SKEW_MS - SEC, { now: T }).ok).toBe(true);
    const far = normalizeTimestamp(T + HOUR, { now: T });
    expect(far.ok).toBe(false);
    expect(far.source).toBe('future');
  });

  it('does not rewrite a genuinely old record', () => {
    const nineteenHoursAgo = T - 19 * HOUR;
    expect(normalizeTimestamp(nineteenHoursAgo, { now: T }).ms).toBe(nineteenHoursAgo);
  });

  it('toEpochMs is the same conversion, unwrapped', () => {
    expect(toEpochMs('2026-08-18T10:00:00.000Z')).toBe(T);
    expect(toEpochMs('nonsense')).toBeNull();
  });
});

/* ── the relative-time ladder ────────────────── */
describe('formatRelative', () => {
  const at = (offset) => formatRelative(T + offset, T).text;

  it('walks the full ladder from a group created at a known instant', () => {
    expect(at(30 * SEC)).toBe('Just now');
    expect(at(61 * SEC)).toBe('1m');
    expect(at(59 * MIN)).toBe('59m');
    expect(at(60 * MIN)).toBe('1h 0m');
    expect(at(26 * HOUR)).toBe('1d 2h');
  });

  it('never says "0 min" on a group that has only just been created', () => {
    expect(at(0)).toBe('Just now');
    expect(at(59 * SEC)).toBe('Just now');
  });

  it('rolls a long wait up to hours instead of a four-digit minute count', () => {
    // The reported bug: a group left from the night before read "1139 min".
    expect(at(1139 * MIN)).toBe('18h 59m');
    // 1457 min is 24h 17m — past a day, so it rolls again.
    expect(at(1457 * MIN)).toBe('1d 0h');
  });

  it('renders — with a diagnostic instead of a huge or negative duration', () => {
    for (const bad of [null, undefined, 'not-a-date', 0, T + HOUR]) {
      const r = formatRelative(T, bad);
      expect(r.text).toBe(TIME_UNAVAILABLE);
      expect(r.ok).toBe(false);
      expect(typeof r.reason).toBe('string');
      expect(r.ms).toBeNull();
    }
  });

  it('treats a timestamp inside the skew window as now, never as negative', () => {
    const r = formatRelative(T, T + 30 * SEC);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Just now');
    expect(r.ms).toBe(0);
  });

  it('reads a legacy epoch-second record as the same age as a modern one', () => {
    const created = T - 90 * MIN;
    expect(formatRelative(T, created).text).toBe('1h 30m');
    expect(formatRelative(T, created / 1000).text).toBe('1h 30m');
  });
});

/* ── spans and durations ─────────────────────── */
describe('formatSpan and formatDuration', () => {
  it('formatSpan floors, so 119 seconds is still 1m', () => {
    expect(formatSpan(119 * SEC)).toBe('1m');
  });

  it('formatDuration rounds, so an 89-second match reads as 1m', () => {
    expect(formatDuration(89 * SEC)).toBe('1m');
  });

  it('formatDuration says 0m rather than "Just now" — a finished thing has a length', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(20 * SEC)).toBe('0m');
  });

  it('both roll up past an hour and past a day', () => {
    expect(formatSpan(75 * MIN)).toBe('1h 15m');
    expect(formatDuration(75 * MIN)).toBe('1h 15m');
    expect(formatSpan(50 * HOUR)).toBe('2d 2h');
    expect(formatDuration(50 * HOUR)).toBe('2d 2h');
  });

  it('refuses to render a negative or non-finite span', () => {
    expect(formatSpan(-1)).toBe(TIME_UNAVAILABLE);
    expect(formatSpan(NaN)).toBe(TIME_UNAVAILABLE);
    expect(formatDuration(NaN)).toBe(TIME_UNAVAILABLE);
  });
});

/* ── durations between two persisted timestamps ── */
describe('durationBetween', () => {
  it('measures a short session correctly', () => {
    const r = durationBetween(T, T + 7 * MIN, { now: T + 7 * MIN });
    expect(r.ok).toBe(true);
    expect(formatDuration(r.ms)).toBe('7m');
  });

  it('does not turn a five-minute visit into a fifty-year one', () => {
    // The unit-mismatch bug: check-in stored in seconds, checkout in ms.
    const checkedInSeconds = (T - 5 * MIN) / 1000;
    const r = durationBetween(checkedInSeconds, T, { now: T });
    expect(r.ok).toBe(true);
    expect(formatDuration(r.ms)).toBe('5m');
  });

  it('reports rather than invents when either end is untrustworthy', () => {
    expect(durationBetween(null, T).ok).toBe(false);
    expect(durationBetween(T, 'nonsense').ok).toBe(false);
    const backwards = durationBetween(T, T - MIN);
    expect(backwards.ok).toBe(false);
    expect(backwards.reason).toMatch(/precedes/);
    expect(backwards.ms).toBeNull();
  });

  it('survives a session reload — the same stored values give the same answer', () => {
    const checkedInAt = T - 42 * MIN;
    const live = durationBetween(checkedInAt, T, { now: T });
    // What a reload sees: the very same numbers, read back out of the blob.
    const reloaded = durationBetween(JSON.parse(JSON.stringify(checkedInAt)), T, { now: T });
    expect(reloaded.ms).toBe(live.ms);
    expect(formatDuration(reloaded.ms)).toBe('42m');
  });
});

/* ── fixed-length court sessions ─────────────── */
describe('matchEndsAt', () => {
  it('ends a 10-minute court exactly 600000 ms after its assignedAt', () => {
    expect(matchEndsAt(T, 10) - T).toBe(600_000);
  });

  it('is computed once from assignedAt, not re-derived from the clock', () => {
    // Whatever "now" is when the card renders, the end time does not move.
    expect(matchEndsAt(T, 10, { now: T })).toBe(matchEndsAt(T, 10, { now: T + 5 * MIN }));
  });

  it('leaves an open-ended session with no end time', () => {
    expect(matchEndsAt(T, null)).toBeNull();
    expect(matchEndsAt(T, 0)).toBeNull();
  });

  it('returns null rather than a bogus end time for an untrustworthy start', () => {
    expect(matchEndsAt('nonsense', 10)).toBeNull();
    expect(matchEndsAt(null, 10)).toBeNull();
  });
});
