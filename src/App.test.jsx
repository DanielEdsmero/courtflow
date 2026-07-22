import { describe, it, expect } from 'vitest';
import {
  SKILL_TIERS,
  skillRank,
  fmtElapsed,
  fmtMinutes,
  estimateWait,
  balancedGroup,
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
