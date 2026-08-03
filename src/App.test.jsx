import { describe, it, expect } from 'vitest';
import {
  SKILL_TIERS,
  skillRank,
  fmtElapsed,
  fmtMinutes,
  fmtDuration,
  estimateWait,
  balancedGroup,
  paymentInfo,
  isPaid,
  PAYMENT_STATUSES,
  matchRoster,
  findExactPlayer,
  playerForm,
  formScore,
  rankByForm,
  ladderGroup,
  recentPartners,
  partnerWeight,
  balancedFreshGroup,
  buildAutoGroup,
  allTimeLeaderboard,
  RANKED_MIN_GAMES,
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

/* ── estimateWait ───────────────────────────── */
describe('estimateWait', () => {
  const avg15 = 15 * 60 * 1000; // 15 min in ms

  it('first group with 1 open court → 1 round (~15 min)', () => {
    expect(estimateWait(0, 1, avg15)).toBe(avg15);
  });

  it('second group with 1 open court → 2 rounds (~30 min)', () => {
    expect(estimateWait(1, 1, avg15)).toBe(2 * avg15);
  });

  it('second group with 2 open courts → 1 round (~15 min)', () => {
    expect(estimateWait(1, 2, avg15)).toBe(avg15);
  });

  it('third group with 2 open courts → 2 rounds (~30 min)', () => {
    expect(estimateWait(2, 2, avg15)).toBe(2 * avg15);
  });

  it('returns null when there are no open play courts', () => {
    expect(estimateWait(0, 0, avg15)).toBeNull();
  });

  it('scales linearly with average game duration', () => {
    const avg20 = 20 * 60 * 1000;
    expect(estimateWait(0, 1, avg20)).toBe(avg20);
    expect(estimateWait(1, 1, avg20)).toBe(2 * avg20);
  });
});

/* ── fmtMinutes ─────────────────────────────── */
describe('fmtMinutes', () => {
  it('returns "Now!" for 0 ms', () => {
    expect(fmtMinutes(0)).toBe('Now!');
  });
  it('returns "Now!" for negative values', () => {
    expect(fmtMinutes(-1000)).toBe('Now!');
  });
  it('formats 15 minutes', () => {
    expect(fmtMinutes(15 * 60 * 1000)).toBe('~15 min');
  });
  it('formats 30 minutes', () => {
    expect(fmtMinutes(30 * 60 * 1000)).toBe('~30 min');
  });
  it('rounds to nearest minute', () => {
    expect(fmtMinutes(14.5 * 60 * 1000)).toBe('~15 min');
    expect(fmtMinutes(14.4 * 60 * 1000)).toBe('~14 min');
  });
});

/* ── fmtDuration ────────────────────────────── */
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
describe('playerForm', () => {
  it('reads the newest-first history so the first appearance is the latest game', () => {
    const history = [decided([1, 2], [3, 4]), decided([3, 4], [1, 2])];
    const form = playerForm(history);
    expect(form[1]).toEqual({ games: 2, wins: 1, losses: 1, last: 'W' });
    expect(form[3]).toEqual({ games: 2, wins: 1, losses: 1, last: 'L' });
  });

  it('skips casual and rental entries that recorded no result', () => {
    const history = [
      { players: [1, 2, 3, 4], type: 'casual' },
      { players: [1], type: 'rental' },
      decided([1], [2]),
    ];
    const form = playerForm(history);
    expect(form[1]).toEqual({ games: 1, wins: 1, losses: 0, last: 'W' });
    expect(form[2].last).toBe('L');
  });

  it('caps the window per player, not as a flat slice of history', () => {
    // Player 1 plays all six; player 2 only appears in the OLDEST entry, which a
    // flat history.slice(0, 5) would drop entirely.
    const history = [
      decided([1], [9]),
      decided([1], [9]),
      decided([1], [9]),
      decided([1], [9]),
      decided([1], [9]),
      decided([1, 2], [9]),
    ];
    const form = playerForm(history, 5);
    expect(form[1]).toEqual({ games: 5, wins: 5, losses: 0, last: 'W' });
    expect(form[9]).toEqual({ games: 5, wins: 0, losses: 5, last: 'L' });
    expect(form[2]).toEqual({ games: 1, wins: 1, losses: 0, last: 'W' });
  });

  it('honours a custom window', () => {
    const history = [decided([1], [2]), decided([1], [2]), decided([1], [2])];
    expect(playerForm(history, 2)[1].games).toBe(2);
  });

  it('returns nothing for an empty or missing history', () => {
    expect(playerForm([])).toEqual({});
    expect(playerForm(undefined)).toEqual({});
    expect(playerForm(null)).toEqual({});
  });
});

/* ── formScore ──────────────────────────────── */
describe('formScore', () => {
  it('scores an unknown or empty form as exactly 0', () => {
    expect(formScore(undefined)).toBe(0);
    expect(formScore(null)).toBe(0);
    expect(formScore({ games: 0, wins: 0, losses: 0, last: null })).toBe(0);
  });

  it('puts every won-last player above 0 and every lost-last player below it', () => {
    // Worst possible "won last" still beats the best possible "lost last".
    const wonLast = formScore({ games: 5, wins: 1, losses: 4, last: 'W' });
    const lostLast = formScore({ games: 5, wins: 4, losses: 1, last: 'L' });
    expect(wonLast).toBeGreaterThan(0);
    expect(lostLast).toBeLessThan(0);
    expect(wonLast).toBeGreaterThan(lostLast);
  });

  it('breaks ties between two winners on their record', () => {
    const perfect = formScore({ games: 2, wins: 2, losses: 0, last: 'W' });
    const patchy = formScore({ games: 2, wins: 1, losses: 1, last: 'W' });
    expect(perfect).toBeGreaterThan(patchy);
  });

  it('breaks ties between two losers on their record', () => {
    const decent = formScore({ games: 2, wins: 1, losses: 1, last: 'L' });
    const dire = formScore({ games: 2, wins: 0, losses: 2, last: 'L' });
    expect(decent).toBeGreaterThan(dire);
  });
});

/* ── rankByForm ─────────────────────────────── */
describe('rankByForm', () => {
  it('collapses to plain skill-descending when there is no history (F1 fallback)', () => {
    const shuffled = [tieredFour[2], tieredFour[0], tieredFour[3], tieredFour[1]];
    const form = playerForm([]);
    const legacy = [...shuffled].sort((a, b) => skillRank(b.skill) - skillRank(a.skill));
    expect(ids(rankByForm(shuffled, form))).toEqual(ids(legacy));
    expect(ids(rankByForm(shuffled, form))).toEqual([1, 2, 3, 4]);
  });

  it('ranks a recent winner above a higher-skilled recent loser', () => {
    const pro = { id: 1, skill: 'Pro' };
    const beginner = { id: 2, skill: 'Beginner' };
    const form = playerForm([decided([2], [1])]);
    expect(ids(rankByForm([pro, beginner], form))).toEqual([2, 1]);
  });

  it('is deterministic for players that are identical apart from id', () => {
    const form = playerForm([]);
    const a = ids(rankByForm(evenFour, form));
    const b = ids(rankByForm([...evenFour].reverse(), form));
    expect(a).toEqual(b);
  });
});

/* ── ladderGroup ────────────────────────────── */
describe('ladderGroup', () => {
  it('returns null when fewer than four are available', () => {
    expect(ladderGroup(evenFour.slice(0, 3), [])).toBeNull();
    expect(ladderGroup([], [])).toBeNull();
    expect(ladderGroup(undefined, [])).toBeNull();
  });

  it('gives each team one recent winner and one recent loser', () => {
    const history = [decided([1, 2], [3, 4])];
    const group = ladderGroup(evenFour, history);
    const won = new Set([1, 2]);
    const [t1a, t1b, t2a, t2b] = ids(group);
    expect(won.has(t1a)).not.toBe(won.has(t1b));
    expect(won.has(t2a)).not.toBe(won.has(t2b));
  });

  it('makes the two best performers opponents, not partners', () => {
    const history = [decided([1, 2], [3, 4])];
    const group = ids(ladderGroup(evenFour, history));
    // Slots [0,1] are team 1 and [2,3] team 2, so "not partners" means the two
    // in-form players land one per team.
    const teamOf = (id) => (group.indexOf(id) < 2 ? 1 : 2);
    expect(teamOf(1)).not.toBe(teamOf(2));
  });

  it('walks down the ladder: the next call groups the next four', () => {
    const six = [...evenFour, { id: 5, skill: 'Intermediate' }, { id: 6, skill: 'Intermediate' }];
    const history = [decided([1, 2], [5, 6])];
    const first = ids(ladderGroup(six, history));
    // Those four are on court now, so the second call sees only who is left.
    const rest = six.filter((p) => !first.includes(p.id));
    expect(rest).toHaveLength(2);
    expect(ladderGroup(rest, history)).toBeNull();
  });

  it('equals the plain skill-sorted snake draft when the history is empty', () => {
    const skillSorted = [...tieredFour].sort((a, b) => skillRank(b.skill) - skillRank(a.skill));
    expect(ladderGroup(tieredFour, [])).toEqual(balancedGroup(skillSorted));
  });
});

/* ── recentPartners / partnerWeight ─────────── */
describe('recentPartners', () => {
  it('reads teams from slots [0,1] and [2,3]', () => {
    const counts = recentPartners([{ players: [1, 2, 3, 4] }]);
    expect(partnerWeight(counts, 1, 2)).toBeGreaterThan(0);
    expect(partnerWeight(counts, 3, 4)).toBeGreaterThan(0);
    // Opponents are not partners.
    expect(partnerWeight(counts, 1, 3)).toBe(0);
    expect(partnerWeight(counts, 2, 4)).toBe(0);
  });

  it('weights the most recent game highest', () => {
    const counts = recentPartners([{ players: [1, 2, 3, 4] }, { players: [5, 6, 7, 8] }]);
    expect(partnerWeight(counts, 1, 2)).toBeGreaterThan(partnerWeight(counts, 5, 6));
  });

  it('accumulates weight for a pair that keeps repeating', () => {
    const once = recentPartners([{ players: [1, 2, 3, 4] }]);
    const twice = recentPartners([{ players: [1, 2, 3, 4] }, { players: [1, 2, 5, 6] }]);
    expect(partnerWeight(twice, 1, 2)).toBeGreaterThan(partnerWeight(once, 1, 2));
  });

  it('keys pairs independently of order', () => {
    const counts = recentPartners([{ players: [1, 2, 3, 4] }]);
    expect(partnerWeight(counts, 2, 1)).toBe(partnerWeight(counts, 1, 2));
  });

  it('ignores entries with fewer than four players', () => {
    const counts = recentPartners([{ players: [1, 2, 3] }, { players: [1] }, {}]);
    expect(partnerWeight(counts, 1, 2)).toBe(0);
    expect(counts.size).toBe(0);
  });

  it('respects the window', () => {
    const history = [
      { players: [1, 2, 3, 4] },
      { players: [5, 6, 7, 8] },
      { players: [9, 10, 11, 12] },
    ];
    const counts = recentPartners(history, 2);
    expect(partnerWeight(counts, 1, 2)).toBeGreaterThan(0);
    expect(partnerWeight(counts, 5, 6)).toBeGreaterThan(0);
    expect(partnerWeight(counts, 9, 10)).toBe(0);
  });

  it('scores an unseen pair as 0', () => {
    expect(partnerWeight(recentPartners([]), 1, 2)).toBe(0);
  });
});

/* ── balancedFreshGroup ─────────────────────── */
describe('balancedFreshGroup', () => {
  it('returns null when fewer than four are available', () => {
    expect(balancedFreshGroup(evenFour.slice(0, 3), [])).toBeNull();
    expect(balancedFreshGroup(undefined, [])).toBeNull();
  });

  it('returns the top four in snake order when there is no history', () => {
    const five = [...tieredFour, { id: 5, skill: 'Beginner' }];
    expect(balancedFreshGroup(five, [])).toEqual(balancedGroup(tieredFour));
    expect(ids(balancedFreshGroup(five, []))).toEqual([1, 4, 2, 3]);
  });

  it('re-splits the same four rather than repeating last round’s partnerships', () => {
    const group = ids(balancedFreshGroup(evenFour, [{ players: [1, 2, 3, 4] }]));
    const partnered = (a, b) => {
      const i = group.indexOf(a);
      const j = group.indexOf(b);
      return Math.floor(i / 2) === Math.floor(j / 2);
    };
    expect(partnered(1, 2)).toBe(false);
    expect(partnered(3, 4)).toBe(false);
  });

  it('drafts a free fifth player when every split of the top four repeats', () => {
    // Three rounds that between them used all three ways of splitting 1-4, so no
    // arrangement of those four is fresh — only reaching past them is.
    const history = [
      { players: [1, 4, 2, 3] }, // most recent
      { players: [1, 3, 2, 4] },
      { players: [1, 2, 3, 4] },
    ];
    const group = ids(balancedFreshGroup(evenFive, history));
    expect(group).toContain(5);
    const partnered = (a, b) => {
      const i = group.indexOf(a);
      const j = group.indexOf(b);
      return i >= 0 && j >= 0 && Math.floor(i / 2) === Math.floor(j / 2);
    };
    // Last round's partnerships are the most expensive; neither survives.
    expect(partnered(1, 4)).toBe(false);
    expect(partnered(2, 3)).toBe(false);
  });

  it('still terminates and returns a valid four when every pairing repeats', () => {
    // Six players, and a history long enough to have paired all 15 combinations,
    // so no choice is free of repeats. The search must pick a least-bad one, not
    // loop looking for a perfect answer.
    const six = [1, 2, 3, 4, 5, 6].map((id) => ({ id, skill: 'Intermediate' }));
    const pairs = [];
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) pairs.push([i + 1, j + 1]);
    const history = pairs.map(([a, b]) => ({
      players: [a, b, ...[1, 2, 3, 4, 5, 6].filter((x) => x !== a && x !== b).slice(0, 2)],
    }));
    const group = balancedFreshGroup(six, history, { partnerWindow: pairs.length });
    expect(group).toHaveLength(4);
    expect(new Set(ids(group)).size).toBe(4);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const history = [{ players: [1, 2, 3, 4] }, { players: [2, 5, 1, 3] }];
    const a = ids(balancedFreshGroup(evenFive, history));
    const b = ids(balancedFreshGroup(evenFive, history));
    expect(a).toEqual(b);
  });

  it('never picks the same player twice', () => {
    const history = [{ players: [1, 2, 3, 4] }, { players: [3, 5, 1, 2] }];
    const group = balancedFreshGroup(evenFive, history);
    expect(new Set(ids(group)).size).toBe(4);
  });
});

