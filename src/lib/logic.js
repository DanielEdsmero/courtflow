/* ─────────────────────────────────────────────
   Pure logic — no React, no Supabase, no DOM.
   Kept in its own module so the test suite can import it without booting the
   Supabase client (which throws when env vars are absent).
   ───────────────────────────────────────────── */

export const SKILL_TIERS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Pro'];
export const skillRank = (s) => SKILL_TIERS.indexOf(s);

export const fmtElapsed = (ms) => {
  const s = Math.floor(Math.max(ms, 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtMinutes = (ms) => {
  const m = Math.round(ms / 60000);
  return m <= 0 ? 'Now!' : `~${m} min`;
};

// Returns estimated wait in ms for queue group at `queueIndex`.
// Uses ceiling-division so group at index 0 still shows one round's wait
// (the caller decides if they should show "stepping on" instead).
export const estimateWait = (queueIndex, openPlayCourtsTotal, avgGameDurationMs) => {
  if (openPlayCourtsTotal === 0) return null;
  return Math.ceil((queueIndex + 1) / openPlayCourtsTotal) * avgGameDurationMs;
};

// Snake-draft team balancing: [A,B,C,D] sorted best→worst → [A,D,B,C]
// Team 1 = slots [0,1] = best+worst, Team 2 = slots [2,3] = 2nd+3rd.
export const balancedGroup = (sortedPlayers) => {
  if (sortedPlayers.length < 4) return sortedPlayers;
  const [a, b, c, d] = sortedPlayers;
  return [a, d, b, c];
};

// A brand new venue starts with four courts and an empty roster — staff add
// their own players (and photos) on the first day.
export const defaultCourts = () => [
  { id: 1, name: 'Court 1', type: 'open', match: null },
  { id: 2, name: 'Court 2', type: 'open', match: null },
  { id: 3, name: 'Court 3', type: 'open', match: null },
  { id: 4, name: 'Court 4', type: 'open', match: null },
];

// Timestamps survive JSON as numbers, but a jsonb round-trip through Postgres can
// hand them back as strings, and the court cards do arithmetic on them.
export const hydrateCourts = (courts) =>
  courts.map((c) => ({
    ...c,
    match: c.match
      ? {
          ...c.match,
          startedAt: Number(c.match.startedAt),
          endsAt: c.match.endsAt != null ? Number(c.match.endsAt) : null,
        }
      : null,
  }));
