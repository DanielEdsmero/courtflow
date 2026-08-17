import { describe, it, expect } from 'vitest';
import {
  generateAutoQueueGroups,
  assignQueuedGroupToCourt,
  suggestCourtFor,
  preferredCourtFor,
  buildHistoryIndex,
  courtRoles,
  draftTeams,
  checkInOrder,
  combinations,
  COOLDOWN_MATCHES,
} from './queue-engine.js';
import { playerValue } from './logic.js';

/* ─────────────────────────────────────────────
   HARNESS
   Everything here is deterministic on purpose: fixed ids, fixed check-in order,
   an injected clock, and a simulated match that always awards the win to team 1.
   Two runs of the same scenario must produce identical output.
   ───────────────────────────────────────────── */

const mkPlayers = (n, from = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${from + i}`,
    name: `P${from + i}`,
    skill: 'Intermediate',
    payment: 'cash',
    wins: 0,
    losses: 0,
    checkedOut: false,
    checkedInAt: 1_000 + i,
  }));

const mkCourts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Court ${i + 1}`,
    type: 'open',
    match: null,
  }));

const withMatch = (court, ids, startedAt = 0) => ({
  ...court,
  match: { players: ids, startedAt, endsAt: null, durationMin: null },
});

const result = (id, ids) => ({
  id,
  courtId: 'c1',
  players: ids,
  winners: [ids[0], ids[1]],
  losers: [ids[2], ids[3]],
  duration: 900_000,
  finishedAt: 0,
});

const group = (id, players, extra = {}) => ({
  id,
  players,
  type: 'manual',
  createdAt: 100,
  ...extra,
});

// Who is left on the bench once a pass has run.
const availableAfter = (players, courts, queue) => {
  const busy = new Set();
  courts.forEach((c) => (c.match?.players ?? []).forEach((id) => busy.add(id)));
  queue.forEach((g) => g.players.forEach((id) => busy.add(id)));
  return players.filter((p) => !p.checkedOut && !busy.has(p.id));
};

const allQueued = (queue) => queue.flatMap((g) => g.players);

