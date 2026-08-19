import { describe, it, expect } from 'vitest';
import {
  callEstimate,
  courtStatusOf,
  estimateInputs,
  projectedRange,
  remainingMinutes,
  ESTIMATE_TEXT,
  RANGE_CAP_MIN,
} from './wait-estimate.js';

/* Every test pins `now`. Nothing here waits, and nothing here reads a clock. */
const T = Date.parse('2026-08-19T18:00:00.000Z');
const MIN = 60_000;

const court = (id, over = {}) => ({ id, name: `Court ${id}`, type: 'open', match: null, ...over });

// A court running a timed match that started `elapsedMin` ago.
const live = (id, durationMin, elapsedMin) =>
  court(id, { match: { players: ['a', 'b', 'c', 'd'], startedAt: T - elapsedMin * MIN, durationMin } });

/* ── court status ────────────────────────────── */
describe('courtStatusOf', () => {
  it('is available when nothing is on it', () => {
    expect(courtStatusOf(court(1), 'open', T)).toBe('available');
  });

  it('is live while the configured duration is still running', () => {
    expect(courtStatusOf(live(1, 15, 5), 'open', T)).toBe('live');
    expect(courtStatusOf(live(1, 15, 14), 'open', T)).toBe('live');
  });

  it('becomes finishing only once the duration has elapsed with no result in', () => {
    expect(courtStatusOf(live(1, 15, 15), 'open', T)).toBe('finishing');
    expect(courtStatusOf(live(1, 15, 40), 'open', T)).toBe('finishing');
  });

  it('keeps a running match live through a session pause — the clock does not stop', () => {
    expect(courtStatusOf(live(1, 15, 5), 'paused', T)).toBe('live');
    expect(courtStatusOf(live(1, 15, 20), 'paused', T)).toBe('finishing');
  });

  it('renders a matchless court in a paused session as paused, never available', () => {
    expect(courtStatusOf(court(1), 'paused', T)).toBe('paused');
  });

  it('never calls an open-ended match finishing — it has no moment it is due', () => {
    const openEnded = court(1, { match: { players: [], startedAt: T - 5 * 60 * MIN, durationMin: null } });
    expect(courtStatusOf(openEnded, 'open', T)).toBe('live');
  });

  it('treats an untrustworthy start time as live rather than inventing an end', () => {
    const broken = court(1, { match: { players: [], startedAt: 'nonsense', durationMin: 15 } });
    expect(courtStatusOf(broken, 'open', T)).toBe('live');
    expect(remainingMinutes(broken, T)).toBeNull();
  });
});

describe('remainingMinutes', () => {
  it('rounds up, so thirty seconds left reads as one minute', () => {
    const c = court(1, { match: { startedAt: T - 14.5 * MIN, durationMin: 15 } });
    expect(remainingMinutes(c, T)).toBe(1);
  });

  it('floors at zero for a court that is already due', () => {
    expect(remainingMinutes(live(1, 15, 40), T)).toBe(0);
  });
});

/* ── the inputs the projection runs on ───────── */
describe('estimateInputs', () => {
  it('counts free courts as A and turning-over courts as C, with R the soonest', () => {
    const courts = [court(1), live(2, 15, 5), live(3, 15, 12)];
    expect(estimateInputs({ courts, durationMin: 15, now: T })).toEqual({ A: 1, C: 2, R: 3, D: 15 });
  });

  it('counts a finishing court with R = 0 — a due result is the next opening', () => {
    const courts = [live(1, 15, 20), live(2, 15, 2)];
    const { C, R } = estimateInputs({ courts, durationMin: 15, now: T });
    expect(C).toBe(2);
    expect(R).toBe(0);
  });

  it('ignores rentals, which never take a queued group', () => {
    const courts = [court(1), { ...court(2), type: 'rental' }];
    expect(estimateInputs({ courts, durationMin: 15, now: T }).A).toBe(1);
  });

  it('drops an untimed match from C — there is no turnover to predict', () => {
    const courts = [court(1, { match: { startedAt: T, durationMin: null } })];
    expect(estimateInputs({ courts, durationMin: 15, now: T })).toMatchObject({ A: 0, C: 0, R: null });
  });

  it('counts nothing as available while the session is paused', () => {
    const courts = [court(1), court(2)];
    expect(estimateInputs({ courts, sessionState: 'paused', durationMin: 15, now: T }).A).toBe(0);
  });

  it('rejects a non-positive or missing duration', () => {
    expect(estimateInputs({ courts: [], durationMin: 0, now: T }).D).toBeNull();
    expect(estimateInputs({ courts: [], durationMin: null, now: T }).D).toBeNull();
  });
});

