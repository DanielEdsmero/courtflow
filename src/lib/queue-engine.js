/* ─────────────────────────────────────────────
   QUEUE ENGINE
   Pure, framework-free. No React, no Supabase, no DOM, and — deliberately — no
   wall clock: every time-dependent entry point takes `now` as an argument so a
   test can pin it and a group's createdAt is whatever the caller says it is.

   One entry point matters: runAutoPass(). Staff click Auto, the app hands the
   engine the whole world (players, courts, queue, history) and gets back a new
   queue plus a list of court assignments. The engine never mutates its inputs.

   The rules it implements, in the priority order they are applied:
     1. four-player guard        — fewer than four bodies anywhere → do nothing
     2. fill empty courts        — never with fewer than four players
     3. FIFO queue consumption   — complete groups, then partials, then new ones
     4. repeat-opponent ladder   — strict → relax1 → relax2 → relax3 → give up
     5. winners/losers           — high/low routing (soft) + low-court loser (hard)
     6. value proximity          — who is picked, and what breaks a tie
     7. check-in order           — the final tiebreak; never random
   ───────────────────────────────────────────── */

import { playerValue } from './logic';

/* How many of a player's OWN later matches must finish before a repeat is
   allowed. Sitting out burns nothing — this counts matches played, not time. */
export const COOLDOWN_MATCHES = 2;

/* The fallback ladder. Each rung drops one prohibition; `giveUp` is the label
   we record when even the loosest rung had to accept a repeated four. */
export const RUNGS = ['strict', 'relax1', 'relax2', 'relax3', 'giveUp'];
const LADDER = ['strict', 'relax1', 'relax2', 'relax3'];

/* Candidate generation. Sorting the pool by value puts every value-close four
   next to each other, so enumerating all C(8,4) quads inside a sliding window
   of eight covers every group worth considering without the cost (or the
   nondeterminism risk) of a full C(n,4) search on a big roster. */
const COMBO_WINDOW = 8;
/* The same idea for topping up a partial group: consider the nearest eight
   Available players by value distance, and enumerate the combinations of those. */
const TOPUP_WINDOW = 8;

/* ── small helpers ───────────────────────────────────────────────────────── */

const pairKey = (a, b) => [String(a), String(b)].sort().join('|');
const quadKey = (ids) => ids.map(String).sort().join('|');

// Every k-sized combination of `items`, in a fixed order. Deterministic by
// construction: same input array → same output sequence, every time.
export function combinations(items, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let i = start; i < items.length; i++) pick(i + 1, [...acc, items[i]]);
  };
  if (k >= 0 && k <= items.length) pick(0, []);
  return out;
}

// Lexicographic compare of two equal-length score tuples. Lower wins.
const cmpScore = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

const values = (four) => four.map(playerValue);
const spreadOf = (four) => Math.max(...values(four)) - Math.min(...values(four));
const meanOf = (four) => values(four).reduce((s, v) => s + v, 0) / four.length;

/* ─────────────────────────────────────────────
   HISTORY INDEX
   One pass over the session history answers every question the ladder asks.
   `history` is newest-first (App unshifts each finished match), so index 0 is
   the most recent game and a HIGHER index means further in the past.

   Only four-player entries count as matches: a rental carries one host id, and
   a group that never reached four was never a game.
   ───────────────────────────────────────────── */