/* ── combinations ────────────────────────────── */
describe('combinations', () => {
  it('enumerates every k-subset in a fixed order', () => {
    expect(combinations([1, 2, 3, 4], 2)).toEqual([
      [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
    ]);
  });

  it('returns one empty pick for k = 0 and nothing when k exceeds the input', () => {
    expect(combinations([1, 2], 0)).toEqual([[]]);
    expect(combinations([1, 2], 3)).toEqual([]);
  });
});

/* ── snake draft ─────────────────────────────── */
describe('draftTeams', () => {
  const order = checkInOrder(mkPlayers(4));

  it('pairs the highest value with the lowest, and the middle two together', () => {
    const [a, b, c, d] = mkPlayers(4);
    const four = [
      { ...a, wins: 4 },   // value  4 — highest
      { ...b, wins: 2 },   // value  2
      { ...c, wins: 1 },   // value  1
      { ...d, losses: 2 }, // value -1 — lowest
    ];
    const drafted = draftTeams(four, order);
    expect([drafted[0].id, drafted[1].id]).toEqual(['p1', 'p4']);
    expect([drafted[2].id, drafted[3].id]).toEqual(['p2', 'p3']);
  });

  it('produces two teams of near-equal combined value', () => {
    const [a, b, c, d] = mkPlayers(4);
    const four = [{ ...a, wins: 3 }, { ...b, wins: 2 }, { ...c, wins: 1 }, { ...d, wins: 0 }];
    const drafted = draftTeams(four, order);
    const t1 = playerValue(drafted[0]) + playerValue(drafted[1]);
    const t2 = playerValue(drafted[2]) + playerValue(drafted[3]);
    expect(Math.abs(t1 - t2)).toBeLessThanOrEqual(1);
  });

  it('breaks equal values on check-in order, never randomly', () => {
    const four = mkPlayers(4); // all on 0
    const a = draftTeams(four, order).map((p) => p.id);
    const b = draftTeams([...four].reverse(), order).map((p) => p.id);
    expect(a).toEqual(b);
  });
});

/* ── history index ───────────────────────────── */
describe('buildHistoryIndex', () => {
  it('reads the immediately previous result per player', () => {
    const H = buildHistoryIndex([result('h1', ['p1', 'p2', 'p3', 'p4'])]);
    expect(H.lastResult('p1')).toBe('W');
    expect(H.lastResult('p3')).toBe('L');
    expect(H.lastResult('p9')).toBe('N'); // never played
  });

  it('treats a court cleared without a result as neutral, not a loss', () => {
    const H = buildHistoryIndex([{ id: 'h', players: ['p1', 'p2', 'p3', 'p4'], type: 'casual' }]);
    expect(H.lastResult('p3')).toBe('N');
    expect(H.anyDecided).toBe(false);
  });

  it('ignores rentals, which carry a single host rather than four players', () => {
    const H = buildHistoryIndex([{ id: 'h', players: ['p1'], type: 'rental' }]);
    expect(H.matchesPlayed('p1')).toBe(0);
  });

  it('blocks a repeat opponent until both have played two later matches', () => {
    const first = result('h1', ['p1', 'p2', 'p3', 'p4']);
    expect(buildHistoryIndex([first]).opponentBlocked('p1', 'p3')).toBe(true);

    // p1 and p3 each play two more — as PARTNERS, so they never face each other
    // in the meantime and only the cooldown can unblock them.
    const withTwo = [
      result('h3', ['p1', 'p3', 'p7', 'p8']),
      result('h2', ['p1', 'p3', 'p5', 'p6']),
      first,
    ];
    expect(buildHistoryIndex(withTwo).opponentBlocked('p1', 'p3')).toBe(false);
  });

  it('does not let sitting out burn a cooldown', () => {
    const history = [
      result('h3', ['p5', 'p6', 'p7', 'p8']),
      result('h2', ['p5', 'p6', 'p7', 'p8']),
      result('h1', ['p1', 'p2', 'p3', 'p4']),
    ];
    expect(buildHistoryIndex(history).opponentBlocked('p1', 'p3')).toBe(true);
  });

  it('tracks partners and the whole four separately', () => {
    const H = buildHistoryIndex([result('h1', ['p1', 'p2', 'p3', 'p4'])]);
    expect(H.partnerBlocked('p1', 'p2')).toBe(true);
    expect(H.partnerBlocked('p1', 'p3')).toBe(false); // they were opponents
    expect(H.quadBlocked(['p4', 'p3', 'p2', 'p1'])).toBe(true);
    expect(H.quadBlocked(['p1', 'p2', 'p3', 'p5'])).toBe(false);
  });
});

/* ─────────────────────────────────────────────
   THE SCREENSHOT REGRESSION
   Two courts playing, one complete group already queued, eight on the bench.
   The old build refused with "courts are busy and a group is already waiting".
   ───────────────────────────────────────────── */
describe('regression: 8 Playing + Queue[4] + 8 Available', () => {
  // p1..p8 on court, p9..p12 queued, p13..p20 free.
  const build = () => ({
    players: mkPlayers(20),
    courts: [
      withMatch(mkCourts(2)[0], ['p1', 'p2', 'p3', 'p4'], 500),
      withMatch(mkCourts(2)[1], ['p5', 'p6', 'p7', 'p8'], 600),
    ],
    queue: [group('existing', ['p9', 'p10', 'p11', 'p12'], { type: 'auto' })],
  });

  const run = () => {
    const world = build();
    return { ...world, res: generateAutoQueueGroups({ ...world, history: [], now: 9_000 }) };
  };

  it('creates exactly two more complete groups', () => {
    const { res } = run();
    expect(res.created).toHaveLength(2);
    expect(res.queue).toHaveLength(3);
    expect(res.queue.every((g) => g.players.length === 4)).toBe(true);
  });

  it('leaves nobody on the bench', () => {
    const { players, courts, res } = run();
    expect(res.remaining).toBe(0);
    expect(availableAfter(players, courts, res.queue)).toHaveLength(0);
  });

  it('leaves the courts and the eight players on them completely alone', () => {
    const { courts, res } = run();
    // The engine returns no court state at all — there is nothing it could change.
    expect(res).not.toHaveProperty('assignments');
    expect(res).not.toHaveProperty('courts');
    expect(courts[0].match.players).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(courts[0].match.startedAt).toBe(500);
    expect(courts[1].match.startedAt).toBe(600);
  });

  it('keeps the existing group first and unchanged, and reports no refusal', () => {
    const { res } = run();
    expect(res.queue[0].id).toBe('existing');
    expect(res.queue[0].players).toEqual(['p9', 'p10', 'p11', 'p12']);
    expect(res.queue[0].createdAt).toBe(100);
    expect(res.reason).toBeNull();
  });
});

/* ─────────────────────────────────────────────
   AUTO BUILDS EVERY GROUP IT CAN
   ───────────────────────────────────────────── */
describe('generateAutoQueueGroups', () => {
  it('20 Available and two empty courts → five groups, both courts still empty', () => {
    const players = mkPlayers(20);
    const courts = mkCourts(2);
    const res = generateAutoQueueGroups({ players, courts, queue: [], history: [], now: 0 });
    expect(res.created).toHaveLength(5);
    expect(res.queue).toHaveLength(5);
    expect(allQueued(res.queue)).toHaveLength(20);
    expect(courts.every((c) => !c.match)).toBe(true);
    expect(res.remaining).toBe(0);
  });

  it('nine Available → two groups and one player left over', () => {
    const players = mkPlayers(9);
    const courts = mkCourts(2);
    const res = generateAutoQueueGroups({ players, courts, queue: [], history: [], now: 0 });
    expect(res.created).toHaveLength(2);
    expect(res.remaining).toBe(1);
    expect(availableAfter(players, courts, res.queue)).toHaveLength(1);
  });

  it('never leaves a group of one, two or three behind', () => {
    for (const n of [4, 5, 6, 7, 8, 11, 13, 17]) {
      const res = generateAutoQueueGroups({
        players: mkPlayers(n), courts: mkCourts(2), queue: [], history: [], now: 0,
      });
      expect(res.created).toHaveLength(Math.floor(n / 4));
      expect(res.queue.every((g) => g.players.length === 4)).toBe(true);
      expect(res.remaining).toBe(n % 4);
    }
  });

  it('says so truthfully when it cannot build anything', () => {
    const res = generateAutoQueueGroups({
      players: mkPlayers(3), courts: mkCourts(2), queue: [], history: [], now: 0,
    });
    expect(res.created).toEqual([]);
    expect(res.reason).toBe('noFullGroupPossible');
    expect(res.remaining).toBe(3);
    expect(res.queue).toEqual([]);
  });

  it('tops a manual partial up first, keeping its members, then builds the rest', () => {
    // Two manual members plus ten Available: the partial fills, then two more
    // complete groups come out of the remaining eight.
    const players = mkPlayers(12);
    const queue = [group('manual', ['p1', 'p2'])];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(2), queue, history: [], now: 7_000,
    });

    const topped = res.queue.find((g) => g.id === 'manual');
    expect(topped.players).toHaveLength(4);
    expect(topped.players).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(topped.type).toBe('manual');
    expect(topped.createdAt).toBe(100); // topping up does not restart the wait
    expect(res.toppedUp).toEqual(['manual']);
    expect(res.created).toHaveLength(2);
    expect(res.remaining).toBe(0);
  });

  it('leaves a partial alone when the bench cannot complete it', () => {
    const players = mkPlayers(3);
    const queue = [group('manual', ['p1', 'p2', 'p3'])];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(1), queue, history: [], now: 0,
    });
    expect(res.queue).toEqual(queue);
    expect(res.reason).toBe('noFullGroupPossible');
  });

  it('puts the longest-waiting player in the group that plays next', () => {
    // p1..p4 just came off court, p5..p8 have never played. p5 is the longest
    // waiter, so whichever group they end up in has to be Queue #1.
    const players = mkPlayers(8);
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(2), queue: [], history, now: 0,
    });
    expect(res.queue[0].players).toContain('p5');
  });

  it('mixes a batch rather than leaving the last group to be the previous four', () => {
    // The only way to use all eight without rebuilding p1..p4 is to split them
    // across both groups — which greedy grouping alone would never find.
    const players = mkPlayers(8);
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(2), queue: [], history, now: 0,
    });
    const H = buildHistoryIndex(history);
    expect(res.queue).toHaveLength(2);
    for (const g of res.queue) expect(H.quadBlocked(g.players)).toBe(false);
  });

  it('avoids a recent rematch when a valid alternative exists', () => {
    const players = mkPlayers(8);
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(2), queue: [], history, now: 0,
    });
    const H = buildHistoryIndex(history);
    for (const g of res.queue) {
      const [a, b, c, d] = g.players;
      for (const x of [a, b]) {
        for (const y of [c, d]) expect(H.opponentBlocked(x, y)).toBe(false);
      }
    }
    expect(res.log.filter((l) => l.step === 'create').every((l) => l.rung === 'strict')).toBe(true);
  });

  it('falls back rather than failing to make a playable group', () => {
    // Only the four who just played are free, so every option repeats.
    const players = mkPlayers(4);
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(1), queue: [], history, now: 0,
    });
    expect(res.created).toHaveLength(1);
    expect(res.queue[0].players).toHaveLength(4);
    expect(res.log.find((l) => l.step === 'create').rung).toBe('giveUp');
  });

  it('records nothing in history merely by queueing a group', () => {
    const history = [];
    generateAutoQueueGroups({
      players: mkPlayers(8), courts: mkCourts(2), queue: [], history, now: 0,
    });
    expect(history).toEqual([]);
  });

  it('ignores checked-out players and anyone already on a court or in the queue', () => {
    const players = mkPlayers(12).map((p) => (p.id === 'p12' ? { ...p, checkedOut: true } : p));
    const courts = [withMatch(mkCourts(1)[0], ['p1', 'p2', 'p3', 'p4'])];
    const queue = [group('q', ['p5', 'p6', 'p7', 'p8'], { type: 'auto' })];
    const res = generateAutoQueueGroups({ players, courts, queue, history: [], now: 0 });
    // p9, p10, p11 are free; p12 has gone home. Not a full four.
    expect(res.created).toEqual([]);
    expect(res.remaining).toBe(3);
  });
});

