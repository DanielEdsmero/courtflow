import { describe, it, expect } from 'vitest';
import {
  SKILL_TIERS,
  skillRank,
  fmtElapsed,
  fmtDuration,
  balancedGroup,
  fmtWaiting,
  paymentInfo,
  isPaid,
  PAYMENT_STATUSES,
  matchRoster,
  findExactPlayer,
  playerValue,
  closestByValue,
  randomFrom,
  allTimeLeaderboard,
  RANKED_MIN_GAMES,
  gamesToRank,
  sessionStreak,
  sessionLeaderboard,
  recentlyPlayed,
  restCost,
  slugify,
  isValidSlug,
} from './lib/logic.js';

/* ── fmtElapsed ─────────────────────────────── */
describe('fmtElapsed', () => {
  it('formats zero ms', () => {
    expect(fmtElapsed(0)).toBe('0:00');
  });
  it('formats 90 seconds', () => {
    expect(fmtElapsed(90_000)).toBe('1:30');
  });
  it('pads single-digit seconds', () => {
    expect(fmtElapsed(65_000)).toBe('1:05');
  });
  it('formats 1 hour as 60:00', () => {
    expect(fmtElapsed(3_600_000)).toBe('60:00');
  });
  it('clamps negative values to 0:00', () => {
    expect(fmtElapsed(-5_000)).toBe('0:00');
  });
});

/* ── skillRank ──────────────────────────────── */
describe('skillRank', () => {
  it('ranks Beginner as 0', () => expect(skillRank('Beginner')).toBe(0));
  it('ranks Novice as 1',   () => expect(skillRank('Novice')).toBe(1));
  it('ranks Intermediate as 2', () => expect(skillRank('Intermediate')).toBe(2));
  it('ranks Advanced as 3', () => expect(skillRank('Advanced')).toBe(3));
  it('ranks Pro as 4',      () => expect(skillRank('Pro')).toBe(4));
  it('returns -1 for unknown skill', () => expect(skillRank('Unknown')).toBe(-1));
  it('tiers are in ascending rank order', () => {
    const ranks = SKILL_TIERS.map(skillRank);
    expect(ranks).toEqual([0, 1, 2, 3, 4]);
  });
});