/* ── buildAutoGroup ─────────────────────────── */
describe('buildAutoGroup', () => {
  // A history that makes the two strategies visibly disagree: form order is not
  // the roster order, and every player is the same skill so nothing else can.
  const history = [decided([3, 4], [5, 1])];

  it('routes winnersLosers to the ladder', () => {
    expect(buildAutoGroup(evenFive, history, 'winnersLosers')).toEqual(
      ladderGroup(evenFive, history)
    );
  });

  it('routes balanced to the repeat-avoiding draft', () => {
    expect(buildAutoGroup(evenFive, history, 'balanced')).toEqual(
      balancedFreshGroup(evenFive, history)
    );
  });

  it('actually produces different groups for the two styles', () => {
    expect(ids(buildAutoGroup(evenFive, history, 'winnersLosers'))).not.toEqual(
      ids(buildAutoGroup(evenFive, history, 'balanced'))
    );
  });

  it('falls back to balanced for an unknown or missing style', () => {
    const expected = balancedFreshGroup(evenFive, history);
    expect(buildAutoGroup(evenFive, history, 'legacy-value')).toEqual(expected);
    expect(buildAutoGroup(evenFive, history, undefined)).toEqual(expected);
    expect(buildAutoGroup(evenFive, history)).toEqual(expected);
  });

  it('always returns exactly four players, or null', () => {
    for (const style of ['balanced', 'winnersLosers', 'nonsense']) {
      expect(buildAutoGroup(evenFive, history, style)).toHaveLength(4);
      expect(buildAutoGroup(evenFour.slice(0, 3), history, style)).toBeNull();
      expect(buildAutoGroup([], history, style)).toBeNull();
      expect(buildAutoGroup(undefined, history, style)).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   ALL-TIME RANKINGS (spec §F3)
   ═══════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════
   CLUB SLUG (spec §F4)
   ═══════════════════════════════════════════════════════════════════════ */
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