export function buildHistoryIndex(history) {
  const entries = (history ?? []).filter(
    (h) => Array.isArray(h?.players) && h.players.length === 4
  );

  const appearances = new Map(); // id → ascending entry indexes (newest first)
  const lastOpponent = new Map();
  const lastPartner = new Map();
  const lastQuad = new Map();
  const lastResult = new Map(); // id → 'W' | 'L' | 'N' from their newest entry
  let decided = 0;

  const first = (map, k, i) => { if (!map.has(k)) map.set(k, i); };

  entries.forEach((h, i) => {
    const ids = h.players.map(String);
    const winners = (Array.isArray(h.winners) ? h.winners : []).map(String);
    const losers = (Array.isArray(h.losers) ? h.losers : []).map(String);
    if (winners.length || losers.length) decided += 1;

    for (const id of ids) {
      if (!appearances.has(id)) appearances.set(id, []);
      appearances.get(id).push(i);
      // Newest entry wins because we only ever set it once, walking newest→oldest.
      if (!lastResult.has(id)) {
        lastResult.set(id, winners.includes(id) ? 'W' : losers.includes(id) ? 'L' : 'N');
      }
    }

    first(lastQuad, quadKey(ids), i);
    // The on-court order is the team order: slots [0,1] vs slots [2,3].
    const t1 = [ids[0], ids[1]];
    const t2 = [ids[2], ids[3]];
    first(lastPartner, pairKey(t1[0], t1[1]), i);
    first(lastPartner, pairKey(t2[0], t2[1]), i);
    for (const a of t1) for (const b of t2) first(lastOpponent, pairKey(a, b), i);
  });

  // How many matches this player has finished SINCE entry `idx` — i.e. how many
  // of their appearances are newer than it. Newer means a smaller index.
  const playedSince = (id, idx) => {
    const mine = appearances.get(String(id)) ?? [];
    let n = 0;
    for (const i of mine) { if (i < idx) n += 1; else break; }
    return n;
  };

  const cooled = (ids, idx) =>
    idx === undefined || ids.every((id) => playedSince(id, idx) >= COOLDOWN_MATCHES);

  return {
    entries,
    // Has any match at all been decided this session? Rule 4B sleeps until one has.
    anyDecided: decided > 0,
    matchesPlayed: (id) => (appearances.get(String(id)) ?? []).length,
    // Index of a player's most recent match, or Infinity when they've not played.
    lastPlayedIndex: (id) => {
      const mine = appearances.get(String(id)) ?? [];
      return mine.length ? mine[0] : Infinity;
    },
    // 'W' / 'L' / 'N' — the result of their immediately previous match. A player
    // with no match, or whose last court was cleared without a result, is neutral.
    lastResult: (id) => lastResult.get(String(id)) ?? 'N',
    opponentBlocked: (a, b) => !cooled([a, b], lastOpponent.get(pairKey(a, b))),
    partnerBlocked: (a, b) => !cooled([a, b], lastPartner.get(pairKey(a, b))),
    quadBlocked: (ids) => !cooled(ids, lastQuad.get(quadKey(ids))),
  };
}

/* ─────────────────────────────────────────────
   ORDERING
   Two different orders, and mixing them up is the classic starvation bug.

   • checkInOrder  — the deterministic final tiebreak the spec asks for. Pure
     arrival time; it never changes during a session.
   • availableOrder — the actual shape of the Available list. Players who have
     just come off court sit at the BACK of it, so the same four can't cycle
     onto a court forever while newcomers watch. Within one standing it still
     falls back to check-in order, so nothing here is random.
   ───────────────────────────────────────────── */

export function checkInOrder(players) {
  const rank = new Map();
  [...players]
    .sort(
      (a, b) =>
        (a.checkedInAt ?? 0) - (b.checkedInAt ?? 0) ||
        String(a.id).localeCompare(String(b.id))
    )
    .forEach((p, i) => rank.set(String(p.id), i));
  return (p) => rank.get(String(p?.id)) ?? Number.MAX_SAFE_INTEGER;
}

export function availableOrder(players, H, order) {
  const rank = new Map();
  [...players]
    .sort(
      (a, b) =>
        // Larger lastPlayedIndex = longer ago (Infinity = never) = further front.
        H.lastPlayedIndex(b.id) - H.lastPlayedIndex(a.id) ||
        order(a) - order(b)
    )
    .forEach((p, i) => rank.set(String(p.id), i));
  return (p) => rank.get(String(p?.id)) ?? Number.MAX_SAFE_INTEGER;
}

/* ─────────────────────────────────────────────
   TEAMS (snake draft)
   Rank the four by value, highest first, check-in order breaking ties. Team 1
   is the highest and the lowest; team 2 is the middle two. Returned in on-court
   order — slots [0,1] are team 1, slots [2,3] are team 2 — which is the shape
   the court card, the finish modal and the history entry all already expect.
   ───────────────────────────────────────────── */
export function draftTeams(four, order) {
  const [w, x, y, z] = [...four].sort(
    (a, b) => playerValue(b) - playerValue(a) || order(a) - order(b)
  );
  return [w, z, x, y];
}

/* ── the repeat ladder ───────────────────────────────────────────────────── */

