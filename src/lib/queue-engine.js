/* ─────────────────────────────────────────────
   QUEUE ENGINE
   Pure, framework-free. No React, no Supabase, no DOM, and — deliberately — no
   wall clock: every time-dependent entry point takes `now` as an argument so a
   test can pin it and a group's createdAt is whatever the caller says it is.

   Two entry points, and the split between them is the whole design:

     generateAutoQueueGroups()  builds matchups. It reads the courts only to
                                know whether a Winners/Losers hint is meaningful,
                                and it NEVER returns a court change. Staff press
                                Auto, every Available player who can be grouped
                                is grouped, and everyone stays off court.

     assignQueuedGroupToCourt() is the only function in the app that can move
                                four queued players onto a court. It takes the
                                group staff picked, verbatim — no re-matching,
                                no substitutions.

   Nothing here reads the wall clock; `now` is always an argument, so a test can
   pin it and a group's createdAt is whatever the caller says it is. Nothing here
   mutates its inputs, and nothing here is random: identical state and `now`
   always produce an identical answer.

   The rules group construction applies, in the priority order they are applied:
     1. preserve what staff built  — complete groups and manual members are fixed
     2. availability / FIFO        — the longest-waiting player seeds each group
     3. repeat-opponent ladder     — strict → relax1 → relax2 → relax3 → give up
     4. winners/losers             — cluster by recent form, then hint a court
     5. value proximity            — who joins the seed, and what breaks a tie
     6. check-in order             — the final tiebreak; never random
   ───────────────────────────────────────────── */

import { playerValue } from './logic';

/* How many of a player's OWN later matches must finish before a repeat is
   allowed. Sitting out burns nothing — this counts matches played, not time. */
export const COOLDOWN_MATCHES = 2;

/* The fallback ladder. Each rung drops one prohibition; `giveUp` is the label
   we record when even the loosest rung had to accept a repeated four. */
export const RUNGS = ['strict', 'relax1', 'relax2', 'relax3', 'giveUp'];
const LADDER = ['strict', 'relax1', 'relax2', 'relax3'];

/* Topping up a partial group: consider the nearest eight Available players by
   value distance to the group's mean, and enumerate the combinations of those.
   Bounded, exhaustive over the players that could plausibly fit, deterministic. */
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
   Two things, and separating them is the point of this rewrite.

   Composition: groups are clustered by recent form, so a group of recent
   winners and a group of recent losers emerge naturally out of the pool.

   Routing: each auto-built group carries a NON-BINDING `preferredCourt` hint —
   'high', 'low' or 'any'. It is a suggestion the assign dialog surfaces and
   staff can ignore. The engine never acts on it, and a group never waits for a
   particular court to free up.
   ───────────────────────────────────────────── */

// Court 1 is the high court, the highest-numbered court is the low court, and
// everything between is neutral. "Numbered" is the order the courts are held in,
// which is the order they are displayed and named in — so removing or renaming a
// court re-derives the ends rather than stranding them. With a single court
// there is no ladder to speak of and every court is neutral.
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

// A player's standing for clustering: what they did in their immediately
// previous match. Newcomers are their own class rather than being lumped in
// with either end of the ladder.
const formOf = (p, H) => H.lastResult(p.id);

/* The hint, derived from the group that was actually built. A group that leans
   towards recent winners suggests the high court, one that leans towards recent
   losers suggests the low court, and anything mixed or new suggests neither.
   Balanced mode and single-court floors always return 'any'. */
export function preferredCourtFor(four, H, { wl = false } = {}) {
  if (!wl) return 'any';
  const wins = four.filter((p) => formOf(p, H) === 'W').length;
  const losses = four.filter((p) => formOf(p, H) === 'L').length;
  if (wins > losses) return 'high';
  if (losses > wins) return 'low';
  return 'any';
}

/* ─────────────────────────────────────────────
   SELECTION
   Every new group starts from a SEED: the Available player who has been waiting
   longest. That is what makes FIFO a real priority rather than a tiebreak — the
   front of the bench is always in the next group. Their companions are then
   chosen from the players closest to them in value, which is why FIFO is a
   priority and not a rule: a later arrival can jump ahead of an earlier one when
   that is what keeps the four evenly matched or avoids a rematch.
   ───────────────────────────────────────────── */

// How many value-nearest candidates a seed considers. C(8,3) = 56 companion
// sets per seed: enough to route around a repeat, small enough to stay instant.
const COMPANION_WINDOW = 8;

