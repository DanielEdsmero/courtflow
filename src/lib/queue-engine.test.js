import { describe, it, expect } from 'vitest';
import {
  runAutoPass,
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
   Two runs of the same scenario must produce byte-identical output.
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

const withMatch = (court, ids) => ({ ...court, match: { players: ids, startedAt: 0 } });

const result = (id, ids) => ({
  id,
  courtId: 'c1',
  players: ids,
  winners: [ids[0], ids[1]],
  losers: [ids[2], ids[3]],
  duration: 900_000,
  finishedAt: 0,
});

// Apply a pass the way App does, then finish every match on court.
function playRound(state, { matchingStyle = 'balanced', now = 0 } = {}) {
  const res = runAutoPass({ ...state, matchingStyle, now });

  let courts = state.courts.map((c) => {
    const a = res.assignments.find((x) => x.courtId === c.id);
    return a ? { ...c, match: { players: a.playerIds, startedAt: now } } : c;
  });

  const finished = [];
  courts = courts.map((c) => {
    if (!c.match) return c;
    finished.push(result(`h-${now}-${c.id}`, c.match.players));
    return { ...c, match: null };
  });

  const won = new Set(finished.flatMap((f) => f.winners));
  const lost = new Set(finished.flatMap((f) => f.losers));

  return {
    res,
    state: {
      players: state.players.map((p) =>
        won.has(p.id)
          ? { ...p, wins: p.wins + 1 }
          : lost.has(p.id)
          ? { ...p, losses: p.losses + 1 }
          : p
      ),
      courts,
      queue: res.queue,
      // Newest first, and the courts within one round are ordered c1 → cN, so
      // reversing them keeps "later court finished later".
      history: [...finished.reverse(), ...state.history],
    },
  };
}

function simulate({ players, courts, rounds, matchingStyle = 'balanced' }) {
  let state = { players, courts, queue: [], history: [] };
  const passes = [];
  for (let r = 0; r < rounds; r++) {
    const step = playRound(state, { matchingStyle, now: r * 60_000 });
    passes.push(step.res);
    state = step.state;
  }
  return { state, passes };
}

// Who is left on the bench after a pass.
const availableAfter = (players, courts, queue, assignments) => {
  const busy = new Set();
  courts.forEach((c) => (c.match?.players ?? []).forEach((id) => busy.add(id)));
  queue.forEach((g) => g.players.forEach((id) => busy.add(id)));
  assignments.forEach((a) => a.playerIds.forEach((id) => busy.add(id)));
  return players.filter((p) => !p.checkedOut && !busy.has(p.id));
};

// Every same-4 repeat in a finished history, with how many matches each member
// played in between. A cooldown violation is one where somebody played fewer
// than COOLDOWN_MATCHES.
function sameFourViolations(history) {
  const out = [];
  const seen = new Map();
  // Oldest first, so "later" means a higher position.
  const chron = [...history].reverse();
  const played = new Map();
  chron.forEach((h, i) => {
    const key = [...h.players].sort().join('|');
    if (seen.has(key)) {
      const at = seen.get(key);
      const gaps = h.players.map((id) => (played.get(id) ?? []).filter((j) => j > at).length);
      if (gaps.some((g) => g < COOLDOWN_MATCHES)) out.push({ key, at, i, gaps });
    }
    seen.set(key, i);
    h.players.forEach((id) => {
      if (!played.has(id)) played.set(id, []);
      played.get(id).push(i);
    });
  });
  return out;
}

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

/* ── snake draft (spec §5) ───────────────────── */
describe('draftTeams', () => {
  const order = checkInOrder(mkPlayers(4));

  it('pairs the highest value with the lowest, and the middle two together', () => {
    const [a, b, c, d] = mkPlayers(4);
    const four = [
      { ...a, wins: 4 },  // value 4   — highest
      { ...b, wins: 2 },  // value 2
      { ...c, wins: 1 },  // value 1
      { ...d, losses: 2 } // value -1  — lowest
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

/* ── history index (spec §6) ─────────────────── */
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
    // again in the meantime and only the cooldown can unblock them.
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
    // Two matches have happened since, but p1 and p3 played in neither.
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

/* ── court roles (spec §4A) ──────────────────── */
describe('courtRoles', () => {
  it('makes court 1 high and the last court low', () => {
    const roles = courtRoles(mkCourts(3));
    expect(roles.get('c1')).toBe('high');
    expect(roles.get('c2')).toBe('neutral');
    expect(roles.get('c3')).toBe('low');
  });

  it('has no high or low court when there is only one', () => {
    expect(courtRoles(mkCourts(1)).get('c1')).toBe('neutral');
  });
});

/* ── the four-player guard (spec §1, §12.1) ──── */
describe('four-player guard', () => {
  it('does nothing at all with three players, however many courts are free', () => {
    const players = mkPlayers(3);
    const res = runAutoPass({ players, courts: mkCourts(4), queue: [], history: [], now: 0 });
    expect(res.reason).toBe('needMorePlayers');
    expect(res.assignments).toEqual([]);
    expect(res.queue).toEqual([]);
  });

  it('counts players already sitting in a queue group towards the four', () => {
    const players = mkPlayers(4);
    const queue = [{ id: 'g1', players: ['p1', 'p2', 'p3'], type: 'manual', createdAt: 0 }];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history: [], now: 0 });
    expect(res.reason).not.toBe('needMorePlayers');
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].playerIds).toHaveLength(4);
  });

  it('never puts fewer than four players on a court', () => {
    const players = mkPlayers(7);
    const res = runAutoPass({ players, courts: mkCourts(2), queue: [], history: [], now: 0 });
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].playerIds).toHaveLength(4);
  });
});

