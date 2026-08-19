/* ─────────────────────────────────────────────
   WAIT ESTIMATES
   How long until a waiting group is called. Pure, framework-free, and clock-free:
   `now` is always an argument, nothing here mutates its inputs, and nothing here
   touches the queue, the courts, the ordering or the matcher.

   The whole design is a refusal to guess. An estimate is only produced when the
   facility state can actually support one — a real remaining time on a real
   court, a configured duration, a known position in the queue. Everything else
   returns an honest status instead of a number, because a wrong minute count on
   a phone is worse than no minute count: people plan around it and then feel
   lied to.

   Estimates are per GROUP, not per person. Four players called together wait the
   same length of time, and the player page reads its number off whichever group
   the player is in.
   ───────────────────────────────────────────── */

import { normalizeTimestamp } from './time';

/* Beyond this many minutes the range stops being useful and starts being
   discouraging noise. "90+" is the honest end of the scale. */
export const RANGE_CAP_MIN = 90;

const roundDown5 = (x) => Math.floor(x / 5) * 5;
const roundUp5 = (x) => Math.ceil(x / 5) * 5;

/* ─────────────────────────────────────────────
   COURT STATUS
   Four words, and the distinctions matter:

     available  no match on it, and staff could assign one
     live       a match is running
     finishing  the configured duration has elapsed and no result is in yet
     paused     no match, and the session is paused so nothing may be assigned

   A session pause does NOT stop a running match's clock — the players are still
   on court and still playing. And a court with no configured duration is never
   `finishing`, because an open-ended session has no moment at which it is due.

   `Paused` beats `available`: a free court in a paused session cannot be
   assigned, so calling it available would be a lie staff would act on.
   ───────────────────────────────────────────── */
export function courtStatusOf(court, sessionState = 'open', now = 0) {
  const match = court?.match;
  if (match) {
    const started = normalizeTimestamp(match.startedAt, { now });
    const dur = Number(match.durationMin);
    if (started.ok && Number.isFinite(dur) && dur > 0) {
      const endsAt = started.ms + dur * 60_000;
      return now >= endsAt ? 'finishing' : 'live';
    }
    return 'live'; // open-ended, or a start time we cannot trust
  }
  return sessionState === 'paused' ? 'paused' : 'available';
}

// Minutes left on a court, rounded up so 30 seconds reads as 1 rather than 0.
// Null when the court is not running a timed match we can measure.
export function remainingMinutes(court, now = 0) {
  const match = court?.match;
  if (!match) return null;
  const started = normalizeTimestamp(match.startedAt, { now });
  const dur = Number(match.durationMin);
  if (!started.ok || !Number.isFinite(dur) || dur <= 0) return null;
  return Math.max(0, Math.ceil((started.ms + dur * 60_000 - now) / 60_000));
}

/* Reduce the floor to the four numbers the projection needs.

     A  courts free right now — immediate openings, allocated to the front of the
        queue before anything is projected
     C  courts that will free up (live + finishing)
     R  the SOONEST of those turnovers, in minutes. A finishing court contributes
        0: its result is already due, so it is the next thing to open, not an
        absent court.
     D  the duration the next match will be given

   Only open-play courts count. A rental never takes a queued group. */
export function estimateInputs({ courts = [], sessionState = 'open', durationMin = null, now = 0 } = {}) {
  const open = courts.filter((c) => c.type === 'open');
  let A = 0;
  let C = 0;
  let R = null;

  for (const court of open) {
    const status = courtStatusOf(court, sessionState, now);
    if (status === 'available') { A += 1; continue; }
    if (status === 'paused') continue;
    // live or finishing
    const left = status === 'finishing' ? 0 : remainingMinutes(court, now);
    if (left === null) continue; // untimed match — cannot say when it turns over
    C += 1;
    R = R === null ? left : Math.min(R, left);
  }

  const D = Number(durationMin);
  return { A, C, R, D: Number.isFinite(D) && D > 0 ? D : null };
}

/* ─────────────────────────────────────────────
   THE PROJECTION
   `G` groups are ahead of this one, so it needs opening number `n = G + 1`.
   The `A` courts standing empty take the first `A` groups immediately, leaving
   `nActive` openings that have to come from courts turning over. With `C` courts
   turning over and the soonest in `R` minutes, this group waits through
   `floor((nActive-1)/C)` full rounds before its own, and at most
   `ceil(nActive/C)`.

   The bounds are rounded outward to five minutes so the number reads as the
   approximation it is. The lower bound rounding DOWN is deliberate and slightly
   optimistic — it can land up to four minutes before the earliest real opening.
   That is a readiness signal, not a promise; the upper bound is the one that
   should be met or beaten.
   ───────────────────────────────────────────── */