const scoreFor = (four, seed, { H, avail, wl }) => {
  const base = [spreadOf(four), four.reduce((s, p) => s + avail(p), 0)];
  if (!wl) return base;
  // Winners/Losers outranks value proximity: cluster by what everyone just did,
  // then fall back to how close their values are.
  const seedForm = formOf(seed, H);
  const mismatch = four.filter((p) => formOf(p, H) !== seedForm).length;
  return [mismatch, ...base];
};

// Walk the ladder from the strict rung down, returning the best group at the
// first rung that yields one.
function pickBest(candidates, seed, ctx) {
  const { H, order } = ctx;
  for (const rung of LADDER) {
    let best = null;
    let bestScore = null;
    for (const four of candidates) {
      const drafted = draftTeams(four, order);
      const v = violationsOf(drafted, H);
      if (!passesRung(v, rung)) continue;
      const score = scoreFor(drafted, seed, ctx);
      // Strict < keeps the first minimum, and `candidates` is built in a fixed
      // order, so identical inputs always produce identical output.
      if (bestScore === null || cmpScore(score, bestScore) < 0) {
        bestScore = score;
        best = { four: drafted, rung: v.quad ? 'giveUp' : rung, violations: v };
      }
    }
    if (best) return best;
  }
  return null;
}

/* Build one group around `seed` out of `pool` (which must not contain the seed).
   Returns the four in on-court team order, plus the rung that had to be reached. */
export function selectGroupForSeed(seed, pool, ctx) {
  const { avail } = ctx;
  if (!seed || pool.length < 3) return null;
  const seedValue = playerValue(seed);
  const near = [...pool]
    .sort(
      (a, b) =>
        Math.abs(playerValue(a) - seedValue) - Math.abs(playerValue(b) - seedValue) ||
        avail(a) - avail(b)
    )
    .slice(0, COMPANION_WINDOW);
  const candidates = combinations(near, 3).map((three) => [seed, ...three]);
  return pickBest(candidates, seed, ctx);
}

/* ─────────────────────────────────────────────
   REPAIR
   Building groups one at a time, seeded by whoever has waited longest, is fair —
   but it is greedy, and greedy paints itself into a corner: the last group of a
   pass gets whoever is left, and "whoever is left" is very often exactly the four
   who last played together. No amount of ladder-walking inside that final group
   can help, because by then there is nothing to choose between.

   So once the pass has built its groups, it looks at them together and swaps
   single players between them wherever that makes both groups better. Only
   groups built by THIS pass take part: a complete group staff are already
   looking at, and the members they put in a partial by hand, are never moved.
   ───────────────────────────────────────────── */

// What a group costs, weighted so the ladder's own priorities survive the swap
// search: a repeated four is worse than any repeated matchup, a repeated matchup
// is worse than a repeated partnership, and value spread only breaks ties.
const QUAD_COST = 1000;
const OPPONENT_COST = 100;
const PARTNER_COST = 10;
const MAX_SWEEPS = 6;

function groupCost(four, H, order) {
  const drafted = draftTeams(four, order);
  const v = violationsOf(drafted, H);
  const t1 = [drafted[0], drafted[1]];
  const t2 = [drafted[2], drafted[3]];
  let cost = v.quad ? QUAD_COST : 0;
  for (const a of t1) {
    for (const b of t2) if (H.opponentBlocked(a.id, b.id)) cost += OPPONENT_COST;
  }
  if (H.partnerBlocked(t1[0].id, t1[1].id)) cost += PARTNER_COST;
  if (H.partnerBlocked(t2[0].id, t2[1].id)) cost += PARTNER_COST;
  return { cost: cost + spreadOf(drafted), drafted, violations: v };
}

// The rung label a finished group deserves, read back off what it actually
// repeats rather than off the rung the search happened to stop at.
export const rungFor = (v) =>
  v.quad ? 'giveUp' : v.opponent ? 'relax2' : v.partner ? 'relax1' : 'strict';

/* Swap single players between the given groups while that strictly improves the
   pair. Scans in a fixed index order and takes the first improvement it finds,
   so the result is the same every time for the same input. */