/* ── the worked examples from the spec (§2) ──── */
describe('Auto pass — consumption limits (spec §2, §7)', () => {
  it('two empty courts + 12 available → two courts and one waiting group, nobody left', () => {
    const players = mkPlayers(12);
    const courts = mkCourts(2);
    const res = runAutoPass({ players, courts, queue: [], history: [], now: 5_000 });
    expect(res.assignments).toHaveLength(2);
    expect(res.created).toHaveLength(1);
    expect(res.queue).toHaveLength(1);
    expect(res.queue[0].players).toHaveLength(4);
    expect(availableAfter(players, courts, res.queue, res.assignments)).toHaveLength(0);
  });

  it('two empty courts + 5 available → one court filled, one player still waiting', () => {
    const players = mkPlayers(5);
    const courts = mkCourts(2);
    const res = runAutoPass({ players, courts, queue: [], history: [], now: 0 });
    expect(res.assignments).toHaveLength(1);
    expect(res.created).toHaveLength(0);
    expect(availableAfter(players, courts, res.queue, res.assignments)).toHaveLength(1);
    expect(res.log).toContainEqual(
      expect.objectContaining({ step: 'fill', filled: false, reason: 'noEligibleFour' })
    );
  });

  it('two empty courts + 20 available → three groups and eight left over', () => {
    const players = mkPlayers(20);
    const courts = mkCourts(2);
    const res = runAutoPass({ players, courts, queue: [], history: [], now: 0 });
    expect(res.assignments).toHaveLength(2);
    expect(res.created).toHaveLength(1);
    expect(availableAfter(players, courts, res.queue, res.assignments)).toHaveLength(8);
  });

  it('no empty courts + 8 available → exactly one waiting group', () => {
    const players = mkPlayers(8);
    const courts = [withMatch(mkCourts(1)[0], ['x1', 'x2', 'x3', 'x4'])];
    const res = runAutoPass({ players, courts, queue: [], history: [], now: 0 });
    expect(res.assignments).toHaveLength(0);
    expect(res.created).toHaveLength(1);
    expect(availableAfter(players, courts, res.queue, res.assignments)).toHaveLength(4);
  });

  it('will not build a second waiting group while one already waits', () => {
    const players = mkPlayers(8);
    const courts = [withMatch(mkCourts(1)[0], ['x1', 'x2', 'x3', 'x4'])];
    const queue = [{ id: 'g1', players: ['p1', 'p2', 'p3', 'p4'], type: 'auto', createdAt: 0 }];
    const res = runAutoPass({ players, courts, queue, history: [], now: 0 });
    expect(res.created).toHaveLength(0);
    expect(res.queue).toHaveLength(1);
    expect(res.log).toContainEqual(
      expect.objectContaining({ step: 'waiting', reason: 'waitingGroupExists' })
    );
  });
});

