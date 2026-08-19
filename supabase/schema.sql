-- ============================================================================
-- CourtFlow — full database schema
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: everything is guarded with "if not exists" / "drop if exists".
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- One venue per user account. display_token is the secret in the public TV URL.
create table if not exists venues (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references auth.users on delete cascade,
  name          text not null,
  display_token uuid not null unique default gen_random_uuid(),
  created_at    timestamptz not null default now()
);

-- Added after the first release: the public, human-readable club URL
-- (/queue/<slug>). It is the opposite of display_token in every way — guessable
-- by design, printed on a poster, and it never rotates. Nullable so the column
-- can be added to a live table; the backfill below fills every existing row and
-- the unique index then keeps them distinct.
alter table venues add column if not exists slug text;

-- Lowercase, non-alphanumerics collapsed to single hyphens, no leading or
-- trailing hyphen. Returns null when nothing usable is left (a name that's all
-- emoji, say), which the callers below turn into the 'club' fallback.
create or replace function slugify(p_text text)
returns text language sql immutable as $$
  select nullif(
           regexp_replace(
             regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'),
           '');
$$;

-- One-time backfill for venues created before slugs existed. Two clubs both
-- called "Riverside" become riverside and riverside-2.
do $$
declare
  v         record;
  base      text;
  candidate text;
  n         int;
begin
  for v in select id, name from venues where slug is null order by created_at loop
    base      := coalesce(slugify(v.name), 'club');
    candidate := base;
    n         := 1;
    while exists (select 1 from venues where slug = candidate) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;
    update venues set slug = candidate where id = v.id;
  end loop;
end $$;

-- A unique INDEX rather than a constraint: "if not exists" is supported here so
-- the file stays re-runnable, and it still permits the transient NULL above.
create unique index if not exists venues_slug_key on venues (slug);

-- Access keys you hand out. The client can NEVER read this table (see RLS below);
-- it is only ever touched by redeem_access_key(), which runs as security definer.
create table if not exists access_keys (
  code       text primary key,
  claimed_by uuid references venues on delete set null,
  claimed_at timestamptz,
  note       text
);

-- The durable roster. Survives session resets; wins/losses are zeroed, not deleted.
create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues on delete cascade,
  name          text not null,
  skill         text not null default 'Intermediate',
  wins          int  not null default 0,
  losses        int  not null default 0,
  photo_url     text,
  -- Payment tracking: 'online' (paid card/app), 'cash' (paid at desk), 'unpaid'.
  payment       text not null default 'unpaid',
  -- When the player checked in at the desk. Used for session-duration on checkout.
  checked_in_at timestamptz not null default now(),
  -- Set when staff check the player out (done for the day). NULL = currently
  -- checked in / on the active roster. A checked-out player is kept, not deleted,
  -- so the check-in autocomplete can bring them back next visit with their history.
  checked_out_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists players_venue_idx on players (venue_id);

-- Added after the first release — guarded so re-running the file over an existing
-- database picks them up without erroring.
alter table players add column if not exists payment        text not null default 'unpaid';
alter table players add column if not exists checked_in_at  timestamptz not null default now();
alter table players add column if not exists checked_out_at timestamptz;

-- All-time counters, deliberately separate from wins/losses above. Those are
-- session-scoped and zeroed by resetAllStats() at the end of every open play,
-- which is exactly why they can never back a lifetime leaderboard. These three
-- are never reset — only ever incremented, by record_match_result().
-- There is no win_rate column on purpose: a stored generated column would force
-- a table rewrite every time this file is re-run, and the rankings page already
-- has both numbers in memory.
alter table players add column if not exists total_wins   int not null default 0;
alter table players add column if not exists total_losses int not null default 0;
alter table players add column if not exists total_games  int not null default 0;

-- (The backfill for these three lives below match_history, which it reads from.)

-- The live session: courts, queue, announcement, toggles — one JSON blob per venue.
-- Ephemeral working state, rewritten constantly, read by the TV display.
create table if not exists sessions (
  venue_id   uuid primary key references venues on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Permanent record of completed games, for stats that outlive a session.
create table if not exists match_history (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues on delete cascade,
  court_name  text,
  player_ids  uuid[] not null default '{}',
  winner_ids  uuid[] not null default '{}',
  type        text not null default 'casual',
  duration_ms int,
  finished_at timestamptz not null default now()
);
create index if not exists match_history_venue_idx
  on match_history (venue_id, finished_at desc);

-- Backfill players.total_* from the permanent match log, not from wins/losses —
-- by the time this runs those have almost certainly been zeroed by a session
-- reset. Only decided games count: a casual or rental row has an empty
-- winner_ids and is nobody's loss. Guarded on total_games = 0 so re-running the
-- file never double-counts. Has to sit here rather than up with the ALTERs,
-- because it reads match_history.
with tallies as (
  select pid as player_id,
         count(*) filter (where pid = any(m.winner_ids))       as wins,
         count(*) filter (where not (pid = any(m.winner_ids))) as losses
    from match_history m
    cross join lateral unnest(m.player_ids) as pid
   where coalesce(array_length(m.winner_ids, 1), 0) > 0
   group by pid
)
update players p
   set total_wins   = t.wins,
       total_losses = t.losses,
       total_games  = t.wins + t.losses
  from tallies t
 where p.id = t.player_id
   and p.total_games = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

alter table venues        enable row level security;
alter table access_keys   enable row level security;
alter table players       enable row level security;
alter table sessions      enable row level security;
alter table match_history enable row level security;

-- Helper: the calling user's venue id. Wrapped in a function so the policies below
-- stay readable and Postgres can cache it per statement.
create or replace function current_venue_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from venues where owner_id = auth.uid();
$$;

drop policy if exists venues_select on venues;
create policy venues_select on venues
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists venues_update on venues;
create policy venues_update on venues
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- NOTE: there is deliberately no insert policy on venues. Venues are only ever
-- created by redeem_access_key(), which guarantees a key was burned to make one.

-- access_keys has RLS enabled and ZERO policies. That means no client — anon or
-- authenticated — can select, insert, update or delete a single row. Only the
-- security-definer functions below can see it. Do not add a policy here.

drop policy if exists players_all on players;
create policy players_all on players
  for all to authenticated
  using (venue_id = current_venue_id())
  with check (venue_id = current_venue_id());

drop policy if exists sessions_all on sessions;
create policy sessions_all on sessions
  for all to authenticated
  using (venue_id = current_venue_id())
  with check (venue_id = current_venue_id());

drop policy if exists match_history_all on match_history;
create policy match_history_all on match_history
  for all to authenticated
  using (venue_id = current_venue_id())
  with check (venue_id = current_venue_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Redeem an access key and create the caller's venue. Atomic: the key is locked
-- with FOR UPDATE so two simultaneous redemptions of the same key can't both win.
create or replace function redeem_access_key(p_code text, p_venue_name text)
returns venues
language plpgsql
security definer
set search_path = public
as $$
declare
  v venues;
  k access_keys;
  clean_code text;
  clean_name text;
  base_slug  text;
  slug_try   text;
  n          int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to redeem a key.';
  end if;

  if exists (select 1 from venues where owner_id = auth.uid()) then
    raise exception 'This account already has a venue.';
  end if;

  clean_code := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z-]', '', 'g'));
  clean_name := nullif(trim(coalesce(p_venue_name, '')), '');
  if clean_name is null then
    raise exception 'Please enter a venue name.';
  end if;

  select * into k
    from access_keys
   where code = clean_code
     and claimed_by is null
   for update;

  if not found then
    raise exception 'That access key is invalid or has already been used.';
  end if;

  -- The public club URL is minted here and never changes afterwards: it goes on
  -- printed posters, so a later venue rename must not invalidate it.
  base_slug := coalesce(slugify(clean_name), 'club');
  slug_try  := base_slug;
  n         := 1;
  while exists (select 1 from venues where slug = slug_try) loop
    n := n + 1;
    slug_try := base_slug || '-' || n;
  end loop;

  insert into venues (owner_id, name, slug)
       values (auth.uid(), clean_name, slug_try) returning * into v;
  update access_keys set claimed_by = v.id, claimed_at = now() where code = k.code;
  insert into sessions (venue_id) values (v.id);

  return v;
end;
$$;

-- ── The two public reads ────────────────────────────────────────────────────
-- Both are granted to anon, and get_display_state_by_slug is keyed on a slug that
-- is printed on a poster and guessable by design. So both are REDACTED
-- PROJECTIONS, not "the state": they return only what a screen in the room needs.
--
-- Three things were removed after they shipped, and none of them may come back:
--
--   payment        a payment ledger. Anyone who scanned the poster QR could read
--                  who had and had not paid, by name.
--   wins / losses  the hidden player Value is DERIVED from these, not stored:
--                  +1 a win, -0.5 a loss (see playerValue in src/lib/logic.js).
--                  Publishing the counters published the Value.
--   auditLog       stripped out of the state blob with the `- 'auditLog'`
--                  operator below. Its entries carry name, payment, payment
--                  method and session length.
--
-- The display reads only name, skill and photo. If you add a field here, check
-- first whether it can be used to reconstruct one of the three above.

-- Public read for the TV display. Takes the display token from the URL and returns
-- exactly what the display needs — nothing else, and nothing about any other venue.
-- Anonymous callers are fine; the token is the credential.
create or replace function get_display_state(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'venueName', v.name,
    'state',     coalesce(s.state, '{}'::jsonb) - 'auditLog',
    'players',   coalesce(
                   (select jsonb_agg(
                      jsonb_build_object(
                        'id',      p.id,
                        'name',    p.name,
                        'skill',   p.skill,
                        'photo',   p.photo_url))
                      from players p where p.venue_id = v.id), '[]'::jsonb))
    from venues v
    left join sessions s on s.venue_id = v.id
   where v.display_token = p_token;
$$;

-- The same public read, keyed by the printable club slug instead of the secret
-- token. It returns the same shape MINUS display_token: handing the token out
-- here would defeat rotate_display_token() entirely, since the slug is guessable
-- by design. Anonymous callers are fine — everything below is already on the TV.
create or replace function get_display_state_by_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'venueName', v.name,
    'slug',      v.slug,
    'state',     coalesce(s.state, '{}'::jsonb) - 'auditLog',
    'players',   coalesce(
                   (select jsonb_agg(
                      jsonb_build_object(
                        'id',      p.id,
                        'name',    p.name,
                        'skill',   p.skill,
                        'photo',   p.photo_url))
                      from players p where p.venue_id = v.id), '[]'::jsonb))
    from venues v
    left join sessions s on s.venue_id = v.id
   where v.slug = lower(trim(coalesce(p_slug, '')));
$$;

-- Rotate the display link, invalidating the old URL.
create or replace function rotate_display_token()
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  update venues set display_token = gen_random_uuid()
   where owner_id = auth.uid()
  returning display_token;
$$;

-- Record a finished match. One round trip, one transaction, real "+1" arithmetic.
-- The old client-side read-modify-write was survivable while only the session
-- counters mattered; the all-time counters are not recoverable from a lost
-- update, and two staff devices finishing different courts at the same moment is
-- a normal thing. Scoped to current_venue_id() so a security-definer function
-- can never be pointed at another club's roster.
create or replace function record_match_result(p_winner_ids uuid[], p_loser_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update players
     set wins        = wins + 1,
         total_wins  = total_wins + 1,
         total_games = total_games + 1
   where id = any(coalesce(p_winner_ids, '{}'))
     and venue_id = current_venue_id();

  update players
     set losses       = losses + 1,
         total_losses = total_losses + 1,
         total_games  = total_games + 1
   where id = any(coalesce(p_loser_ids, '{}'))
     and venue_id = current_venue_id();
end;
$$;

revoke all on function redeem_access_key(text, text)       from public, anon;
revoke all on function get_display_state(uuid)             from public;
revoke all on function get_display_state_by_slug(text)     from public;
revoke all on function rotate_display_token()              from public, anon;
revoke all on function record_match_result(uuid[], uuid[]) from public, anon;
revoke all on function slugify(text)                       from public, anon;

grant execute on function redeem_access_key(text, text)       to authenticated;
grant execute on function get_display_state(uuid)             to anon, authenticated;
grant execute on function get_display_state_by_slug(text)     to anon, authenticated;
grant execute on function rotate_display_token()              to authenticated;
grant execute on function record_match_result(uuid[], uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE — player photos
-- Create the bucket in the dashboard (Storage → New bucket → "player-photos",
-- Public ON), then run this block to lock down writes.
-- Paths are "<venue_id>/<player_id>.jpg", so the first folder is the venue id.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', true)
on conflict (id) do update set public = true;

drop policy if exists player_photos_read on storage.objects;
create policy player_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'player-photos');

drop policy if exists player_photos_write on storage.objects;
create policy player_photos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'player-photos'
    and (storage.foldername(name))[1] = current_venue_id()::text
  );

drop policy if exists player_photos_update on storage.objects;
create policy player_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'player-photos'
    and (storage.foldername(name))[1] = current_venue_id()::text
  );

drop policy if exists player_photos_delete on storage.objects;
create policy player_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'player-photos'
    and (storage.foldername(name))[1] = current_venue_id()::text
  );