/* ─────────────────────────────────────────────
   THE SIX WORKED EXAMPLES, verbatim from the specification.
   ───────────────────────────────────────────── */
describe('projectedRange — the specification worked examples', () => {
  const cases = [
    ['next group, two live courts, sub-five-minute first turnover',
      { D: 15, R: 2, C: 2, A: 0, G: 0 }, 1, 20, 'Next up — approx. 1–20 min'],
    ['two complete groups ahead, two live courts',
      { D: 15, R: 14, C: 2, A: 0, G: 2 }, 25, 45, 'Approx. 25–45 min'],
    ['four complete groups ahead, three live courts',
      { D: 10, R: 4, C: 3, A: 0, G: 4 }, 10, 25, 'Approx. 10–25 min'],
    ['long queue above the cap',
      { D: 15, R: 12, C: 1, A: 0, G: 6 }, 100, 120, `Approx. ${RANGE_CAP_MIN}+ min`],
    ['next group, two finishing courts',
      { D: 15, R: 0, C: 2, A: 0, G: 0 }, 1, 15, 'Next up — approx. 1–15 min'],
    ['one available court and two live courts, second queued group',
      { D: 15, R: 12, C: 2, A: 1, G: 1 }, 10, 30, 'Approx. 10–30 min'],
  ];

  for (const [label, input, lower, upper, text] of cases) {
    it(`${label} → ${text}`, () => {
      const range = projectedRange(input);
      expect(range.lower).toBe(lower);
      expect(range.upper).toBe(upper);

      /* And the same numbers, through the function the UI actually calls.
         The busy courts are staggered so the SOONEST has exactly R minutes left
         and the rest have more — otherwise a filler court would turn over first
         and quietly become the real R. */
      const courts = [
        ...Array.from({ length: input.A }, (_, i) => court(`free${i}`)),
        ...Array.from({ length: input.C }, (_, i) =>
          live(`busy${i}`, input.D, input.D - (input.R + i))),
      ];
      const est = callEstimate({
        attendance: 'queued', groupsAhead: input.G, courts, durationMin: input.D, now: T,
      });
      expect(est.status).toBe('range');
      expect(est.text).toBe(text);
    });
  }

  it('refuses to invent a range without a turning-over court, a time or a duration', () => {
    expect(projectedRange({ D: 15, R: 5, C: 0, A: 0, G: 1 })).toBeNull();
    expect(projectedRange({ D: 15, R: null, C: 2, A: 0, G: 1 })).toBeNull();
    expect(projectedRange({ D: 0, R: 5, C: 2, A: 0, G: 1 })).toBeNull();
  });
});

/* ─────────────────────────────────────────────
   PRECEDENCE — the specification's estimation test matrix.
   ───────────────────────────────────────────── */