/* ── timestamps (spec §9) ────────────────────── */
describe('group timestamps', () => {
  it('stamps a new group with the injected now, never the wall clock', () => {
    const res = runAutoPass({
      players: mkPlayers(12),
      courts: mkCourts(2),
      queue: [],
      history: [],
      now: 1_700_000_000_000,
    });
    expect(res.queue[0].createdAt).toBe(1_700_000_000_000);
  });

  it('does not refresh createdAt when a partial group is topped up', () => {
    const players = mkPlayers(6);
    const courts = [withMatch(mkCourts(1)[0], ['x1', 'x2', 'x3', 'x4'])];
    const queue = [{ id: 'g1', players: ['p1', 'p2'], type: 'manual', createdAt: 111 }];
    const res = runAutoPass({ players, courts, queue, history: [], now: 999_999 });
    const g = res.queue.find((x) => x.id === 'g1');
    expect(g.players).toHaveLength(4);
    expect(g.createdAt).toBe(111);
  });
});

/* ── FIFO and immutable complete groups (spec §3.1) ── */
describe('queue consumption order', () => {
  it('takes the oldest complete group first, whatever order the array is in', () => {
    const players = mkPlayers(8);
    const queue = [
      { id: 'young', players: ['p5', 'p6', 'p7', 'p8'], type: 'auto', createdAt: 900 },
      { id: 'old', players: ['p1', 'p2', 'p3', 'p4'], type: 'manual', createdAt: 100 },
    ];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history: [], now: 0 });
    expect(res.assignments[0].groupId).toBe('old');
  });

  it('never rewrites a complete group at assignment time', () => {
    const players = mkPlayers(10);
    const queue = [{ id: 'g1', players: ['p7', 'p8', 'p9', 'p10'], type: 'auto', createdAt: 1 }];
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history, now: 0 });
    expect([...res.assignments[0].playerIds].sort()).toEqual(['p10', 'p7', 'p8', 'p9']);
  });

  it('skips a complete group that would repeat the same four, then takes the next', () => {
    const players = mkPlayers(8);
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const queue = [
      { id: 'repeat', players: ['p1', 'p2', 'p3', 'p4'], type: 'auto', createdAt: 100 },
      { id: 'fresh', players: ['p5', 'p6', 'p7', 'p8'], type: 'auto', createdAt: 200 },
    ];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history, now: 0 });
    expect(res.assignments[0].groupId).toBe('fresh');
    expect(res.queue.map((g) => g.id)).toContain('repeat');
  });

  it('assigns the oldest anyway rather than deadlocking when every group repeats', () => {
    const players = mkPlayers(4);
    const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];
    const queue = [{ id: 'only', players: ['p1', 'p2', 'p3', 'p4'], type: 'auto', createdAt: 1 }];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history, now: 0 });
    expect(res.assignments[0].groupId).toBe('only');
    expect(res.log).toContainEqual(
      expect.objectContaining({ step: 'fill', escape: 'allRepeatTakeOldest' })
    );
  });
});