/* ── balancedGroup ──────────────────────────── */
describe('balancedGroup', () => {
  const players = [
    { id: 1, skill: 'Pro' },          // A — best
    { id: 2, skill: 'Advanced' },     // B
    { id: 3, skill: 'Intermediate' }, // C
    { id: 4, skill: 'Beginner' },     // D — worst
  ];

  it('reorders to snake-draft: [A, D, B, C]', () => {
    const result = balancedGroup(players);
    expect(result.map(p => p.id)).toEqual([1, 4, 2, 3]);
  });

  it('team 1 = [A, D] (best + worst)', () => {
    const result = balancedGroup(players);
    expect(result[0].id).toBe(1); // Pro
    expect(result[1].id).toBe(4); // Beginner
  });

  it('team 2 = [B, C] (middle two)', () => {
    const result = balancedGroup(players);
    expect(result[2].id).toBe(2); // Advanced
    expect(result[3].id).toBe(3); // Intermediate
  });

  it('passes through arrays shorter than 4 unchanged', () => {
    const two = players.slice(0, 2);
    expect(balancedGroup(two)).toEqual(two);
  });

  it('all four players are preserved', () => {
    const result = balancedGroup(players);
    expect(result).toHaveLength(4);
    expect(result.map(p => p.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

/* ── fmtWaiting (spec §9) ───────────────────── */
describe('fmtWaiting', () => {
  const t = 1_700_000_000_000;

  it('says "Just now" under a minute', () => {
    expect(fmtWaiting(t, t)).toBe('Just now');
    expect(fmtWaiting(t + 59_000, t)).toBe('Just now');
  });

  it('floors to whole elapsed minutes', () => {
    expect(fmtWaiting(t + 60_000, t)).toBe('1m');
    expect(fmtWaiting(t + 119_000, t)).toBe('1m');
    expect(fmtWaiting(t + 12 * 60_000, t)).toBe('12m');
  });

  it('rolls a long wait up rather than printing a four-digit minute count', () => {
    // The reported bug: a group left over from the night before read "1139 min".
    expect(fmtWaiting(t + 1139 * 60_000, t)).toBe('18h 59m');
    expect(fmtWaiting(t + 26 * 3_600_000, t)).toBe('1d 2h');
  });

  it('shows — rather than a guess when there is no usable createdAt', () => {
    // A group saved before createdAt existed has no age to report. Saying
    // "Just now" about it would be a lie that reads as fact.
    expect(fmtWaiting(t, undefined)).toBe('—');
    expect(fmtWaiting(t, null)).toBe('—');
    expect(fmtWaiting(t, 'nonsense')).toBe('—');
  });

  it('never reads a clock of its own — a stale group is measured, not predicted', () => {
    expect(fmtWaiting(t, t - 3 * 60_000)).toBe('3m');
  });
});

describe('fmtDuration', () => {
  it('formats sub-hour durations as minutes only', () => {
    expect(fmtDuration(15 * 60_000)).toBe('15m');
  });
  it('formats an hour-plus duration as "1h 15m"', () => {
    expect(fmtDuration(75 * 60_000)).toBe('1h 15m');
  });
  it('formats a whole hour with zero minutes', () => {
    expect(fmtDuration(60 * 60_000)).toBe('1h 0m');
  });
  it('clamps negative durations to 0m', () => {
    expect(fmtDuration(-5000)).toBe('0m');
  });
  it('rounds to the nearest minute', () => {
    expect(fmtDuration(89_000)).toBe('1m');
  });
});

/* ── Payment status ─────────────────────────── */
describe('payment status', () => {
  it('resolves each known status to its own config', () => {
    expect(paymentInfo('online').label).toBe('Paid — Online');
    expect(paymentInfo('cash').label).toBe('Paid — Cash');
    expect(paymentInfo('unpaid').label).toBe('Unpaid');
  });
  it('falls back to unpaid for unknown or missing status', () => {
    expect(paymentInfo(undefined)).toBe(PAYMENT_STATUSES.unpaid);
    expect(paymentInfo('legacy-value')).toBe(PAYMENT_STATUSES.unpaid);
  });
  it('treats online and cash as paid, unpaid as not', () => {
    expect(isPaid('online')).toBe(true);
    expect(isPaid('cash')).toBe(true);
    expect(isPaid('unpaid')).toBe(false);
    expect(isPaid(undefined)).toBe(false);
  });
});

/* ── Roster autocomplete (spec §1, §4, §6, §7) ─────── */
describe('matchRoster', () => {
  const roster = [
    { id: 1, name: 'Sarah',   skill: 'Advanced' },
    { id: 2, name: 'Sara',    skill: 'Novice' },
    { id: 3, name: 'Marissa', skill: 'Intermediate' }, // contains "sa" mid-string
    { id: 4, name: 'Mike',    skill: 'Beginner' },
  ];

  it('returns nothing for an empty or whitespace query', () => {
    expect(matchRoster(roster, '')).toEqual([]);
    expect(matchRoster(roster, '   ')).toEqual([]);
    expect(matchRoster(roster, null)).toEqual([]);
  });

  it('matches on a case-insensitive substring', () => {
    const names = matchRoster(roster, 'SAR').map(p => p.name);
    expect(names).toContain('Sarah');
    expect(names).toContain('Sara');
    expect(names).not.toContain('Mike');
  });

  it('ranks prefix matches above mid-string matches', () => {
    // "sa" is a prefix of Sarah/Sara but only mid-string in Marissa.
    const names = matchRoster(roster, 'sa').map(p => p.name);
    expect(names.indexOf('Marissa')).toBe(names.length - 1);
    expect(names.indexOf('Sara')).toBeLessThan(names.indexOf('Marissa'));
  });

  it('sorts alphabetically within the same match class', () => {
    expect(matchRoster(roster, 'sa').slice(0, 2).map(p => p.name)).toEqual(['Sara', 'Sarah']);
  });

  it('caps the number of results', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `Al${i}`, skill: 'Novice' }));
    expect(matchRoster(many, 'al', 6)).toHaveLength(6);
  });
});

describe('findExactPlayer', () => {
  const roster = [
    { id: 1, name: 'Sarah' },
    { id: 2, name: 'Mike' },
  ];

  it('finds an exact name ignoring case and surrounding space', () => {
    expect(findExactPlayer(roster, '  sarah ')?.id).toBe(1);
    expect(findExactPlayer(roster, 'MIKE')?.id).toBe(2);
  });

  it('returns undefined for a partial or absent name', () => {
    expect(findExactPlayer(roster, 'Sar')).toBeUndefined();
    expect(findExactPlayer(roster, 'Nobody')).toBeUndefined();
    expect(findExactPlayer(roster, '')).toBeUndefined();
  });
});

/* ── Queue logic (pure-function layer) ─────── */
describe('Queue group management', () => {
  const makeGroup = (id, players = [1, 2, 3, 4]) => ({ id, players, type: 'manual' });

  it('adding a group increases the queue', () => {
    const queue = [makeGroup(1)];
    const updated = [...queue, makeGroup(2)];
    expect(updated).toHaveLength(2);
  });

  it('removing a group by id decreases the queue', () => {
    const queue = [makeGroup(1), makeGroup(2), makeGroup(3)];
    const updated = queue.filter(g => g.id !== 2);
    expect(updated).toHaveLength(2);
    expect(updated.find(g => g.id === 2)).toBeUndefined();
  });

  it('preserves order of remaining groups after removal', () => {
    const queue = [makeGroup(1), makeGroup(2), makeGroup(3)];
    const updated = queue.filter(g => g.id !== 2);
    expect(updated[0].id).toBe(1);
    expect(updated[1].id).toBe(3);
  });

  // Mirrors dropOnQueuePlayer's swap branch: exchange two ids wherever they sit.
  const swap = (queue, a, b) =>
    queue.map(g => ({ ...g, players: g.players.map(id => (id === a ? b : id === b ? a : id)) }));

  it('swaps two players between full groups, preserving both slots', () => {
    const queue = [makeGroup(1, [1, 2, 3, 4]), makeGroup(2, [5, 6, 7, 8])];
    const updated = swap(queue, 2, 6); // trade player 2 (grp 1) with player 6 (grp 2)
    expect(updated[0].players).toEqual([1, 6, 3, 4]);
    expect(updated[1].players).toEqual([5, 2, 7, 8]);
  });

  it('keeps every group at its original size after a swap', () => {
    const queue = [makeGroup(1, [1, 2, 3, 4]), makeGroup(2, [5, 6, 7, 8])];
    const updated = swap(queue, 1, 8);
    expect(updated.map(g => g.players.length)).toEqual([4, 4]);
  });

  it('reorders within a single group when both ids share it', () => {
    const queue = [makeGroup(1, [1, 2, 3, 4])];
    expect(swap(queue, 1, 3)[0].players).toEqual([3, 2, 1, 4]);
  });
});

/* ── Win/loss tracking ──────────────────────── */
describe('Win/loss tracking', () => {
  const makePlayers = () => [
    { id: 1, wins: 0, losses: 0 },
    { id: 2, wins: 0, losses: 0 },
    { id: 3, wins: 0, losses: 0 },
    { id: 4, wins: 0, losses: 0 },
  ];

  const applyResult = (players, winners, losers) =>
    players.map(p => {
      if (winners.includes(p.id)) return { ...p, wins: p.wins + 1 };
      if (losers.includes(p.id))  return { ...p, losses: p.losses + 1 };
      return p;
    });

  it('awards winners +1 win', () => {
    const updated = applyResult(makePlayers(), [1, 2], [3, 4]);
    expect(updated.find(p => p.id === 1).wins).toBe(1);
    expect(updated.find(p => p.id === 2).wins).toBe(1);
  });

  it('awards losers +1 loss', () => {
    const updated = applyResult(makePlayers(), [1, 2], [3, 4]);
    expect(updated.find(p => p.id === 3).losses).toBe(1);
    expect(updated.find(p => p.id === 4).losses).toBe(1);
  });

  it('does not change unaffected players', () => {
    const extra = { id: 5, wins: 2, losses: 1 };
    const updated = applyResult([...makePlayers(), extra], [1, 2], [3, 4]);
    expect(updated.find(p => p.id === 5)).toEqual(extra);
  });
});

/* ── Auto-expire logic ──────────────────────── */
describe('Auto-expire court logic', () => {
  const makeMatch = (msAgo, durationMin) => {
    const startedAt = Date.now() - msAgo;
    const endsAt = durationMin ? startedAt + durationMin * 60_000 : null;
    return { players: [1, 2, 3, 4], startedAt, endsAt, durationMin };
  };

  const shouldExpireCasual = (court) => {
    if (!court.match?.endsAt) return false;
    return Date.now() >= court.match.endsAt;
  };

  const shouldExpireCompetitive = (court) => {
    if (!court.match?.endsAt) return false;
    if (court.type === 'rental') return Date.now() >= court.match.endsAt;
    return false; // competitive open-play courts wait for winner
  };

  it('casual court with elapsed timer should expire', () => {
    const court = { id: 1, type: 'open', match: makeMatch(20 * 60_000, 15) };
    expect(shouldExpireCasual(court)).toBe(true);
  });

  it('casual court with time remaining should NOT expire', () => {
    const court = { id: 1, type: 'open', match: makeMatch(5 * 60_000, 15) };
    expect(shouldExpireCasual(court)).toBe(false);
  });

  it('competitive open-play court with elapsed timer does NOT auto-expire', () => {
    const court = { id: 1, type: 'open', match: makeMatch(20 * 60_000, 15) };
    expect(shouldExpireCompetitive(court)).toBe(false);
  });

  it('rental court always expires when timer elapses', () => {
    const court = { id: 1, type: 'rental', match: makeMatch(70 * 60_000, 60) };
    expect(shouldExpireCasual(court)).toBe(true);
  });

  it('court with no timer (open duration) never auto-expires', () => {
    const court = { id: 1, type: 'open', match: makeMatch(60 * 60_000, null) };
    expect(shouldExpireCasual(court)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   MATCHING STYLES (spec §F1, §F2)
   ═══════════════════════════════════════════════════════════════════════ */

// Fixtures. Ids stay numeric — production uses uuids, and the pair keys and sort
// tie-breaks stringify precisely so both work.
const evenFour = [
  { id: 1, name: 'One',   skill: 'Intermediate' },
  { id: 2, name: 'Two',   skill: 'Intermediate' },
  { id: 3, name: 'Three', skill: 'Intermediate' },
  { id: 4, name: 'Four',  skill: 'Intermediate' },
];
const evenFive = [...evenFour, { id: 5, name: 'Five', skill: 'Intermediate' }];

const tieredFour = [
  { id: 1, name: 'Pro',   skill: 'Pro' },
  { id: 2, name: 'Adv',   skill: 'Advanced' },
  { id: 3, name: 'Inter', skill: 'Intermediate' },
  { id: 4, name: 'Nov',   skill: 'Novice' },
];

const ids = (group) => group.map((p) => p.id);
const decided = (winners, losers) => ({ players: [...winners, ...losers], winners, losers });

/* ── playerForm ─────────────────────────────── */
describe('playerValue', () => {
  it('starts everyone at zero', () => {
    expect(playerValue({ id: 1 })).toBe(0);
    expect(playerValue({ id: 1, wins: 0, losses: 0 })).toBe(0);
  });

  it('scores a win +1 and a loss -0.5', () => {
    expect(playerValue({ wins: 1, losses: 0 })).toBe(1);
    expect(playerValue({ wins: 0, losses: 1 })).toBe(-0.5);
    expect(playerValue({ wins: 3, losses: 2 })).toBe(2);
  });

  it('tolerates a player row with no counters at all', () => {
    expect(playerValue(undefined)).toBe(0);
    expect(playerValue(null)).toBe(0);
  });
});

/* -- player value fixtures ------------------ */
// value = wins - losses/2, so these read directly as the number in the comment.
const val = (id, wins = 0, losses = 0) => ({ id, name: `P${id}`, skill: 'Intermediate', wins, losses });

describe('closestByValue', () => {
  it('returns the free player nearest the departing value', () => {
    const free = [val(1, 5), val(2, 2), val(3)];
    expect(closestByValue(free, 2, []).id).toBe(2);
  });

  it('reaches either side of the target', () => {
    const free = [val(1, 4), val(2)]; // values 4 and 0
    expect(closestByValue(free, 3, []).id).toBe(1);
    expect(closestByValue(free, 1, []).id).toBe(2);
  });

  it('breaks a value tie toward whoever has waited longest', () => {
    // Both on 0; 1 just came off court, 2 has been waiting.
    const free = [val('1'), val('2')];
    expect(closestByValue(free, 0, [{ players: ['1', 'x', 'y', 'z'] }]).id).toBe('2');
  });

  it('returns null when nobody is free', () => {
    expect(closestByValue([], 0, [])).toBeNull();
    expect(closestByValue(undefined, 0, [])).toBeNull();
  });
});

/* ── randomFrom ─────────────────────────────── */
describe('randomFrom', () => {
  const three = [val(1), val(2), val(3)];

  it('indexes by the injected rng', () => {
    expect(randomFrom(three, () => 0).id).toBe(1);
    expect(randomFrom(three, () => 0.5).id).toBe(2);
    expect(randomFrom(three, () => 0.99).id).toBe(3);
  });

  it('never runs off the end when the rng returns exactly 1', () => {
    // Math.random() is documented as < 1, but a stub or a future engine quirk
    // must not produce undefined here.
    expect(randomFrom(three, () => 1)).toBe(three[2]);
  });

  it('can reach every candidate', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(randomFrom(three).id);
    expect(seen.size).toBe(3);
  });

  it('returns null when there is nobody to draw', () => {
    expect(randomFrom([])).toBeNull();
    expect(randomFrom(undefined)).toBeNull();
  });
});

describe('allTimeLeaderboard', () => {
  const player = (id, name, totalWins, totalLosses) => ({
    id,
    name,
    skill: 'Intermediate',
    totalWins,
    totalLosses,
    totalGames: totalWins + totalLosses,
  });

  it('splits ranked from unranked on the 10-game threshold', () => {
    const rows = [player(1, 'Veteran', 6, 6), player(2, 'Newbie', 5, 4)];
    const { ranked, unranked } = allTimeLeaderboard(rows);
    expect(ranked.map((r) => r.id)).toEqual([1]);
    expect(unranked.map((r) => r.id)).toEqual([2]);
  });

  it('ranks a player sitting exactly on the threshold', () => {
    const { ranked, unranked } = allTimeLeaderboard([player(1, 'Exactly', 5, 5)]);
    expect(ranked).toHaveLength(1);
    expect(unranked).toHaveLength(0);
    expect(RANKED_MIN_GAMES).toBe(10);
  });

  it('leaves a never-played player out of both lists but still counts them', () => {
    const { ranked, unranked, totalPlayers } = allTimeLeaderboard([
      player(1, 'Veteran', 6, 6),
      player(2, 'Signed up, never played', 0, 0),
    ]);
    expect(ranked.map((r) => r.id)).toEqual([1]);
    expect(unranked).toHaveLength(0);
    expect(totalPlayers).toBe(2);
  });

  it('sorts by win rate descending, breaking ties on games played', () => {
    const rows = [
      player(1, 'Thin', 8, 2), // 80% over 10
      player(2, 'Proven', 48, 12), // 80% over 60
      player(3, 'Steady', 12, 8), // 60% over 20
    ];
    expect(allTimeLeaderboard(rows).ranked.map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it('reads the all-time totals, never the session wins', () => {
    // Nine wins today, but this is their first ever session on a fresh venue —
    // the durable counters are what decides, so they cannot rank.
    const rows = [{ id: 1, name: 'Hot today', skill: 'Pro', wins: 9, losses: 0, totalGames: 0 }];
    const { ranked, unranked } = allTimeLeaderboard(rows);
    expect(ranked).toHaveLength(0);
    expect(unranked).toHaveLength(0);
  });

  it('remaps the all-time totals onto wins / defeats / games / rate', () => {
    const [row] = allTimeLeaderboard([player(1, 'Veteran', 9, 3)]).ranked;
    expect(row.wins).toBe(9);
    expect(row.defeats).toBe(3);
    expect(row.games).toBe(12);
    expect(row.rate).toBeCloseTo(0.75);
  });

  it('tolerates rows saved before the all-time columns existed', () => {
    const board = allTimeLeaderboard([{ id: 1, name: 'Legacy', skill: 'Novice' }]);
    expect(board.ranked).toHaveLength(0);
    expect(board.unranked).toHaveLength(0);
    expect(board.totalPlayers).toBe(1);
    expect(board.totalGames).toBe(0);
  });

  it('handles an empty or missing roster', () => {
    expect(allTimeLeaderboard([])).toEqual({
      ranked: [],
      unranked: [],
      totalPlayers: 0,
      totalGames: 0,
    });
    expect(allTimeLeaderboard(undefined).totalPlayers).toBe(0);
  });

  it('totals player-games, not venue games (four per doubles match)', () => {
    const rows = [player(1, 'A', 5, 5), player(2, 'B', 5, 5)];
    expect(allTimeLeaderboard(rows).totalGames).toBe(20);
  });

  it('honours a custom minimum', () => {
    const rows = [player(1, 'Short', 2, 1)];
    expect(allTimeLeaderboard(rows, 3).ranked.map((r) => r.id)).toEqual([1]);
  });
});

/* ── session rankings (spec §6) ─────────────── */
describe('sessionStreak', () => {
  it('reads newest first', () => {
    const history = [decided([1, 2], [3, 4]), decided([3, 4], [1, 2])];
    expect(sessionStreak(history, 1)).toEqual(['W', 'L']);
    expect(sessionStreak(history, 3)).toEqual(['L', 'W']);
  });

  it('skips games the player was not in', () => {
    const history = [decided([5, 6], [7, 8]), decided([1, 2], [3, 4])];
    expect(sessionStreak(history, 1)).toEqual(['W']);
  });

  it('skips entries with no recorded result', () => {
    const history = [{ players: [1, 2, 3, 4] }, decided([1, 2], [3, 4])];
    expect(sessionStreak(history, 1)).toEqual(['W']);
  });

  it('caps at the requested length', () => {
    const history = Array.from({ length: 9 }, () => decided([1, 2], [3, 4]));
    expect(sessionStreak(history, 1, 5)).toHaveLength(5);
    expect(sessionStreak(history, 1, 2)).toEqual(['W', 'W']);
  });

  it('matches ids across string/number boundaries', () => {
    expect(sessionStreak([decided(['1', '2'], ['3', '4'])], 1)).toEqual(['W']);
  });

  it('is empty for a player with no games', () => {
    expect(sessionStreak([], 1)).toEqual([]);
    expect(sessionStreak(undefined, 1)).toEqual([]);
  });
});

describe('sessionLeaderboard', () => {
  const players = [
    { id: 1, name: 'Ann', wins: 3, losses: 1 },
    { id: 2, name: 'Ben', wins: 3, losses: 0 },
    { id: 3, name: 'Cal', wins: 0, losses: 2 },
    { id: 4, name: 'Dee', wins: 0, losses: 0 }, // never played
  ];

  it('ranks on session wins, fewest losses breaking a tie', () => {
    const rows = sessionLeaderboard(players, []);
    expect(rows.map((r) => r.name)).toEqual(['Ben', 'Ann', 'Cal']);
  });

  it('leaves out anyone who has not played', () => {
    expect(sessionLeaderboard(players, []).map((r) => r.id)).not.toContain(4);
  });

  it('has no minimum-games threshold, unlike the all-time board', () => {
    const one = [{ id: 1, name: 'Ann', wins: 1, losses: 0 }];
    expect(sessionLeaderboard(one, [])).toHaveLength(1);
    // The same single game is far short of ranking all-time.
    expect(allTimeLeaderboard([{ ...one[0], totalGames: 1, totalWins: 1 }]).ranked).toHaveLength(0);
  });

  it('attaches each player’s own streak', () => {
    const history = [decided([1], [3]), decided([3], [1])];
    const rows = sessionLeaderboard(players, history);
    expect(rows.find((r) => r.id === 1).streak).toEqual(['W', 'L']);
    expect(rows.find((r) => r.id === 3).streak).toEqual(['L', 'W']);
  });

  it('never exposes the hidden value', () => {
    // Asserting the exact key set, not just the absence of a `value` field: the
    // point is that nothing this screen renders can be reverse-engineered into
    // the number the matcher groups on.
    const rows = sessionLeaderboard([{ id: 1, name: 'Ann', wins: 2, losses: 2 }], []);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['games', 'id', 'losses', 'name', 'photo', 'skill', 'streak', 'wins']
    );
  });

  it('is empty before anyone has finished a game', () => {
    expect(sessionLeaderboard([], [])).toEqual([]);
    expect(sessionLeaderboard(undefined, [])).toEqual([]);
  });
});

describe('gamesToRank', () => {
  it('counts down the games still needed', () => {
    expect(gamesToRank(3)).toBe('Needs 7 more games to rank');
    expect(gamesToRank(0)).toBe('Needs 10 more games to rank');
  });
  it('uses the singular for the last game', () => {
    expect(gamesToRank(9)).toBe('Needs 1 more game to rank');
  });
  it('never counts below zero', () => {
    expect(gamesToRank(10)).toBe('Ready to rank');
    expect(gamesToRank(40)).toBe('Ready to rank');
  });
  it('is null-safe and honours a custom minimum', () => {
    expect(gamesToRank(undefined)).toBe('Needs 10 more games to rank');
    expect(gamesToRank(1, 3)).toBe('Needs 2 more games to rank');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   REST FAIRNESS — stops the same strong four monopolising a court
   ═══════════════════════════════════════════════════════════════════════ */
describe('recentlyPlayed', () => {
  it('scores the players from the game that just finished highest', () => {
    const rest = recentlyPlayed([{ players: [1, 2, 3, 4] }, { players: [5, 6, 7, 8] }]);
    expect(restCost(rest, 1)).toBeGreaterThan(restCost(rest, 5));
  });

  it('scores someone who has not played at all as 0', () => {
    const rest = recentlyPlayed([{ players: [1, 2, 3, 4] }]);
    expect(restCost(rest, 99)).toBe(0);
  });

  it('keeps only a player’s most recent appearance', () => {
    // Playing twice running is no more tiring, for scheduling, than once just now.
    const twice = recentlyPlayed([{ players: [1, 2, 3, 4] }, { players: [1, 2, 5, 6] }]);
    const once = recentlyPlayed([{ players: [1, 2, 3, 4] }]);
    expect(restCost(twice, 1)).toBe(restCost(once, 1));
  });

  it('never exceeds 1 and decays with age', () => {
    const rest = recentlyPlayed([
      { players: [1, 2, 3, 4] },
      { players: [5, 6, 7, 8] },
      { players: [9, 10, 11, 12] },
    ]);
    expect(restCost(rest, 1)).toBe(1);
    expect(restCost(rest, 5)).toBeLessThan(1);
    expect(restCost(rest, 9)).toBeLessThan(restCost(rest, 5));
  });

  it('respects the window and an empty history', () => {
    const rest = recentlyPlayed([{ players: [1, 2, 3, 4] }, { players: [5, 6, 7, 8] }], 1);
    expect(restCost(rest, 1)).toBe(1);
    expect(restCost(rest, 5)).toBe(0);
    expect(recentlyPlayed([]).size).toBe(0);
    expect(recentlyPlayed(undefined).size).toBe(0);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates a normal club name', () => {
    expect(slugify('Smash Club')).toBe('smash-club');
  });

  it('collapses runs of punctuation and space into one hyphen', () => {
    expect(slugify('Ace  &  Volley!!')).toBe('ace-volley');
    expect(slugify('Court--Flow')).toBe('court-flow');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  The Pickle Pit  ')).toBe('the-pickle-pit');
    expect(slugify('!!Rally!!')).toBe('rally');
  });

  it('keeps digits', () => {
    expect(slugify('Courts 24/7')).toBe('courts-24-7');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('🏓🏓')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('is null-safe', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('isValidSlug', () => {
  it('accepts what slugify produces', () => {
    for (const name of ['Smash Club', 'Ace  &  Volley!!', 'Courts 24/7', 'Rally']) {
      expect(isValidSlug(slugify(name))).toBe(true);
    }
  });

  it('rejects uppercase, spaces and other punctuation', () => {
    expect(isValidSlug('Smash-Club')).toBe(false);
    expect(isValidSlug('smash club')).toBe(false);
    expect(isValidSlug('smash_club')).toBe(false);
    expect(isValidSlug('smash/club')).toBe(false);
  });

  it('rejects leading, trailing and doubled hyphens', () => {
    expect(isValidSlug('-smash')).toBe(false);
    expect(isValidSlug('smash-')).toBe(false);
    expect(isValidSlug('smash--club')).toBe(false);
  });

  it('rejects the empty slug and null', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug(null)).toBe(false);
    expect(isValidSlug(undefined)).toBe(false);
  });
});