describe('callEstimate precedence', () => {
  const twoLive = [live(1, 15, 3), live(2, 15, 1)];

  it('an empty available court plus a waiting group is Ready now', () => {
    const est = callEstimate({
      attendance: 'queued', groupsAhead: 0, courts: [court(1), live(2, 15, 5)],
      durationMin: 15, now: T,
    });
    expect(est).toEqual({ status: 'ready', text: ESTIMATE_TEXT.ready });
  });

  it('a paused session says so to every non-playing attendee', () => {
    for (const attendance of ['available', 'queued']) {
      const est = callEstimate({
        sessionState: 'paused', attendance, groupsAhead: 0, courts: [court(1)],
        durationMin: 15, now: T,
      });
      expect(est.text).toBe(ESTIMATE_TEXT.paused);
    }
  });

  it('but a paused session owes nothing to someone sitting out or gone home', () => {
    for (const attendance of ['unavailable', 'checkedOut']) {
      const est = callEstimate({ sessionState: 'paused', attendance, now: T });
      expect(est).toEqual({ status: 'none', text: null });
    }
  });

  it('measures a playing attendee rather than projecting them', () => {
    const est = callEstimate({
      attendance: 'playing', playing: { courtName: 'Court 2', remainingMin: 8 }, now: T,
    });
    expect(est.status).toBe('playing');
    expect(est.text).toBe('On Court 2 — about 8 min remaining');
  });

  it('closing blocks a queued group even with a court standing empty', () => {
    const est = callEstimate({
      sessionState: 'closing', attendance: 'queued', groupsAhead: 0,
      courts: [court(1), court(2)], durationMin: 15, now: T,
    });
    expect(est.status).toBe('closing');
    expect(est.text).toBe(ESTIMATE_TEXT.closing);
    expect(est.text).not.toBe(ESTIMATE_TEXT.ready);
  });

  it('closing still counts a playing attendee down — the match is real', () => {
    const est = callEstimate({
      sessionState: 'closing', attendance: 'playing',
      playing: { courtName: 'Court 1', remainingMin: 4 }, now: T,
    });
    expect(est.status).toBe('playing');
    expect(est.text).toBe('On Court 1 — about 4 min remaining');
  });

  it('a closed session owes no estimate to anyone', () => {
    for (const attendance of ['available', 'queued', 'playing']) {
      expect(callEstimate({ sessionState: 'closed', attendance, groupsAhead: 0, now: T }))
        .toEqual({ status: 'none', text: null });
    }
  });

  it('with one court free and three groups waiting, only the first is Ready now', () => {
    const courts = [court(1), live(2, 15, 3)];
    const at = (G) => callEstimate({
      attendance: 'queued', groupsAhead: G, courts, durationMin: 15, now: T,
    });
    expect(at(0).status).toBe('ready');
    // The later two fall through, with the free court allocated as opening one.
    expect(at(1).status).toBe('range');
    expect(at(2).status).toBe('range');
  });

  it('an available-but-ungrouped attendee has no position to project from', () => {
    const est = callEstimate({
      attendance: 'available', courts: [live(1, 15, 3)], durationMin: 15, now: T,
    });
    expect(est.status).toBe('unknown');
    expect(est.text).toBe(ESTIMATE_TEXT.unknown);
  });

  it('says so honestly when the floor cannot support a projection', () => {
    // No court turning over at all.
    expect(callEstimate({
      attendance: 'queued', groupsAhead: 2, courts: [], durationMin: 15, now: T,
    }).status).toBe('unknown');

    // No configured duration.
    expect(callEstimate({
      attendance: 'queued', groupsAhead: 2, courts: twoLive, durationMin: null, now: T,
    }).status).toBe('unknown');
  });

  it('a finishing court is not a no-data case — it projects with R = 0', () => {
    const est = callEstimate({
      attendance: 'queued', groupsAhead: 0, courts: [live(1, 15, 30), live(2, 15, 30)],
      durationMin: 15, now: T,
    });
    expect(est.status).toBe('range');
    expect(est.text).toBe('Next up — approx. 1–15 min');
  });

  it('does not fabricate a countdown for a playing attendee we cannot measure', () => {
    const est = callEstimate({ attendance: 'playing', playing: null, now: T });
    expect(est.status).toBe('unknown');
  });
});

/* ── purity ──────────────────────────────────── */
describe('estimates are inert', () => {
  it('mutates no court, no queue and no ordering', () => {
    const courts = [court(1), live(2, 15, 5), live(3, 15, 9)];
    const queue = [{ id: 'g1', players: ['a', 'b', 'c', 'd'] }];
    const before = JSON.stringify({ courts, queue });

    callEstimate({ attendance: 'queued', groupsAhead: 1, courts, durationMin: 15, now: T });
    estimateInputs({ courts, durationMin: 15, now: T });
    courts.forEach((c) => courtStatusOf(c, 'open', T));

    expect(JSON.stringify({ courts, queue })).toBe(before);
  });

  it('is deterministic for identical inputs and now', () => {
    const args = {
      attendance: 'queued', groupsAhead: 3, courts: [live(1, 15, 4), live(2, 15, 11)],
      durationMin: 15, now: T,
    };
    expect(callEstimate(args)).toEqual(callEstimate(args));
  });
});