export function repairGroups(groups, { H, order }) {
  let state = groups.map((four) => groupCost(four, H, order));

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let swapped = false;
    outer:
    for (let i = 0; i < state.length; i++) {
      for (let j = i + 1; j < state.length; j++) {
        const before = state[i].cost + state[j].cost;
        for (let a = 0; a < 4; a++) {
          for (let b = 0; b < 4; b++) {
            const gi = [...state[i].drafted];
            const gj = [...state[j].drafted];
            [gi[a], gj[b]] = [gj[b], gi[a]];
            const ci = groupCost(gi, H, order);
            const cj = groupCost(gj, H, order);
            if (ci.cost + cj.cost < before) {
              state[i] = ci;
              state[j] = cj;
              swapped = true;
              break outer;
            }
          }
        }
      }
    }
    if (!swapped) break;
  }

  return state.map((s) => ({
    four: s.drafted,
    rung: rungFor(s.violations),
    violations: s.violations,
  }));
}

/* Top up a manual partial group (1–3 players) from the pool. Who joins is
   decided by value proximity to the MEAN of the players already in the group —
   staff put those people together on purpose, so the group's own centre of
   gravity is the target, not the pool's. The original members always survive;
   only their team order can change, because the snake draft decides that. */
export function completePartialGroup(partial, pool, ctx) {
  const { H, order, avail } = ctx;
  const need = 4 - partial.length;
  if (need <= 0 || need > 3 || pool.length < need) return null;

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

  for (const rung of LADDER) {
    let best = null;
    let bestScore = null;
    for (const four of candidates) {
      const drafted = draftTeams(four, order);
      const v = violationsOf(drafted, H);
      if (!passesRung(v, rung)) continue;
      const score = [distance(drafted), drafted.reduce((s, p) => s + avail(p), 0)];
      if (bestScore === null || cmpScore(score, bestScore) < 0) {
        bestScore = score;
        best = { four: drafted, rung: v.quad ? 'giveUp' : rung, violations: v };
      }
    }
    if (best) return best;
  }
  return null;
}

/* ── queue shapes ────────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────
   AUTO — BUILD EVERY GROUP THAT CAN BE BUILT
   One explicit staff click. It completes the manual partial groups staff
   started, then keeps building fresh groups until fewer than four players are
   left on the bench. It returns a queue and nothing else: no court in the
   session is touched, no player becomes Playing, and no match starts.
   ───────────────────────────────────────────── */