/* ── idempotence and purity ──────────────────── */
describe('pressing Auto twice', () => {
  it('changes nothing on the second press when nobody new is Available', () => {
    const players = mkPlayers(8);
    const courts = mkCourts(2);
    const first = generateAutoQueueGroups({
      players, courts, queue: [], history: [], now: 1_000,
    });
    const second = generateAutoQueueGroups({
      players, courts, queue: first.queue, history: [], now: 2_000,
    });
    expect(second.queue).toEqual(first.queue);
    expect(second.created).toEqual([]);
    expect(second.toppedUp).toEqual([]);
    expect(second.reason).toBe('noFullGroupPossible');
    expect(second.queue.map((g) => g.id)).toEqual(first.queue.map((g) => g.id));
  });

  it('picks up where it left off once four more players check in', () => {
    const eight = mkPlayers(8);
    const courts = mkCourts(2);
    const first = generateAutoQueueGroups({
      players: eight, courts, queue: [], history: [], now: 1_000,
    });
    const twelve = [...eight, ...mkPlayers(4, 9)];
    const second = generateAutoQueueGroups({
      players: twelve, courts, queue: first.queue, history: [], now: 2_000,
    });
    expect(second.created).toHaveLength(1);
    expect(second.queue.slice(0, 2)).toEqual(first.queue);
  });

  it('does not mutate the inputs it is given', () => {
    const players = mkPlayers(12);
    const courts = [withMatch(mkCourts(2)[0], ['p1', 'p2', 'p3', 'p4'])];
    const queue = [group('manual', ['p5', 'p6'])];
    const snapshot = JSON.stringify({ players, courts, queue });
    generateAutoQueueGroups({ players, courts, queue, history: [], now: 0 });
    expect(JSON.stringify({ players, courts, queue })).toBe(snapshot);
  });

  it('is deterministic for identical state and now', () => {
    const args = {
      players: mkPlayers(17), courts: mkCourts(3), queue: [], history: [], now: 4_242,
    };
    const a = generateAutoQueueGroups(args);
    const b = generateAutoQueueGroups(args);
    expect(b.queue).toEqual(a.queue);
    expect(b.log).toEqual(a.log);
  });

  it('does not depend on the order players arrive in the array', () => {
    const players = mkPlayers(12);
    const shared = { courts: mkCourts(2), queue: [], history: [], now: 0 };
    const a = generateAutoQueueGroups({ ...shared, players });
    const b = generateAutoQueueGroups({ ...shared, players: [...players].reverse() });
    expect(b.queue.map((g) => [...g.players].sort())).toEqual(
      a.queue.map((g) => [...g.players].sort())
    );
  });
});

