# Player operations — implementation note

Implementer-authored companion to the v1.6 specification. This is not the
specification; it records how this repository is actually shaped, what pass 1
changed, and what the remaining passes will have to do.

**Pass 1 scope:** public-payload privacy, complete removal of high/low court
suggestions, and the wait-estimation engine. Sections 1, 2 (routes/attendance/
tokens), 4 (display overhaul) and 5 of the specification are deferred; the
reasoning and the settled design for each is at the end of this note.

---

## The existing model, mapped

| Spec concept | What exists today | Gap |
|---|---|---|
| `OpenPlaySession` with a stable id | `sessions` table, **PK is `venue_id`** — one perpetually-rewritten JSONB blob per venue. No status, no start/end, no identity. | A session cannot be named, dated, listed or ended. Needs a new table. |
| Session attendance record | Two columns on the durable player row: `players.checked_in_at`, `players.checked_out_at`. | `recheckInPlayer()` **overwrites** `checked_in_at`, so every prior visit is destroyed. No attendance history exists. |
| Player access token | Nothing. `venues.display_token` (TV) and `venues.slug` (poster) are venue-level. | Needs a new per-attendee credential. |
| Redacted public projection | `get_display_state` / `get_display_state_by_slug`, both `security definer`, both granted to `anon`. | Returned payment, wins/losses and the whole state blob. Fixed in pass 1. |
| Matching style | `matchingStyle` in the session blob; `balanced` / `winnersLosers` in `queue-engine.js`. | Produced high/low court hints. Removed in pass 1. |
| Staff auth | Supabase email/password, one venue per user (`venues.owner_id` unique), venue-scoped RLS via `current_venue_id()`. | Sufficient. Do not add a second mechanism. |
| Realtime | `display:<token>` broadcasts full state; `queue:<slug>` is a ping only and the client re-fetches. | Sufficient. |

**Migration convention:** `supabase/schema.sql` is one file, pasted whole into the
Supabase SQL editor, and re-run safely. Everything is guarded — `create table if
not exists`, `add column if not exists`, `drop policy if exists`, `create or
replace function`. There is no migrations directory, no CLI, no version table.
Two traps this imposes:

- `create table if not exists` silently no-ops on an existing table, so any
  column added to a `create table` block **must also** appear as `alter table …
  add column if not exists`. Lines 96–98 already do this deliberately.
- `create or replace function` cannot change a return type or an argument name.
  Changing a signature needs `drop function if exists` first, which drops the
  grants, so the `grant execute` block must be re-run. The file currently has no
  `drop function` at all — that pattern is not yet established here.

---

## Protected queue-engine invariants

Pass 1 must not disturb any of these. All are covered by existing tests in
`src/lib/queue-engine.test.js`, which stay green untouched.

1. **Auto-group builds groups into the Queue only.** `generateAutoQueueGroups()`
   returns `{ queue, created, toppedUp, decisions, … }` and has **no court field
   on its result at all**, so no code path can assign one. It reads `courts` for
   exactly one reason: to exclude on-court players from the pool.
2. **`assignQueuedGroupToCourt()` is the only path from Queued to Playing**, and
   it takes the group verbatim — same four, same team order, no re-matching.
3. 20 Available + 2 empty courts → 5 groups, 0 Available, courts unchanged.
4. 8 Available + 3 existing groups → 2 new groups, the 3 preserved with their ids
   and members, 0 Available, courts unchanged.
5. 4 Available after a match ends → 1 new group, the finished court stays empty.
6. 0 Available → no state change, no court side effect, `reason:
   'noFullGroupPossible'`.
7. Existing complete groups keep FIFO order; a cooldown-driven skip is the only
   legal reordering.
8. Manually built partial groups keep their members and their `createdAt`.
9. Matcher decisions are returned **separately** from the queue, never attached
   to a group object, so they cannot ride into the persisted blob and out to the
   public board.
10. The engine is pure: `now` injected, inputs never mutated, no randomness.

---

## Pass 1 changes

### Privacy — the leak was wider than the spec's E1 note

E1 identified `payment` in the public RPCs. Two larger exposures were found in
the same payload and fixed in the same change:

- **`auditLog`.** Both RPCs returned `coalesce(s.state,'{}'::jsonb)` — the entire
  blob — and `App.jsx` pushes `auditLog` into it. Audit entries carry
  `playerName`, `payment`, `method` and `sessionMs`. Anyone who scanned the
  poster QR could read a name-by-name payment ledger for the evening.
- **`wins` / `losses`.** The hidden Value is derived, not stored: `+1` a win,
  `-0.5` a loss. Returning both counters published the Value the specification
  insists must stay hidden.