// What a drafted four would repeat. Evaluated on the ACTUAL teams, not on the
// bare set of four — who partners whom is decided before this runs.
export function violationsOf(drafted, H) {
  const t1 = [drafted[0], drafted[1]];
  const t2 = [drafted[2], drafted[3]];
  return {
    quad: H.quadBlocked(drafted.map((p) => p.id)),
    opponent: t1.some((a) => t2.some((b) => H.opponentBlocked(a.id, b.id))),
    partner:
      H.partnerBlocked(t1[0].id, t1[1].id) || H.partnerBlocked(t2[0].id, t2[1].id),
  };
}

export const passesRung = (v, rung) => {
  if (rung === 'strict') return !v.quad && !v.opponent && !v.partner;
  if (rung === 'relax1') return !v.quad && !v.opponent;
  if (rung === 'relax2') return !v.quad;
  return true; // relax3 — same-4 allowed, because nothing lower worked
};

/* ─────────────────────────────────────────────
   WINNERS / LOSERS
   Two separate mechanisms, both asleep unless the club is in winnersLosers mode
   AND there are at least two open-play courts (with one court, court 1 would be
   both the high and the low court).
   ───────────────────────────────────────────── */

// Court 1 is the high court, the highest-numbered court is the low court, and
// everything between is neutral. "Numbered" is the order the courts are held in,
// which is the order they are displayed and named in — so removing or renaming a
// court re-derives the ends rather than stranding them.
export function courtRoles(openCourts) {
  const roles = new Map();
  if (openCourts.length < 2) {
    openCourts.forEach((c) => roles.set(c.id, 'neutral'));
    return roles;
  }
  openCourts.forEach((c, i) =>
    roles.set(c.id, i === 0 ? 'high' : i === openCourts.length - 1 ? 'low' : 'neutral')
  );
  return roles;
}

const isLoser = (p, H) => H.lastResult(p.id) === 'L';
const isWinner = (p, H) => H.lastResult(p.id) === 'W';

/* ─────────────────────────────────────────────
   SELECTION
   Given a pool and a target role, pick four. Candidates are scored lowest-first:
     • high court — highest mean value first (winners drift up the ladder),
     • low court  — lowest mean value first (losers drift down),
     • otherwise  — pure value proximity.
   Value spread breaks the routing tie, and the Available order breaks that one,
   so a long-waiting player beats an identical player who just came off court.
   ───────────────────────────────────────────── */

const scoreFor = (four, role, avail) => {
  const base = [spreadOf(four), four.reduce((s, p) => s + avail(p), 0)];
  if (role === 'high') return [-meanOf(four), ...base];
  if (role === 'low') return [meanOf(four), ...base];
  return base;
};

// Walk the ladder from `fromRung` down, returning the best group at the first
// rung that yields one. `filter` is an extra hard gate (rule 4B uses it).
function pickBest(candidates, { role, H, order, avail, fromRung = 'strict', filter = null }) {
  const start = Math.max(0, LADDER.indexOf(fromRung));
  for (let r = start; r < LADDER.length; r++) {
    const rung = LADDER[r];
    let best = null;
    let bestScore = null;
    for (const four of candidates) {
      const drafted = draftTeams(four, order);
      if (filter && !filter(drafted)) continue;
      const v = violationsOf(drafted, H);
      if (!passesRung(v, rung)) continue;
      const score = scoreFor(drafted, role, avail);
      // Strict < keeps the first minimum, and `candidates` is built in a fixed
      // order, so identical inputs always produce identical output.
      if (bestScore === null || cmpScore(score, bestScore) < 0) {
        bestScore = score;
        best = { four: drafted, rung, violations: v };
      }
    }
    if (best) return best.violations.quad ? { ...best, rung: 'giveUp' } : best;
  }
  return null;
}

// Every four worth considering out of a value-sorted pool.
function quadCandidates(pool) {
  if (pool.length < 4) return [];
  const seen = new Set();
  const out = [];
  for (let s = 0; s + 4 <= pool.length; s++) {
    for (const four of combinations(pool.slice(s, s + COMBO_WINDOW), 4)) {
      const k = quadKey(four.map((p) => p.id));
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(four);
    }
  }
  return out;
}

const byValueThenOrder = (avail) => (a, b) =>
  playerValue(b) - playerValue(a) || avail(a) - avail(b);

/* Rule 4B. A group being formed (or completed) for an empty low court must
   contain someone who lost their immediately previous match — but only when such
   a player is actually selectable. The escape clause exists because filling the
   court beats every composition preference. */