/* ── FIFO ────────────────────────────────────── */
describe('FIFO', () => {
  const seeded = () => {
    const players = mkPlayers(12);
    const queue = [group('old', ['p1', 'p2', 'p3', 'p4'], { type: 'auto', createdAt: 10 })];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(2), queue, history: [], now: 5_000,
    });
    return res;
  };

  it('keeps an older complete group at the head of the queue', () => {
    const res = seeded();
    expect(res.queue[0].id).toBe('old');
    expect(res.queue.slice(1).every((g) => g.createdAt === 5_000)).toBe(true);
  });

  it('offers that same head group first for manual court assignment', () => {
    const res = seeded();
    const next = assignQueuedGroupToCourt({
      groupId: res.queue[0].id, courtId: 'c1', courts: mkCourts(2), queue: res.queue, now: 6_000,
    });
    expect(next.assigned.playerIds).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});

/* ── Winners / Losers hints ──────────────────── */
describe('Winners / Losers', () => {
  const history = [
    result('h2', ['p5', 'p6', 'p7', 'p8']), // p5,p6 won  p7,p8 lost
    result('h1', ['p1', 'p2', 'p3', 'p4']), // p1,p2 won  p3,p4 lost
  ];

  it('reads court roles off the floor, with no ladder on a single court', () => {
    const roles = courtRoles(mkCourts(3));
    expect(roles.get('c1')).toBe('high');
    expect(roles.get('c2')).toBe('neutral');
    expect(roles.get('c3')).toBe('low');
    expect(courtRoles(mkCourts(1)).get('c1')).toBe('neutral');
  });

  it('hints high for a winners group and low for a losers group', () => {
    const H = buildHistoryIndex(history);
    const winners = mkPlayers(8).filter((p) => ['p1', 'p2', 'p5', 'p6'].includes(p.id));
    const losers = mkPlayers(8).filter((p) => ['p3', 'p4', 'p7', 'p8'].includes(p.id));
    expect(preferredCourtFor(winners, H, { wl: true })).toBe('high');
    expect(preferredCourtFor(losers, H, { wl: true })).toBe('low');
    expect(preferredCourtFor(winners, H, { wl: false })).toBe('any');
  });

  it('hints only — it never puts a group on a court', () => {
    const players = mkPlayers(8);
    const courts = mkCourts(2); // both empty, and both must stay empty
    const res = generateAutoQueueGroups({
      players, courts, queue: [], history, now: 0, matchingStyle: 'winnersLosers',
    });
    expect(res.created).toHaveLength(2);
    expect(courts.every((c) => !c.match)).toBe(true);
    expect(res.queue.every((g) => ['high', 'low', 'any'].includes(g.preferredCourt))).toBe(true);
  });

  it('clusters recent winners together and recent losers together', () => {
    const res = generateAutoQueueGroups({
      players: mkPlayers(8), courts: mkCourts(2), queue: [], history, now: 0,
      matchingStyle: 'winnersLosers',
    });
    expect(res.queue.map((g) => g.preferredCourt).sort()).toEqual(['high', 'low']);
  });

  it('uses "any" on a one-court floor, where there is no ladder', () => {
    const res = generateAutoQueueGroups({
      players: mkPlayers(8), courts: mkCourts(1), queue: [], history, now: 0,
      matchingStyle: 'winnersLosers',
    });
    expect(res.queue.every((g) => g.preferredCourt === 'any')).toBe(true);
  });

  it('leaves a pre-existing complete group untouched, hint or not', () => {
    const players = mkPlayers(12);
    const queue = [group('existing', ['p1', 'p2', 'p3', 'p4'], { type: 'auto', createdAt: 5 })];
    const res = generateAutoQueueGroups({
      players, courts: mkCourts(2), queue, history, now: 0, matchingStyle: 'winnersLosers',
    });
    expect(res.queue[0]).toEqual(queue[0]);
  });

  it('suggests the hinted end of the floor but never forces it', () => {
    const courts = mkCourts(3);
    expect(suggestCourtFor({ preferredCourt: 'high' }, courts)).toBe('c1');
    expect(suggestCourtFor({ preferredCourt: 'low' }, courts)).toBe('c3');
    expect(suggestCourtFor({ preferredCourt: 'any' }, courts)).toBe('c1');
    // The hinted court is busy — fall back to whatever is actually open.
    const busyLow = [courts[0], courts[1], withMatch(courts[2], ['x1', 'x2', 'x3', 'x4'])];
    expect(suggestCourtFor({ preferredCourt: 'low' }, busyLow)).toBe('c1');
    expect(suggestCourtFor({ preferredCourt: 'high' }, [])).toBeNull();
  });
});

