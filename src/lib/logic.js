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

// Total elapsed time in a human "1h 15m" / "15m" shape — used for session length
// on the checkout screen and in the activity log.
export const fmtDuration = (ms) => {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
};

/* ─────────────────────────────────────────────
   PAYMENT STATUS
   One field on the player, three values. Everything about how a status looks
   (badge colour, emoji, label) lives here so the roster, group builder, queue,
   checkout screen and customer display all render it the same way.
   ───────────────────────────────────────────── */
export const PAYMENT_STATUSES = {
  online: {
    value: 'online',
    label: 'Paid — Online',
    short: 'Paid',
    method: 'Online',
    icon: '✅',
    // Solid pill styles (dark theme, green = confirmed).
    badge: 'bg-emerald-500 text-zinc-950 border-emerald-400',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
  },
  cash: {
    value: 'cash',
    label: 'Paid — Cash',
    short: 'Cash',
    method: 'Cash',
    icon: '💵',
    badge: 'bg-amber-400 text-zinc-950 border-amber-300',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
  },
  unpaid: {
    value: 'unpaid',
    label: 'Unpaid',
    short: 'Unpaid',
    method: null,
    icon: '🔴',
    badge: 'bg-rose-500 text-zinc-950 border-rose-400',
    dot: 'bg-rose-500',
    text: 'text-rose-400',
  },
};

export const PAYMENT_ORDER = ['online', 'cash', 'unpaid'];

// Tolerant lookup: anything unrecognised (including a legacy player saved before
// payment tracking existed) reads as unpaid so staff are prompted, not misled.
export const paymentInfo = (status) => PAYMENT_STATUSES[status] || PAYMENT_STATUSES.unpaid;

export const isPaid = (status) => status === 'online' || status === 'cash';

// Returns estimated wait in ms for queue group at `queueIndex`.
// Uses ceiling-division so group at index 0 still shows one round's wait
// (the caller decides if they should show "stepping on" instead).
export const estimateWait = (queueIndex, openPlayCourtsTotal, avgGameDurationMs) => {
  if (openPlayCourtsTotal === 0) return null;
  return Math.ceil((queueIndex + 1) / openPlayCourtsTotal) * avgGameDurationMs;
};

/* ─────────────────────────────────────────────
   ROSTER AUTOCOMPLETE (spec §1, §4, §6, §7)
   The roster is durable, so a returning player is already a row. These power the
   "New player name…" field: as staff type, surface matching existing players so
   one click re-checks them in — and an exact name never spawns a duplicate.
   ───────────────────────────────────────────── */

// Returning players whose name contains the typed query. Prefix matches rank
// above mid-string ones, then alphabetical. Empty query → nothing (the dropdown
// only appears once staff start typing). Capped so the list stays a glance.
export const matchRoster = (players, query, limit = 6) => {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [];
  return players
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q);
      const bp = b.name.toLowerCase().startsWith(q);
      if (ap !== bp) return ap ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
};

// Exact (case-insensitive) name match. Used on Add/Enter to re-check-in a
// returning player instead of creating a second account for the same person.
export const findExactPlayer = (players, name) => {
  const n = (name ?? '').trim().toLowerCase();
  return n ? players.find((p) => p.name.toLowerCase() === n) : undefined;
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