/* ── partial groups (spec §3.2, §7) ──────────── */
describe('manual partial groups', () => {
  it('tops up a partial before building anything new from Available', () => {
    const players = mkPlayers(8);
    const queue = [{ id: 'g1', players: ['p1', 'p2'], type: 'manual', createdAt: 1 }];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history: [], now: 0 });
    expect(res.assignments[0].groupId).toBe('g1');
    expect(res.assignments[0].playerIds).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('leaves a partial intact when Available cannot complete it', () => {
    const players = mkPlayers(4);
    const courts = [withMatch(mkCourts(1)[0], ['p3', 'p4'])];
    const queue = [{ id: 'g1', players: ['p1'], type: 'manual', createdAt: 1 }];
    const res = runAutoPass({ players, courts, queue, history: [], now: 0 });
    expect(res.queue).toEqual(queue);
  });

  it('still tops the oldest partial up when courts are full and a group already waits', () => {
    const players = mkPlayers(8);
    const courts = [withMatch(mkCourts(1)[0], ['x1', 'x2', 'x3', 'x4'])];
    const queue = [
      { id: 'partial', players: ['p1', 'p2'], type: 'manual', createdAt: 10 },
      { id: 'waiting', players: ['p3', 'p4', 'p5', 'p6'], type: 'auto', createdAt: 20 },
    ];
    const res = runAutoPass({ players, courts, queue, history: [], now: 0 });
    expect(res.queue.find((g) => g.id === 'partial').players).toHaveLength(4);
    expect(res.created).toHaveLength(0);
  });

  it('picks top-up players closest to the partial group’s own mean value', () => {
    const players = mkPlayers(8).map((p, i) =>
      // p1,p2 sit on 3; p3..p6 on 0; p7,p8 on 3 as well.
      i < 2 || i > 5 ? { ...p, wins: 3 } : p
    );
    const queue = [{ id: 'g1', players: ['p1', 'p2'], type: 'manual', createdAt: 1 }];
    const res = runAutoPass({ players, courts: mkCourts(1), queue, history: [], now: 0 });
    expect([...res.assignments[0].playerIds].sort()).toEqual(['p1', 'p2', 'p7', 'p8']);
  });
});