/* ─────────────────────────────────────────────
   MANUAL COURT ASSIGNMENT
   ───────────────────────────────────────────── */
describe('assignQueuedGroupToCourt', () => {
  const setup = () => ({
    courts: mkCourts(2),
    queue: [
      group('g1', ['p1', 'p2', 'p3', 'p4'], { type: 'auto' }),
      group('g2', ['p5', 'p6', 'p7', 'p8'], { type: 'auto' }),
    ],
  });

  it('moves exactly those four onto the court and leaves later groups alone', () => {
    const { courts, queue } = setup();
    const next = assignQueuedGroupToCourt({
      groupId: 'g1', courtId: 'c1', courts, queue, now: 5_000, durationMin: 15,
    });
    expect(next.courts[0].match.players).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(next.courts[1].match).toBeNull();
    expect(next.queue).toEqual([queue[1]]);
  });

  it('uses the group verbatim rather than re-running the matcher', () => {
    const { courts } = setup();
    // A deliberately unbalanced hand-built order must survive intact.
    const queue = [group('hand', ['p4', 'p1', 'p3', 'p2'])];
    const next = assignQueuedGroupToCourt({
      groupId: 'hand', courtId: 'c1', courts, queue, now: 0,
    });
    expect(next.courts[0].match.players).toEqual(['p4', 'p1', 'p3', 'p2']);
  });

  it('starts the configured timer, and leaves it open when there is none', () => {
    const { courts, queue } = setup();
    const timed = assignQueuedGroupToCourt({
      groupId: 'g1', courtId: 'c1', courts, queue, now: 1_000, durationMin: 20,
    });
    expect(timed.courts[0].match.startedAt).toBe(1_000);
    expect(timed.courts[0].match.endsAt).toBe(1_000 + 20 * 60_000);
    expect(timed.courts[0].match.durationMin).toBe(20);

    const open = assignQueuedGroupToCourt({
      groupId: 'g1', courtId: 'c1', courts, queue, now: 1_000, durationMin: null,
    });
    expect(open.courts[0].match.endsAt).toBeNull();
  });

  it('refuses an incomplete group, a busy court and an unknown id', () => {
    const { courts, queue } = setup();
    const partial = [group('short', ['p1', 'p2'])];
    expect(assignQueuedGroupToCourt({
      groupId: 'short', courtId: 'c1', courts, queue: partial, now: 0,
    })).toBeNull();

    const busy = [withMatch(courts[0], ['x1', 'x2', 'x3', 'x4']), courts[1]];
    expect(assignQueuedGroupToCourt({
      groupId: 'g1', courtId: 'c1', courts: busy, queue, now: 0,
    })).toBeNull();

    expect(assignQueuedGroupToCourt({
      groupId: 'nope', courtId: 'c1', courts, queue, now: 0,
    })).toBeNull();
  });

  it('does not mutate the courts or queue it was handed', () => {
    const { courts, queue } = setup();
    const snapshot = JSON.stringify({ courts, queue });
    assignQueuedGroupToCourt({ groupId: 'g1', courtId: 'c1', courts, queue, now: 9 });
    expect(JSON.stringify({ courts, queue })).toBe(snapshot);
  });
});