function applyLowCourtRule(base, pool, ctx, candidates, protectedIds = new Set()) {
  const { H, order, avail } = ctx;
  if (!H.anyDecided) return base; // no match has finished yet — everyone is neutral
  if (base.four.some((p) => isLoser(p, H))) return base;

  const chosen = new Set(base.four.map((p) => String(p.id)));
  const losers = pool.filter((p) => isLoser(p, H) && !chosen.has(String(p.id)));
  if (losers.length === 0) return { ...base, escape: 'noEligibleLoser' };

  // The spec's literal substitution: drop the lowest-value winner in the
  // candidate group for the eligible loser closest to them in value. When the
  // group holds no winner at all (everyone neutral) the lowest-value neutral
  // player is the one who makes way — the point of the rule is that a loser ends
  // up on the court, not which specific body leaves. Players staff put in a
  // partial group by hand are protected: 4B may only move the top-up picks.
  const movable = base.four.filter((p) => !protectedIds.has(String(p.id)));
  if (movable.length === 0) return { ...base, escape: 'noEligibleLoser' };
  const droppable = movable.filter((p) => isWinner(p, H));
  const outgoing = [...(droppable.length ? droppable : movable)].sort(
    (a, b) => playerValue(a) - playerValue(b) || avail(b) - avail(a)
  )[0];
  const target = playerValue(outgoing);
  const incoming = [...losers].sort(
    (a, b) =>
      Math.abs(playerValue(a) - target) - Math.abs(playerValue(b) - target) ||
      avail(a) - avail(b)
  )[0];

  const substituted = draftTeams(
    base.four.map((p) => (p.id === outgoing.id ? incoming : p)),
    order
  );
  const v = violationsOf(substituted, H);
  // Forcing a loser in can collide with the repeat rules. When it does, the
  // spec says the ladder RESTARTS at relax2 — the loser matters more than a
  // repeated opponent — but same-4 stays prohibited until relax3.
  const fromRung = v.quad ? 'relax3' : v.opponent ? 'relax2' : base.rung;

  const forced = pickBest(candidates, {
    ...ctx,
    role: ctx.role === 'low' ? 'low' : null,
    fromRung,
    filter: (four) => four.some((p) => isLoser(p, H)),
  });
  return forced
    ? { ...forced, forcedLoser: true }
    : { four: substituted, rung: v.quad ? 'giveUp' : fromRung, violations: v, forcedLoser: true };
}

/* Form a brand-new group of four out of `pool`. `role` is the court it is being
   formed FOR ('high' | 'low' | 'neutral'), or null for a waiting group that is
   not aimed at any court — 4A and 4B only apply to a real target. */
export function selectFreshGroup(pool, ctx) {
  const { role, H, avail } = ctx;
  if (pool.length < 4) return null;
  const sorted = [...pool].sort(byValueThenOrder(avail));
  const candidates = quadCandidates(sorted);
  const base = pickBest(candidates, ctx);
  if (!base) return null;
  if (role !== 'low') return base;
  return applyLowCourtRule(base, sorted, ctx, candidates);
}

/* Top up a manual partial group (1–3 players) from the pool. Who joins is
   decided by value proximity to the MEAN of the players already in the group —
   staff put those people together on purpose, so the group's own centre of
   gravity is the target, not the pool's. */
export function completePartialGroup(partial, pool, ctx) {
  const { role, H, avail } = ctx;
  const need = 4 - partial.length;
  if (need <= 0 || need > 3 || pool.length < need) return null;

  // A group with nobody in it has no mean of its own — fall back to overall
  // value proximity within Available, i.e. the plain fresh-group selection.
  if (partial.length === 0) return selectFreshGroup(pool, ctx);

  const mean = meanOf(partial);
  const near = [...pool]
    .sort(
      (a, b) =>
        Math.abs(playerValue(a) - mean) - Math.abs(playerValue(b) - mean) ||
        avail(a) - avail(b)
    )
    .slice(0, Math.max(need, TOPUP_WINDOW));

  const candidates = combinations(near, need).map((extra) => [...partial, ...extra]);
  if (candidates.length === 0) return null;

  // Distance from the partial group's mean replaces raw spread here, so the
  // top-up keeps the group staff built rather than re-centring it.
  const distance = (four) =>
    four.reduce((s, p) => s + Math.abs(playerValue(p) - mean), 0);
  let best = null;
  for (let r = 0; r < LADDER.length && !best; r++) {
    const rung = LADDER[r];
    let bestScore = null;
    for (const four of candidates) {
      const drafted = draftTeams(four, ctx.order);
      const v = violationsOf(drafted, H);
      if (!passesRung(v, rung)) continue;
      const score = [distance(drafted), drafted.reduce((s, p) => s + avail(p), 0)];
      if (bestScore === null || cmpScore(score, bestScore) < 0) {
        bestScore = score;
        best = { four: drafted, rung: v.quad ? 'giveUp' : rung, violations: v };
      }
    }
  }
  if (!best || role !== 'low') return best;
  const locked = new Set(partial.map((p) => String(p.id)));
  return applyLowCourtRule(best, pool, ctx, candidates, locked);
}

