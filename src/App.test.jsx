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