/* ─────────────────────────────────────────────
   A WHOLE SESSION
   Auto builds the queue, staff assign courts by hand, matches finish, repeat.
   ───────────────────────────────────────────── */
function simulate({ players, courts, rounds, matchingStyle = 'balanced' }) {
  let state = { players, courts, queue: [], history: [] };
  const passes = [];

  for (let r = 0; r < rounds; r++) {
    const now = r * 60_000;
    const res = generateAutoQueueGroups({ ...state, matchingStyle, now });
    passes.push(res);
    state = { ...state, queue: res.queue };

    // Staff assign the head of the queue to each open court, by hand.
    for (const court of state.courts.filter((c) => c.type === 'open' && !c.match)) {
      const head = state.queue.find((g) => g.players.length === 4);
      if (!head) break;
      const next = assignQueuedGroupToCourt({
        groupId: head.id, courtId: court.id, courts: state.courts, queue: state.queue, now,
      });
      if (!next) break;
      state = { ...state, courts: next.courts, queue: next.queue };
    }

    // Every match finishes; team 1 always wins.
    const finished = [];
    const courtsAfter = state.courts.map((c) => {
      if (!c.match) return c;
      finished.push(result(`h-${now}-${c.id}`, c.match.players));
      return { ...c, match: null };
    });
    const won = new Set(finished.flatMap((f) => f.winners));
    const lost = new Set(finished.flatMap((f) => f.losers));
    state = {
      players: state.players.map((p) =>
        won.has(p.id) ? { ...p, wins: p.wins + 1 }
        : lost.has(p.id) ? { ...p, losses: p.losses + 1 }
        : p
      ),
      courts: courtsAfter,
      queue: state.queue,
      history: [...finished.reverse(), ...state.history],
    };
  }
  return { state, passes };
}

