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

/* ─────────────────────────────────────────────
   MATCHING STYLE (spec §F1)
   How the Auto button decides who plays with whom. Two shapes, both ending in
   the same snake draft — the only thing that changes is what the four players
   are RANKED by before the draft happens:
     • balanced      — by skill tier, so every court gets a strong and a weak side
     • winnersLosers — by recent form, so a "winners court" and a "losers court"
                       emerge naturally and each team gets one of each.
   Lives in the session blob, so it's a club setting rather than a per-device one.
   ───────────────────────────────────────────── */
export const DEFAULT_MATCHING_STYLE = 'balanced';

export const MATCHING_STYLES = {
  balanced: {
    value: 'balanced',
    label: 'Balanced',
    short: 'Balanced',
    blurb: 'Pairs the strongest with the weakest, and avoids repeating partners.',
  },
  winnersLosers: {
    value: 'winnersLosers',
    label: 'Winners / Losers',
    short: 'Ladder',
    blurb: 'Groups players who are on form together — a winners court and a losers court.',
  },
};

export const MATCHING_STYLE_ORDER = ['balanced', 'winnersLosers'];

// Tolerant lookup, same contract as paymentInfo above: an unknown or missing
// value (a session blob saved before this setting existed) reads as balanced.
export const matchingStyleInfo = (style) =>
  MATCHING_STYLES[style] || MATCHING_STYLES[DEFAULT_MATCHING_STYLE];

/* ─────────────────────────────────────────────
   RECENT FORM (spec §F1)
   Derived from the session `history` array, never from a database column: the
   session wins/losses are zeroed on reset, and the all-time totals are far too
   coarse to say who is hot right now. Every entry finishMatch() produces carries
   `winners` and `losers`; casual and rental entries carry neither and are skipped.
   ───────────────────────────────────────────── */

// How many of a player's OWN most recent decided games count as "form". Per
// player rather than a flat slice of history, because with four courts running
// the last five entries only cover a fraction of the roster.
export const FORM_WINDOW = 5;

// history is newest-first (App pushes with [entry, ...prev]), so the first entry
// a player appears in is their most recent game.
// → { [playerId]: { games, wins, losses, last: 'W'|'L'|null } }
export const playerForm = (history, window = FORM_WINDOW) => {
  const form = {};
  for (const h of history ?? []) {
    const winners = Array.isArray(h?.winners) ? h.winners : [];
    const losers = Array.isArray(h?.losers) ? h.losers : [];
    if (winners.length === 0 && losers.length === 0) continue; // no result recorded
    for (const id of [...winners, ...losers]) {
      const f = form[id] || (form[id] = { games: 0, wins: 0, losses: 0, last: null });
      if (f.games >= window) continue;
      const won = winners.includes(id);
      if (f.games === 0) f.last = won ? 'W' : 'L';
      f.games += 1;
      if (won) f.wins += 1;
      else f.losses += 1;
    }
  }
  return form;
};

// One number, so form can be sorted. Deliberately banded:
//   won their last game  → +1 .. +3
//   no history at all    →  0        (so a newcomer never ranks as a loser)
//   lost their last game → -3 .. -1
// The last result dominates; the W-L record inside the window only breaks ties
// among players who all won — or all lost — their most recent game.
export const formScore = (f) => {
  if (!f || f.games === 0) return 0;
  const last = f.last === 'W' ? 1 : -1;
  const record = (f.wins - f.losses) / f.games; // -1 .. 1
  return last * 2 + record;
};

// Best form first. The skill tie-break is what makes the no-history fallback
// exact: with an empty history every formScore is 0, so this collapses to the
// original "sort by skillRank descending" and the snake draft below produces
// precisely the best+worst pairing it always did. The id tie-break keeps it
// deterministic (Array#sort is stable within an engine, but the input order into
// it is not something we want to depend on).
export const rankByForm = (players, form) =>
  [...players].sort(
    (a, b) =>
      formScore(form[b.id]) - formScore(form[a.id]) ||
      skillRank(b.skill) - skillRank(a.skill) ||
      String(a.id).localeCompare(String(b.id))
  );