/* ── Winners / Losers (spec §4) ──────────────── */
describe('Winners / Losers mode', () => {
  // p1..p4 played: p1,p2 won and p3,p4 lost. p5..p8 have never played.
  const history = [result('h1', ['p1', 'p2', 'p3', 'p4'])];

  it('is inactive with a single court — both mechanisms need a high and a low', () => {
    const players = mkPlayers(8);
    const shared = { players, courts: mkCourts(1), queue: [], history, now: 0 };
    const ladder = runAutoPass({ ...shared, matchingStyle: 'winnersLosers' });
    const balanced = runAutoPass({ ...shared, matchingStyle: 'balanced' });
    expect(ladder.assignments).toEqual(balanced.assignments);
    expect(ladder.log.find((l) => l.step === 'fill').role).toBe('neutral');
  });

  it('forces a previous-match loser into a group formed for an empty low court', () => {
    // p3 and p4 WON the last match; p1 and p2 lost it but are the two strongest
    // players on the floor, so value proximity on its own would leave them out
    // of the low court's group entirely. Only rule 4B can pull one in.
    const beaten = [result('h1', ['p3', 'p4', 'p1', 'p2'])];
    const players = mkPlayers(8).map((p) =>
      ['p1', 'p2'].includes(p.id) ? { ...p, wins: 2, losses: 1 }
      : ['p3', 'p4'].includes(p.id) ? { ...p, wins: 1 }
      : p
    );
    const courts = [withMatch(mkCourts(2)[0], ['x1', 'x2', 'x3', 'x4']), mkCourts(2)[1]];
    const res = runAutoPass({
      players, courts, queue: [], history: beaten, now: 0, matchingStyle: 'winnersLosers',
    });
    const fill = res.log.find((l) => l.step === 'fill' && l.filled);
    expect(fill.role).toBe('low');
    expect(fill.forcedLoser).toBe(true);
    expect(res.assignments[0].playerIds.some((id) => ['p1', 'p2'].includes(id))).toBe(true);
  });

  it('drops to relax2 when forcing that loser in repeats an opponent', () => {
    // p3 and p9 beat p4 and p10. p10 is still on court, so p4 is the only
    // selectable loser — and the cheapest group for the low court is built
    // around BOTH of the players who just beat them. Swapping p4 in for the
    // lower-valued of those two leaves the other one facing p4 again.
    const beaten = [result('h1', ['p3', 'p9', 'p4', 'p10'])];
    const players = mkPlayers(10).map((p) => {
      if (p.id === 'p3') return { ...p, wins: 1, losses: 1 }; // 0.5 — winner
      if (p.id === 'p9') return { ...p, wins: 1 };            // 1.0 — winner
      if (p.id === 'p4') return { ...p, wins: 2, losses: 1 }; // 1.5 — the loser
      if (p.id === 'p1' || p.id === 'p2') return p;           // 0.0 — neutral
      return { ...p, wins: 2 };                               // 2.0 — neutral
    });
    const courts = [
      withMatch(mkCourts(2)[0], ['p10', 'x1', 'x2', 'x3']),
      mkCourts(2)[1],
    ];
    const res = runAutoPass({
      players, courts, queue: [], history: beaten, now: 0, matchingStyle: 'winnersLosers',
    });
    const fill = res.log.find((l) => l.step === 'fill' && l.filled);
    expect(fill.forcedLoser).toBe(true);
    expect(fill.rung).toBe('relax2');
    expect(res.assignments[0].playerIds).toContain('p4');
  });

  it('fills the low court anyway when no previous-match loser is selectable', () => {
    // Everyone free is a winner or a newcomer; the two losers are on court.
    const players = mkPlayers(8);
    const courts = [
      withMatch(mkCourts(2)[0], ['p3', 'p4', 'p7', 'p8']),
      mkCourts(2)[1],
    ];
    const res = runAutoPass({
      players, courts, queue: [], history, now: 0, matchingStyle: 'winnersLosers',
    });
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].playerIds).toHaveLength(4);
  });

  it('does not rewrite an all-winner complete group sent to the low court', () => {
    const players = mkPlayers(8);
    const courts = [withMatch(mkCourts(2)[0], ['x1', 'x2', 'x3', 'x4']), mkCourts(2)[1]];
    // p1 and p2 won; give the group two more winners from a second match.
    const fullHistory = [result('h2', ['p1', 'p2', 'p5', 'p6']), ...history];
    const queue = [{ id: 'g1', players: ['p1', 'p2', 'p7', 'p8'], type: 'auto', createdAt: 1 }];
    const res = runAutoPass({
      players, courts, queue, history: fullHistory, now: 0, matchingStyle: 'winnersLosers',
    });
    expect([...res.assignments[0].playerIds].sort()).toEqual(['p1', 'p2', 'p7', 'p8']);
  });

  it('leaves composition to value proximity in balanced mode', () => {
    const players = mkPlayers(8);
    const courts = [withMatch(mkCourts(2)[0], ['x1', 'x2', 'x3', 'x4']), mkCourts(2)[1]];
    const res = runAutoPass({ players, courts, queue: [], history, now: 0, matchingStyle: 'balanced' });
    expect(res.log.find((l) => l.step === 'fill' && l.filled).role).toBe('neutral');
  });
});

/* ─────────────────────────────────────────────
   REQUIRED SIMULATION 1 — 24 players, 3 courts, 20 rounds (spec §13)
   ───────────────────────────────────────────── */