// Same-four repeats that broke the cooldown.
function sameFourViolations(history) {
  const out = [];
  const seen = new Map();
  const played = new Map();
  [...history].reverse().forEach((h, i) => {
    const key = [...h.players].sort().join('|');
    if (seen.has(key)) {
      const at = seen.get(key);
      const gaps = h.players.map((id) => (played.get(id) ?? []).filter((j) => j > at).length);
      if (gaps.some((g) => g < COOLDOWN_MATCHES)) out.push({ key, gaps });
    }
    seen.set(key, i);
    h.players.forEach((id) => {
      if (!played.has(id)) played.set(id, []);
      played.get(id).push(i);
    });
  });
  return out;
}

describe('session: 24 players / 3 courts / 20 rounds', () => {
  const run = () => simulate({ players: mkPlayers(24), courts: mkCourts(3), rounds: 20 });

  it('separates values over the session', () => {
    const vals = run().state.players.map(playerValue);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(2);
  });

  it('never repeats the same four inside the cooldown', () => {
    expect(sameFourViolations(run().state.history)).toEqual([]);
  });

  it('gets everyone on court rather than cycling the same faces', () => {
    const games = run().state.players.map((p) => p.wins + p.losses);
    expect(Math.min(...games)).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed input order and clock', () => {
    expect(run().state.history).toEqual(run().state.history);
  });
});

describe('session: 5 players / 2 courts / 10 rounds', () => {
  const run = () => simulate({ players: mkPlayers(5), courts: mkCourts(2), rounds: 10 });

  it('runs to completion without deadlocking or throwing', () => {
    expect(() => run()).not.toThrow();
    expect(run().passes).toHaveLength(10);
  });

  it('builds exactly one group a round and never a short one', () => {
    for (const p of run().passes) {
      expect(p.created).toHaveLength(1);
      expect(p.remaining).toBe(1);
    }
  });

  it('walks past the strict rung when history leaves no clean option', () => {
    const rungs = run().passes.flatMap((p) => p.log.map((l) => l.rung)).filter(Boolean);
    expect(rungs.some((r) => r !== 'strict')).toBe(true);
    expect(rungs.some((r) => ['relax2', 'relax3', 'giveUp'].includes(r))).toBe(true);
  });

  it('rotates who sits out rather than benching one person all night', () => {
    const games = run().state.players.map((p) => p.wins + p.losses);
    expect(Math.min(...games)).toBeGreaterThan(4);
  });
});