// The winnersLosers group: take the four best-form available players, then snake
// draft them. Because those four are busy by the time Auto is pressed again,
// repeated calls walk DOWN the ladder — the first is the winners court, the next
// the rung below, and so on.
// Snake-drafting a form-ranked four means each team is one recent winner plus one
// recent loser, and the two in-form players end up as OPPONENTS, not partners.
export const ladderGroup = (players, history, { formWindow = FORM_WINDOW } = {}) => {
  if (!players || players.length < 4) return null;
  const form = playerForm(history, formWindow);
  return balancedGroup(rankByForm(players, form).slice(0, 4));
};

/* ─────────────────────────────────────────────
   REPEAT-PARTNER AVOIDANCE (spec §F2)
   The upgrade to the default balanced group: same snake draft, but pick WHICH
   four (and which of the three ways to split them) so nobody partners the same
   person two rounds running. Read out of the session history array — no new
   column. An entry's `players` is the on-court order and the finish modal treats
   slots [0,1] as team 1 and [2,3] as team 2, so partnerships are already implicit.
   ───────────────────────────────────────────── */

// How many past games count as "recent". Four is roughly one full rotation on a
// four-court floor — long enough to notice a repeat, short enough that a six
// player roster isn't punished forever for pairings it has no way to avoid.
export const PARTNER_WINDOW = 4;

// Order-independent key. Stringified because ids are uuids in production but
// plain numbers in the tests and in older session blobs.
const pairKey = (a, b) => [String(a), String(b)].sort().join('|');

// → Map<pairKey, weight>, where weight is recency: the immediately previous game
// scores `window`, the oldest one still in the window scores 1. So "partnered
// last round" costs four times as much as "partnered four rounds ago", and old
// repeats age out on their own without needing a second tuning knob.
export const recentPartners = (history, window = PARTNER_WINDOW) => {
  const counts = new Map();
  const bump = (k, w) => counts.set(k, (counts.get(k) ?? 0) + w);
  (history ?? []).slice(0, window).forEach((h, i) => {
    const ids = Array.isArray(h?.players) ? h.players : [];
    if (ids.length < 4) return; // rentals (one host) and short groups have no teams
    const w = window - i;
    bump(pairKey(ids[0], ids[1]), w);
    bump(pairKey(ids[2], ids[3]), w);
  });
  return counts;
};

export const partnerWeight = (counts, a, b) => counts.get(pairKey(a, b)) ?? 0;

// Every 4-subset of `arr`, as index tuples, in a fixed ascending order. Index
// tuples rather than objects so the caller gets "how far down the pool did we
// reach" for free. Bounded: the caller caps the pool at POOL_SIZE, so this is at
// most C(8,4) = 70 tuples. It cannot loop and cannot fail to return.
const combinations4 = (arr) => {
  const out = [];
  for (let i = 0; i <= arr.length - 4; i++)
    for (let j = i + 1; j <= arr.length - 3; j++)
      for (let k = j + 1; k <= arr.length - 2; k++)
        for (let l = k + 1; l <= arr.length - 1; l++) out.push([i, j, k, l]);
  return out;
};

// The three ways to split a skill-sorted [w,x,y,z] into two teams, as indexes
// into that array. The first is the snake draft — provably the most skill-even
// of the three for any sorted four — and is listed first so it wins every tie.
const SPLITS = [
  [0, 3, 1, 2], // w+z vs x+y  (snake)
  [0, 2, 1, 3], // w+y vs x+z
  [0, 1, 2, 3], // w+x vs y+z
];

// Only the strongest N available are considered. This keeps the search tiny AND
// stops repeat-avoidance from dragging a beginner onto a court full of Pros: the
// pool is already skill-adjacent, so any reshuffle inside it stays sensible.
export const POOL_SIZE = 8;

// Lexicographic priorities, encoded as weights so it stays a single comparison:
//   1. avoid recent partners                            (dominant)
//   2. stay near the top of the skill-sorted pool — i.e. behave like the old
//      "top four" rule whenever nothing else is at stake
//   3. keep the two teams even                          (picks the split)
const REPEAT_WEIGHT = 100;
const POSITION_WEIGHT = 10;