Both are stripped in SQL. Neither is read by `DisplayView`, so both are
zero-client-change.

**Ordering matters.** `paymentInfo()` is deliberately tolerant and falls back to
`unpaid`, so removing `payment` from the RPC *before* the client stops reading it
would render a red "Unpaid" dot for every waiting player on every TV. The client
change ships first; the SQL is pasted second.

**Not done:** filtering out checked-out players. Both RPCs return every player the
venue ever registered. The proper fix is the deferred name-display privacy
setting; a `checked_out_at is null` filter has a real failure mode, because a
player checked out while still on a court would drop out of `playerById` and
render blank on the court card.

### Court neutrality

`preferredCourtFor`, `courtRoles` and `suggestCourtFor` are deleted, and no
group is written with a `preferredCourt` field. Winners/Losers survives as a
matching style — it still clusters a group by recent form — but its court-count
gate is dropped, because that condition existed only to decide which end of the
ladder a group was aimed at.

Legacy persisted groups keep any `preferredCourt` they already carry: existing
groups pass through the engine untouched. The field is simply never read and
never rendered, which is what the specification asks for.

### Wait estimates

`src/lib/wait-estimate.js`, pure and clock-free in the same shape as
`src/lib/time.js`. Implements the eight-rule precedence and the projected-range
formula verbatim, including the `roundDown5` optimistic floor accepted in open
decision M4 and the Finishing-court `R = 0` rule from K4.

The court-status vocabulary (`available` / `live` / `paused` / `finishing`) lands
as a pure function here because the estimator needs it to derive `A`, `R` and
`C`. Rendering it on the display is part of the deferred section 4.

Until the session lifecycle exists there is no `paused` or `closing` state to
feed it, so those branches are exercised by tests only. They are complete and
correct; they are not yet reachable from the app. Session state is passed as
`'open'` at the call sites.

---

## Deferred passes — settled design

**Session lifecycle.** Add `open_play_sessions` (own `id`, `venue_id`, `status`,
opened/paused/closed timestamps, matching style, default duration, `court_ids`,
`summary` jsonb) **alongside** the existing `sessions` blob, plus
`sessions.current_open_play_session_id` and `match_history.session_id`.

Renaming `sessions` was rejected. `alter table … rename` has no `if not exists`
form, and `src/lib/session.js` upserts on `venue_id` as the conflict target — the
moment the PK changes, every already-open front-desk tab starts failing silently
on every debounced write for the rest of the evening.

**Attendance.** `session_attendance` keyed uniquely on `(session_id, player_id)`,
with `spans` jsonb for repeat check-ins inside one session. `players.checked_in_at`
/ `checked_out_at` are **kept and redefined as a mirror** of the most recent
visit, not migrated away: dropping a column in a file that gets pasted into a
production SQL editor is one-way, and `fromRow`, `checkInOrder()` and the
checkout modal all read them.

The engine's availability gate widens from `!p.checkedOut` to a shared
`isAvailable(p)` predicate written as a negative test, so a player object from an
unmigrated database has no `availability` field, reads as available, and every
existing test passes unchanged.

**Opaque tokens.** 32 random bytes, base64url, stored only as a SHA-256 hash on
`session_attendance`. Anonymous access goes through `security definer` RPCs — the
established pattern, since `anon` has no table policies anywhere in this schema.

The write RPC takes **only the token and a verb**. It resolves the token to one
attendance id and writes `where id = <that id>`; there is no player, session or
venue parameter anywhere in the anon-facing surface, so writing to someone else's
record is not expressible rather than merely forbidden. It may set only
`requested_unavailable_at` / `requested_checkout_at` — requests, never state.
Staff apply them.

`gen_random_uuid()` works today because it is Postgres core, not because pgcrypto
is on the path. `digest()` is pgcrypto and lives in `extensions`, so every token
function needs `set search_path = public, extensions` or it fails at runtime.

**Privacy settings.** The name-display and show-profile-images settings cannot
live in device-local `prefs`: the TV is a different device that reads the session
blob, so a localStorage setting could never reach it. They must be venue settings
in the blob, with the control in the Settings menu.

**Export.** Stays out. The repository has no download pattern of any kind — only
`window.print()` and clipboard copy — and the specification permits omitting it
on exactly that condition.

**Unmigrated databases.** Three precedents exist and all deferred passes will use
them: nullish defaults for new columns (`players.js`), skipping a whole subsystem
when its input is absent (`session.js`, for a null slug), and a named amber
"re-run `supabase/schema.sql`" banner for a missing RPC (`App.jsx`).