export function generateAutoQueueGroups({
  players = [],
  courts = [],
  queue = [],
  history = [],
  matchingStyle = 'balanced',
  now = 0,
} = {}) {
  const log = [];
  const created = [];
  const toppedUp = [];
  const nextId = makeIds(now);

  const byId = new Map(players.map((p) => [String(p.id), p]));
  const resolve = (ids) => ids.map((id) => byId.get(String(id))).filter(Boolean);

  const H = buildHistoryIndex(history);
  const order = checkInOrder(players);

  // Working copy — existing groups are carried through untouched unless they are
  // a partial this pass completes.
  let work = queue.map((g) => ({ ...g, players: [...g.players] }));

  const onCourt = new Set();
  courts.forEach((c) => (c.match?.players ?? []).forEach((id) => onCourt.add(String(id))));
  const queued = new Set();
  work.forEach((g) => g.players.forEach((id) => queued.add(String(id))));

  let pool = players.filter(
    (p) => !p.checkedOut && !onCourt.has(String(p.id)) && !queued.has(String(p.id))
  );
  const startedWith = pool.length;

  // The courts are read for one reason only: with a single open court there is
  // no high or low end, so there is no meaningful hint to attach.
  const wl = matchingStyle === 'winnersLosers'
    && courts.filter((c) => c.type === 'open').length >= 2;

  let avail = availableOrder(pool, H, order);
  const ctx = () => ({ H, order, avail, wl });
  const consume = (four) => {
    const taken = new Set(four.map((p) => String(p.id)));
    pool = pool.filter((p) => !taken.has(String(p.id)));
    avail = availableOrder(pool, H, order);
  };

  /* ── 1. Complete the partial groups staff started, oldest first ─────────
     Their members are never moved to another group and never dropped; the pass
     only adds the players they are short. createdAt is left alone — the group
     has been waiting since staff started it, not since it filled up. */
  for (const g of oldestFirst(work.filter(isPartial))) {
    const partial = resolve(g.players);
    if (partial.length !== g.players.length) continue; // a member left the roster
    if (pool.length < 4 - partial.length) continue;
    const picked = completePartialGroup(partial, pool, ctx());
    if (!picked) continue;
    const already = new Set(g.players.map(String));
    consume(picked.four.filter((p) => !already.has(String(p.id))));
    const preferredCourt = preferredCourtFor(picked.four, H, { wl });
    work = work.map((x) =>
      x.id === g.id
        ? { ...x, players: picked.four.map((p) => p.id), preferredCourt }
        : x
    );
    toppedUp.push(g.id);
    log.push({ step: 'topUp', groupId: g.id, rung: picked.rung, preferredCourt });
  }

  /* ── 2. Build new groups until the bench cannot make another four ─────── */
  // Where everyone stood on the bench before the pass started. Composition can
  // move players between groups from here on; this is what decides the ORDER the
  // finished groups go into the queue, so the longest waiter still plays next.
  const startAvail = availableOrder(pool, H, order);
  const built = [];
  const seeds = [];
  while (pool.length >= 4) {
    // The seed is whoever has been waiting longest; the rest of the group is
    // chosen around them.
    const seed = [...pool].sort((a, b) => avail(a) - avail(b))[0];
    const rest = pool.filter((p) => p.id !== seed.id);
    const picked = selectGroupForSeed(seed, rest, ctx());
    if (!picked) break; // cannot happen with four on the bench, but never loop
    consume(picked.four);
    built.push(picked.four);
    seeds.push(seed.id);
  }

  /* ── 3. Look at the new groups together and trade players between them ──
     The last group built is whoever was left over, which is very often the four
     who last played together. Swapping across the whole batch is the only way to
     see that, and it cannot disturb anything staff built.

     Trading players moves them between groups, so FIFO is restored afterwards by
     ORDER rather than by membership: the group holding the longest-waiting player
     goes into the queue first, and so on down the bench. That is the half of FIFO
     staff actually see — who plays next — and it leaves composition to the rules
     that keep matches fresh. */
  const repairedGroups = repairGroups(built, { H, order })
    .map((g, i) => ({
      ...g,
      seed: seeds[i],
      wait: Math.min(...g.four.map((p) => startAvail(p))),
    }))
    .sort((a, b) => a.wait - b.wait);

  for (const repaired of repairedGroups) {
    const preferredCourt = preferredCourtFor(repaired.four, H, { wl });
    const group = {
      id: nextId(),
      players: repaired.four.map((p) => p.id),
      type: 'auto',
      createdAt: now,
      preferredCourt,
    };
    work = [...work, group];
    created.push(group.id);
    log.push({
      step: 'create',
      groupId: group.id,
      rung: repaired.rung,
      preferredCourt,
      seed: repaired.seed,
    });
  }

  const didSomething = created.length > 0 || toppedUp.length > 0;
  log.push({ step: 'done', created: created.length, toppedUp: toppedUp.length, remaining: pool.length });

  return {
    queue: work,
    created,
    toppedUp,
    // What is still on the bench — always 0–3 when anything was built.
    remaining: pool.length,
    startedWith,
    log,
    reason: didSomething ? null : 'noFullGroupPossible',
  };
}

/* ─────────────────────────────────────────────
   MANUAL COURT ASSIGNMENT
   The only path from Queued to Playing. It takes the group staff chose exactly
   as it stands: the four players, in the team order they were drafted into when
   the group was built. Re-running the matcher here would quietly hand staff a
   different match from the one they were looking at when they clicked.
   Returns null — and changes nothing — when the move is not legal.
   ───────────────────────────────────────────── */
export function assignQueuedGroupToCourt({
  groupId,
  courtId,
  courts = [],
  queue = [],
  now = 0,
  durationMin = null,
}) {
  const group = queue.find((g) => g.id === groupId);
  const court = courts.find((c) => c.id === courtId);
  if (!group || group.players.length !== 4) return null;
  if (!court || court.type !== 'open' || court.match) return null;

  const match = {
    players: [...group.players],
    startedAt: now,
    endsAt: durationMin ? now + durationMin * 60_000 : null,
    durationMin: durationMin || null,
  };
  return {
    courts: courts.map((c) => (c.id === courtId ? { ...c, match } : c)),
    queue: queue.filter((g) => g.id !== groupId),
    assigned: { courtId, groupId, playerIds: match.players },
  };
}

/* Which court the assign dialog should offer first: the group's own hint when it
   points somewhere and that end is free, otherwise the first open court. */
export function suggestCourtFor(group, courts) {
  const open = courts.filter((c) => c.type === 'open' && !c.match);
  if (open.length === 0) return null;
  const hint = group?.preferredCourt;
  if (hint === 'high' || hint === 'low') {
    const roles = courtRoles(courts.filter((c) => c.type === 'open'));
    const match = open.find((c) => roles.get(c.id) === hint);
    if (match) return match.id;
  }
  return open[0].id;
}