export function projectedRange({ D, R, C, A = 0, G = 0 }) {
  if (!Number.isFinite(D) || D <= 0) return null;
  if (!Number.isFinite(C) || C < 1) return null;
  if (!Number.isFinite(R) || R < 0) return null;

  const nActive = G + 1 - A;
  if (nActive < 1) return null; // an empty court is already waiting for them

  const rawLower = R + Math.floor((nActive - 1) / C) * D;
  let lower = roundDown5(rawLower);
  // A turnover that is imminent, or a result already due, is "about a minute" —
  // never zero, which would read as "go on now" when nobody has come off yet.
  if (rawLower === 0 || (rawLower > 0 && rawLower < 5)) lower = 1;

  const upper = roundUp5(R + Math.ceil(nActive / C) * D);
  return { lower, upper, capped: upper > RANGE_CAP_MIN };
}

/* ─────────────────────────────────────────────
   THE ANSWER
   One function, one precedence order, resolved top to bottom. Order is the whole
   point: a paused session outranks a free court, because a court you may not
   assign is not an opportunity.

   Returns a machine-readable `status` as well as `text`, so a caller can style
   or test on the state without matching on English.
   ───────────────────────────────────────────── */
export const ESTIMATE_STATUSES = [
  'none',      // no estimate is owed to this person at all
  'paused',
  'closing',
  'playing',   // a measured countdown, not a projection
  'ready',
  'range',
  'unknown',   // not enough trustworthy input to say anything
];

export const ESTIMATE_TEXT = {
  paused: 'Session paused',
  closing: 'Session closing — no new assignments',
  ready: 'Ready now — awaiting staff assignment',
  unknown: 'Waiting time will update when courts are assigned',
};

const rangeText = ({ lower, upper, capped }, G) => {
  if (capped) return `Approx. ${RANGE_CAP_MIN}+ min`;
  return G === 0
    ? `Next up — approx. ${lower}–${upper} min`
    : `Approx. ${lower}–${upper} min`;
};

/**
 * attendance : 'available' | 'queued' | 'playing' | 'unavailable' | 'checkedOut'
 * playing    : { courtName, remainingMin } for an attendee on court
 * groupsAhead: G — complete ready groups in front of this one
 */
export function callEstimate({
  sessionState = 'open',
  attendance = 'available',
  playing = null,
  groupsAhead = null,
  courts = [],
  durationMin = null,
  now = 0,
} = {}) {
  // 1. Someone sitting out or gone home is owed nothing. Showing them a wait
  //    would imply they are still in the running.
  if (attendance === 'unavailable' || attendance === 'checkedOut') {
    return { status: 'none', text: null };
  }

  // 5 (hoisted). A running match is MEASURED, not projected, and it keeps
  //    counting down through a pause, a close-down, everything. Checked before
  //    the session-state rules precisely because it is a fact rather than a
  //    forecast.
  const onCourt =
    attendance === 'playing' &&
    playing &&
    Number.isFinite(Number(playing.remainingMin)) &&
    Number(playing.remainingMin) >= 0;

  if (onCourt) {
    const mins = Number(playing.remainingMin);
    return {
      status: 'playing',
      text: `On ${playing.courtName} — about ${mins} min remaining`,
      remainingMin: mins,
    };
  }

  // 2, 3, 4. The session itself has stopped handing out courts.
  if (sessionState === 'paused') return { status: 'paused', text: ESTIMATE_TEXT.paused };
  if (sessionState === 'closed') return { status: 'none', text: null };
  if (sessionState === 'closing') return { status: 'closing', text: ESTIMATE_TEXT.closing };

  // A player on court whose remaining time we could not measure falls through to
  // here rather than being given a fabricated one.
  if (attendance === 'playing') return { status: 'unknown', text: ESTIMATE_TEXT.unknown };

  // 8 (partial). Available but not yet in a group: there is no position to
  //    project from, because Auto has not decided who they play with.
  if (attendance !== 'queued' || !Number.isFinite(Number(groupsAhead))) {
    return { status: 'unknown', text: ESTIMATE_TEXT.unknown };
  }

  const G = Number(groupsAhead);
  const { A, C, R, D } = estimateInputs({ courts, sessionState, durationMin, now });

  // 6. A court is standing empty and this group is near enough the front to take
  //    one. The only thing between them and playing is a staff tap.
  if (G < A) return { status: 'ready', text: ESTIMATE_TEXT.ready };

  // 7. Otherwise project — if the floor gives us enough to project from.
  const range = projectedRange({ D, R, C, A, G });
  if (!range) return { status: 'unknown', text: ESTIMATE_TEXT.unknown };

  return { status: 'range', text: rangeText(range, G), ...range };
}