describe('simulation: 24 players / 3 courts / 20 rounds', () => {
  const run = () => simulate({ players: mkPlayers(24), courts: mkCourts(3), rounds: 20 });

  it('separates values over the session', () => {
    const { state } = run();
    const vals = state.players.map(playerValue);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(2);
  });

  it('never repeats the same four inside the cooldown', () => {
    const { state } = run();
    expect(sameFourViolations(state.history)).toEqual([]);
  });

  it('puts exactly four players on every court, every round', () => {
    const { passes } = run();
    const assigned = passes.flatMap((p) => p.assignments);
    expect(assigned.length).toBeGreaterThan(50);
    expect(assigned.every((a) => a.playerIds.length === 4)).toBe(true);
  });

  it('spreads play across the whole roster rather than cycling the same faces', () => {
    const { state } = run();
    const games = state.players.map((p) => p.wins + p.losses);
    expect(Math.min(...games)).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed input order and clock', () => {
    const a = run();
    const b = run();
    expect(b.state.history).toEqual(a.state.history);
    expect(b.passes.map((p) => p.assignments)).toEqual(a.passes.map((p) => p.assignments));
  });
});

/* ─────────────────────────────────────────────
   REQUIRED SIMULATION 2 — 5 players, 2 courts, 10 rounds (spec §13)
   The pathological case: the same four must recur, so the ladder has to give.
   ───────────────────────────────────────────── */
describe('simulation: 5 players / 2 courts / 10 rounds', () => {
  const run = () => simulate({ players: mkPlayers(5), courts: mkCourts(2), rounds: 10 });

  it('runs to completion without deadlocking or throwing', () => {
    expect(() => run()).not.toThrow();
    expect(run().passes).toHaveLength(10);
  });

  it('fills only one court — the other stays empty rather than taking a short group', () => {
    const { passes } = run();
    for (const p of passes) {
      expect(p.assignments).toHaveLength(1);
      expect(p.assignments[0].playerIds).toHaveLength(4);
    }
  });

  it('reports the court it could not fill instead of silently skipping it', () => {
    const { passes } = run();
    expect(passes[0].log).toContainEqual(
      expect.objectContaining({ step: 'fill', filled: false, reason: 'noEligibleFour' })
    );
  });

  it('never creates a waiting group it has no players for', () => {
    const { passes } = run();
    expect(passes.every((p) => p.created.length === 0)).toBe(true);
  });

  it('walks past the strict rung, reaching relax2 or beyond at least once', () => {
    const { passes } = run();
    const rungs = passes.flatMap((p) => p.log.map((l) => l.rung)).filter(Boolean);
    expect(rungs.some((r) => r !== 'strict')).toBe(true);
    expect(rungs.some((r) => ['relax2', 'relax3', 'giveUp'].includes(r))).toBe(true);
  });

  it('rotates the player who sits out rather than benching one person all night', () => {
    const { state } = run();
    const games = state.players.map((p) => p.wins + p.losses);
    expect(Math.min(...games)).toBeGreaterThan(4);
  });
});

/* ── determinism, generally ──────────────────── */
describe('determinism', () => {
  it('gives the same answer for the same inputs regardless of array order', () => {
    const players = mkPlayers(9);
    const shared = { courts: mkCourts(2), queue: [], history: [], now: 0 };
    const a = runAutoPass({ ...shared, players });
    const b = runAutoPass({ ...shared, players: [...players].reverse() });
    expect(b.assignments.map((x) => [...x.playerIds].sort())).toEqual(
      a.assignments.map((x) => [...x.playerIds].sort())
    );
  });

  it('does not mutate the inputs it is given', () => {
    const players = mkPlayers(12);
    const courts = mkCourts(2);
    const queue = [{ id: 'g1', players: ['p1', 'p2'], type: 'manual', createdAt: 1 }];
    const snapshot = JSON.stringify({ players, courts, queue });
    runAutoPass({ players, courts, queue, history: [], now: 0 });
    expect(JSON.stringify({ players, courts, queue })).toBe(snapshot);
  });
});
