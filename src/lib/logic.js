/* ─────────────────────────────────────────────
   Pure logic — no React, no Supabase, no DOM.
   Kept in its own module so the test suite can import it without booting the
   Supabase client (which throws when env vars are absent).
   ───────────────────────────────────────────── */

// Wording lives in ../copy — this module owns behaviour, not text.
import { matchingStyles, payments } from '../copy/matching';
import { allTime } from '../copy/rankings';

export const SKILL_TIERS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Pro'];
export const skillRank = (s) => SKILL_TIERS.indexOf(s);

export const fmtElapsed = (ms) => {
  const s = Math.floor(Math.max(ms, 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// How long a queue group has been waiting (spec §9). Elapsed, never estimated:
// the old "~N min" chip multiplied a queue position by the average game length,
// which one long-running court turned into "~1347 min". `now` is passed in so
// this stays pure and the caller owns the clock.
export const fmtWaiting = (now, createdAt) => {
  if (createdAt == null || !Number.isFinite(Number(createdAt))) return 'Just now';
  const m = Math.floor((now - Number(createdAt)) / 60000);
  return m < 1 ? 'Just now' : `${m} min`;
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
    ...payments.online,
    icon: '✅',
    // Solid pill styles (dark theme, green = confirmed).
    badge: 'bg-emerald-500 text-zinc-950 border-emerald-400',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
  },
  cash: {
    value: 'cash',
    ...payments.cash,
    icon: '💵',
    badge: 'bg-amber-400 text-zinc-950 border-amber-300',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
  },
  unpaid: {
    value: 'unpaid',
    ...payments.unpaid,
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
  balanced: { value: 'balanced', ...matchingStyles.balanced },
  winnersLosers: { value: 'winnersLosers', ...matchingStyles.winnersLosers },
};

export const MATCHING_STYLE_ORDER = ['balanced', 'winnersLosers'];

// Tolerant lookup, same contract as paymentInfo above: an unknown or missing
// value (a session blob saved before this setting existed) reads as balanced.
export const matchingStyleInfo = (style) =>
  MATCHING_STYLES[style] || MATCHING_STYLES[DEFAULT_MATCHING_STYLE];

/* ─────────────────────────────────────────────
   REST FAIRNESS
   Who has been sitting the longest. Used to break ties between players the
   matcher rates identically, so a group that just came off court doesn't get
   handed the next one while newcomers watch.

   The queue engine (./queue-engine.js) owns group FORMATION now — this half
   survives because the replacement picker still needs it.
   ───────────────────────────────────────────── */

// How many past games count as "recent". Four is roughly one full rotation on a
// four-court floor.
export const PARTNER_WINDOW = 4;

// → Map<playerId, 0..1> where 1 means "played the game that just finished" and
// values decay to 0 at the edge of the window. Only a player's MOST RECENT
// appearance counts: playing twice in a row is no more tiring, for scheduling
// purposes, than playing once just now.
export const recentlyPlayed = (history, window = PARTNER_WINDOW) => {
  const rest = new Map();
  (history ?? []).slice(0, window).forEach((h, i) => {
    const ids = Array.isArray(h?.players) ? h.players : [];
    const w = (window - i) / window;
    for (const id of ids) {
      const k = String(id);
      if (!rest.has(k) || rest.get(k) < w) rest.set(k, w);
    }
  });
  return rest;
};

export const restCost = (rest, id) => rest.get(String(id)) ?? 0;

/* ─────────────────────────────────────────────
   PLAYER VALUE (hidden)
   A per-session number that says how today has gone: +1 a win, -0.5 a loss, per
   player and uncapped in both directions. Everyone starts a session on 0.

   It is DERIVED from the session win/loss counters rather than stored in a
   column of its own, and that is the whole trick:
     • those counters are already zeroed by resetSession(), so "values reset at
       the start of every session" is true for free — there is no second piece
       of state to forget to clear;
     • they are exact, where the session `history` array is trimmed to the last
       50 entries before it is synced, so a long day would quietly lose the
       early games;
     • it updates the instant a result is recorded, because finishMatch()
       already bumps them.
   Never rendered to players. The staff-only roster toggle in App.jsx is the one
   place it surfaces at all.
   ───────────────────────────────────────────── */
export const VALUE_WIN = 1;
export const VALUE_LOSS = -0.5;

export const playerValue = (p) => (p?.wins ?? 0) * VALUE_WIN + (p?.losses ?? 0) * VALUE_LOSS;

// "Who did you play WITH in the last 2 games" — the window the replacement
// picker rates rest over.
export const VALUE_PARTNER_WINDOW = 2;

/* ─────────────────────────────────────────────
   REPLACEMENT
   Someone is pulled out of a queued group mid-session; the stand-in is whoever
   is free with the nearest value, so the group stays as tight as the engine
   made it. Staff picking a replacement by hand go through the normal drag/click
   path instead, which is unfiltered and shows no values.
   ───────────────────────────────────────────── */
// The other way to fill a vacated slot: a straight draw. Offered alongside the
// closest-value pick because always taking the tightest stand-in can stack the
// same strong group all evening — a random draw is the honest tie-breaker when
// staff would rather spread the play around. `rng` is injectable so the choice
// is testable rather than a coin flip in a test suite.
export const randomFrom = (candidates, rng = Math.random) => {
  if (!candidates || candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)] ?? candidates[candidates.length - 1];
};

export const closestByValue = (candidates, targetValue, history, opts = {}) => {
  const { partnerWindow = VALUE_PARTNER_WINDOW } = opts;
  if (!candidates || candidates.length === 0) return null;
  const rest = recentlyPlayed(history, partnerWindow);
  return [...candidates].sort(
    (a, b) =>
      Math.abs(playerValue(a) - targetValue) - Math.abs(playerValue(b) - targetValue) ||
      restCost(rest, a.id) - restCost(rest, b.id) ||
      String(a.id).localeCompare(String(b.id))
  )[0];
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
   SESSION RANKINGS (spec §6)
   Today only, and a different question from allTimeLeaderboard: that one asks
   who is good, this one asks who is winning right now. So it ranks on raw wins
   rather than win rate, and has no minimum-games gate — one game is enough to
   appear. Built from the session counters and the session history, both of
   which resetSession() clears, so the board empties itself.
   Carries no value field on purpose: this screen is player-facing.
   ───────────────────────────────────────────── */

// How many recent results the streak chip shows.
export const SESSION_STREAK_LENGTH = 5;

// A player's own results, newest first, as 'W' / 'L'. Entries with no recorded
// result (casual court clears, rentals) carry neither array and are skipped, so
// only decided games count.
export const sessionStreak = (history, playerId, limit = SESSION_STREAK_LENGTH) => {
  const out = [];
  const target = String(playerId);
  for (const h of history ?? []) {
    if (out.length >= limit) break;
    const winners = Array.isArray(h?.winners) ? h.winners : [];
    const losers = Array.isArray(h?.losers) ? h.losers : [];
    if (winners.some((id) => String(id) === target)) out.push('W');
    else if (losers.some((id) => String(id) === target)) out.push('L');
  }
  return out;
};

// → rows, most wins first. Fewer losses breaks a tie (8-1 outranks 8-4), then
// name so the order is stable rather than roster-insertion order.
export const sessionLeaderboard = (
  players,
  history,
  { streakLength = SESSION_STREAK_LENGTH } = {}
) =>
  (players ?? [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      skill: p.skill,
      photo: p.photo,
      wins: p.wins ?? 0,
      losses: p.losses ?? 0,
      games: (p.wins ?? 0) + (p.losses ?? 0),
      streak: sessionStreak(history, p.id, streakLength),
    }))
    .filter((r) => r.games > 0)
    .sort(
      (a, b) => b.wins - a.wins || a.losses - b.losses || String(a.name).localeCompare(String(b.name))
    );

// The label under an unranked player. Phrased as what's left to do rather than
// as a bare "3/10", which reads like a score and buries the actual ask.
// Singular-aware: "Needs 1 more games" looks like a bug.
export const gamesToRank = (games, minGames = RANKED_MIN_GAMES) => {
  const remaining = Math.max(0, minGames - (games ?? 0));
  return remaining === 0 ? allTime.readyToRank : allTime.needsMoreGames(remaining);
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
