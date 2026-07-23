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
  created_at    timestamptz not null default now()
);
create index if not exists players_venue_idx on players (venue_id);

-- Added after the first release — guarded so re-running the file over an existing
-- database picks them up without erroring.
alter table players add column if not exists payment       text not null default 'unpaid';
alter table players add column if not exists checked_in_at timestamptz not null default now();

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

  insert into venues (owner_id, name) values (auth.uid(), clean_name) returning * into v;
  update access_keys set claimed_by = v.id, claimed_at = now() where code = k.code;
  insert into sessions (venue_id) values (v.id);

  return v;
end;
$$;

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
    'state',     coalesce(s.state, '{}'::jsonb),
    'players',   coalesce(
                   (select jsonb_agg(
                      jsonb_build_object(
                        'id',      p.id,
                        'name',    p.name,
                        'skill',   p.skill,
                        'wins',    p.wins,
                        'losses',  p.losses,
                        'photo',   p.photo_url,
                        'payment', p.payment))
                      from players p where p.venue_id = v.id), '[]'::jsonb))
    from venues v
    left join sessions s on s.venue_id = v.id
   where v.display_token = p_token;
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

revoke all on function redeem_access_key(text, text) from public, anon;
revoke all on function get_display_state(uuid)       from public;
revoke all on function rotate_display_token()        from public, anon;

grant execute on function redeem_access_key(text, text) to authenticated;
grant execute on function get_display_state(uuid)       to anon, authenticated;
grant execute on function rotate_display_token()        to authenticated;

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