export const balancedFreshGroup = (
  players,
  history,
  { partnerWindow = PARTNER_WINDOW, pool = POOL_SIZE } = {}
) => {
  if (!players || players.length < 4) return null;

  const ranked = [...players].sort(
    (a, b) => skillRank(b.skill) - skillRank(a.skill) || String(a.id).localeCompare(String(b.id))
  );
  const candidates = ranked.slice(0, Math.max(4, pool));
  const partners = recentPartners(history, partnerWindow);

  let best = null;
  let bestCost = Infinity;

  for (const idx of combinations4(candidates)) {
    const four = idx.map((i) => candidates[i]); // still skill-descending
    const positionCost = idx[0] + idx[1] + idx[2] + idx[3]; // top four → 6, the minimum
    const ranks = four.map((p) => skillRank(p.skill));

    for (const [a, b, c, d] of SPLITS) {
      const repeats =
        partnerWeight(partners, four[a].id, four[b].id) +
        partnerWeight(partners, four[c].id, four[d].id);
      const imbalance = Math.abs(ranks[a] + ranks[b] - ranks[c] - ranks[d]);
      const cost = REPEAT_WEIGHT * repeats + POSITION_WEIGHT * positionCost + imbalance;
      // Strict < keeps the FIRST minimum found, and both loops run in a fixed
      // order, so identical inputs always produce identical output.
      if (cost < bestCost) {
        bestCost = cost;
        best = [four[a], four[b], four[c], four[d]];
      }
    }
  }
  return best;
};

/* ─────────────────────────────────────────────
   AUTO-GROUP ENTRY POINT
   The one function App.jsx calls. Returns four players in on-court order
   ([0,1] = team 1, [2,3] = team 2), or null when there aren't four to group —
   the caller decides how to complain about that.
   ───────────────────────────────────────────── */
export const buildAutoGroup = (
  available,
  history,
  matchingStyle = DEFAULT_MATCHING_STYLE,
  opts = {}
) => {
  if (!available || available.length < 4) return null;
  return matchingStyle === 'winnersLosers'
    ? ladderGroup(available, history, opts)
    : balancedFreshGroup(available, history, opts);
};

/* ─────────────────────────────────────────────
   ALL-TIME RANKINGS (spec §F3)
   Backed by players.total_* — the session wins/losses are wiped by every reset,
   so they can only ever answer "who is winning today".
   ───────────────────────────────────────────── */

// A ranking built off three games is noise. Below the threshold a player is
// still shown — with their record and how far off they are — just not ranked.
export const RANKED_MIN_GAMES = 10;

export const winRate = (wins, games) => (games > 0 ? wins / games : 0);

// → { ranked, unranked, totalPlayers, totalGames }
// `ranked` is win-rate descending, with more games breaking a tie, so a 10-game
// 80% doesn't outrank a 60-game 80%.
export const allTimeLeaderboard = (players, minGames = RANKED_MIN_GAMES) => {
  const rows = (players ?? []).map((p) => {
    const games = p.totalGames ?? 0;
    const wins = p.totalWins ?? 0;
    return { ...p, games, wins, defeats: p.totalLosses ?? 0, rate: winRate(wins, games) };
  });
  const ranked = rows
    .filter((r) => r.games >= minGames)
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.games - a.games ||
        b.wins - a.wins ||
        String(a.name).localeCompare(String(b.name))
    );
  const unranked = rows
    .filter((r) => r.games > 0 && r.games < minGames)
    .sort((a, b) => b.games - a.games || String(a.name).localeCompare(String(b.name)));
  return {
    ranked,
    unranked,
    totalPlayers: rows.length,
    // Player-games, not venue-games: each doubles match contributes four. The
    // rankings page shows the venue's own count from match_history instead.
    totalGames: rows.reduce((n, r) => n + r.games, 0),
  };
};

/* ─────────────────────────────────────────────
   CLUB SLUG (spec §F4)
   The printable /queue/<slug> URL. Postgres owns the canonical slug (see
   slugify() in schema.sql); this pair exists only to validate what came out of
   the address bar before spending an RPC on it, and to preview a slug in the UI.
   ───────────────────────────────────────────── */
export const slugify = (name) =>
  (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const isValidSlug = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s ?? '');

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