/* ─────────────────────────────────────────────
   THE AUTO PASS
   Everything above is a building block; this is the only function App calls.
   It never mutates its arguments and never reads the clock.
   ───────────────────────────────────────────── */

const isComplete = (g) => g.players.length === 4;
const isPartial = (g) => g.players.length > 0 && g.players.length < 4;

/* FIFO means formation time, not array position — a group can be re-ordered in
   the queue without becoming younger. Groups saved before createdAt existed sort
   as oldest, which is the honest reading of "we don't know, but it was earlier". */
const oldestFirst = (groups) =>
  groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.createdAt ?? 0) - (b.g.createdAt ?? 0) || a.i - b.i)
    .map((x) => x.g);

// Group ids are derived from `now` plus a sequence rather than Date.now() at the
// call site: two groups created in the same pass must not collide, and a test
// pinning `now` must get the same ids twice.
const makeIds = (now) => {
  let n = 0;
  return () => `g${now}-${n++}`;
};

export function runAutoPass({
  players = [],
  courts = [],
  queue = [],
  history = [],
  matchingStyle = 'balanced',
  now = 0,
} = {}) {
  const log = [];
  const assignments = [];
  const nextId = makeIds(now);

  const byId = new Map(players.map((p) => [String(p.id), p]));
  const resolve = (ids) => ids.map((id) => byId.get(String(id))).filter(Boolean);

  const H = buildHistoryIndex(history);
  const order = checkInOrder(players);

  // Working copies — the queue is rebuilt as we consume it.
  let work = queue.map((g) => ({ ...g, players: [...g.players] }));

  const onCourt = new Set();
  courts.forEach((c) => (c.match?.players ?? []).forEach((id) => onCourt.add(String(id))));
  const queued = new Set();
  work.forEach((g) => g.players.forEach((id) => queued.add(String(id))));

  let pool = players.filter(
    (p) => !p.checkedOut && !onCourt.has(String(p.id)) && !queued.has(String(p.id))
  );

  // ── Rule 1: the four-player guard ───────────────────────────────────────
  // Everyone the engine could possibly draw on: Available plus everyone already
  // sitting in a queue group. Below four there is no group to make and no court
  // to fill, whatever the courts look like.
  const bodies = pool.length + work.reduce((n, g) => n + g.players.length, 0);
  if (bodies < 4) {
    log.push({ step: 'guard', bodies, blocked: true });
    return { queue, assignments, created: [], log, reason: 'needMorePlayers' };
  }

  const openCourts = courts.filter((c) => c.type === 'open');
  const roles = courtRoles(openCourts);
  const wl = matchingStyle === 'winnersLosers' && openCourts.length >= 2;
  const roleFor = (court) => (wl ? roles.get(court.id) ?? 'neutral' : 'neutral');

  let avail = availableOrder(pool, H, order);
  const ctx = () => ({ H, order, avail });

  const consume = (four) => {
    const taken = new Set(four.map((p) => String(p.id)));
    pool = pool.filter((p) => !taken.has(String(p.id)));
    avail = availableOrder(pool, H, order);
  };

  /* ── Rule 3.1: complete queue groups, oldest first ─────────────────────
     A complete group is an immutable set of four: the engine picks WHICH group
     goes on, never who is in it. Only the strict rung applies, and if every
     waiting group repeats, the oldest goes on anyway rather than deadlocking. */
  const takeCompleteGroup = () => {
    const complete = oldestFirst(work.filter(isComplete));
    if (complete.length === 0) return null;
    for (const g of complete) {
      const four = resolve(g.players);
      if (four.length < 4) continue; // a member was removed from the roster
      const drafted = draftTeams(four, order);
      const v = violationsOf(drafted, H);
      if (!v.quad && !v.opponent) return { group: g, four: drafted, rung: 'strict' };
    }
    // Everything repeats — take the oldest that still resolves to four players.
    for (const g of complete) {
      const four = resolve(g.players);
      if (four.length === 4) {
        return {
          group: g,
          four: draftTeams(four, order),
          rung: 'relax2',
          escape: 'allRepeatTakeOldest',
        };
      }
    }
    return null;
  };

  /* ── Rule 3.2: manual partial groups, oldest first ─────────────────────── */
  const takePartialGroup = (role) => {
    for (const g of oldestFirst(work.filter(isPartial))) {
      const partial = resolve(g.players);
      if (partial.length !== g.players.length) continue;
      const picked = completePartialGroup(partial, pool, { ...ctx(), role });
      if (picked) return { group: g, ...picked, source: 'partial' };
    }
    return null;
  };

  const dropGroup = (id) => { work = work.filter((g) => g.id !== id); };

  // ── Rule 2: fill every empty court we can ───────────────────────────────
  const emptyCourts = openCourts.filter((c) => !c.match);
  for (const court of emptyCourts) {
    const role = roleFor(court);

    let picked = takeCompleteGroup();
    let source = 'queue';
    if (picked) {
      dropGroup(picked.group.id);
    } else {
      picked = takePartialGroup(role);
      if (picked) {
        source = 'partial';
        // The players who topped it up leave Available with it.
        const already = new Set(picked.group.players.map(String));
        consume(picked.four.filter((p) => !already.has(String(p.id))));
        dropGroup(picked.group.id);
      } else {
        picked = selectFreshGroup(pool, { ...ctx(), role });
        source = 'fresh';
        if (picked) consume(picked.four);
      }
    }

    if (!picked) {
      log.push({ step: 'fill', courtId: court.id, filled: false, reason: 'noEligibleFour' });
      continue;
    }
    assignments.push({
      courtId: court.id,
      groupId: picked.group?.id ?? null,
      playerIds: picked.four.map((p) => p.id),
    });
    log.push({
      step: 'fill',
      courtId: court.id,
      filled: true,
      source,
      role,
      rung: picked.rung,
      escape: picked.escape ?? null,
      forcedLoser: picked.forcedLoser ?? false,
    });
  }

  /* ── Rule 7: the partial-queue exception ────────────────────────────────
     Courts are full now. The oldest manual partial still gets topped up if
     Available can cover it, so a group staff built by hand can never be stranded
     behind an auto-created waiting group. It keeps its own createdAt: topping a
     group up does not restart its wait. */
  const partialTop = takePartialGroup(null);
  if (partialTop) {
    const already = new Set(partialTop.group.players.map(String));
    consume(partialTop.four.filter((p) => !already.has(String(p.id))));
    work = work.map((g) =>
      g.id === partialTop.group.id
        ? { ...g, players: partialTop.four.map((p) => p.id) }
        : g
    );
    log.push({ step: 'topUp', groupId: partialTop.group.id, rung: partialTop.rung });
  }

  /* ── Rule 7: at most one auto-created waiting group ─────────────────────
     A group Auto built for a court never lands in the queue — it goes straight
     on — so any complete `auto` group still sitting here IS the waiting group. */
  const created = [];
  const hasWaiting = work.some((g) => g.type === 'auto' && isComplete(g));
  if (!hasWaiting && pool.length >= 4) {
    const picked = selectFreshGroup(pool, { ...ctx(), role: null });
    if (picked) {
      consume(picked.four);
      const group = {
        id: nextId(),
        players: picked.four.map((p) => p.id),
        type: 'auto',
        createdAt: now,
      };
      work = [...work, group];
      created.push(group.id);
      log.push({ step: 'waiting', groupId: group.id, rung: picked.rung });
    }
  } else if (hasWaiting) {
    log.push({ step: 'waiting', created: false, reason: 'waitingGroupExists' });
  } else {
    log.push({ step: 'waiting', created: false, reason: 'notEnoughAvailable' });
  }

  const assigned = new Set(assignments.map((a) => a.groupId).filter(Boolean));
  return {
    queue: work.filter((g) => !assigned.has(g.id)),
    assignments,
    created,
    log,
    reason: assignments.length === 0 && created.length === 0 && !partialTop ? 'nothingToDo' : null,
  };
}
