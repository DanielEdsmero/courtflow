# CourtFlow

Court and queue management for pickleball venues. Staff run the session from any
browser; the customer display runs on a TV from a read-only link.

Was a Windows Electron app; now a hosted web app on Supabase.

---

## Routes

| Route | Auth | What it is |
|---|---|---|
| `/login`, `/signup` | none | Supabase email + password |
| `/activate` | signed in | Redeem an access key, name the venue |
| `/` | signed in + venue | The staff app |
| `/d/:token` | **none** | Public customer display for the TV |

## How data flows

- **`players`, `match_history`** — real Postgres tables, scoped to a venue by RLS.
- **`sessions.state`** — the live session (courts, queue, announcement, toggles) as
  one JSON blob. Written debounced, and broadcast on a Realtime channel named
  `display:<token>` so the TV updates instantly.
- **Player photos** — Supabase Storage (`player-photos` bucket), keyed
  `<venue_id>/<player_id>.jpg`. Only the URL goes in the database.

## Access keys

Free to use, but gated by keys you issue. They live in the `access_keys` table,
which has RLS on and **no policies** — no client can read it. Only the
`redeem_access_key()` security-definer function can, and it burns the key when a
venue is created.

```bash
node scripts/generate-key.js --sql 25   # SQL to paste into Supabase
node scripts/generate-key.js 25         # the same format, plain — hand these out
node scripts/generate-key.js --check KEY
```

Keys are not recoverable from the database in readable form for handing out later,
so keep the plain list somewhere safe when you generate a batch.

---

## Setup

### Supabase

1. **supabase.com** → New project. Save the database password; it is not recoverable.
2. **SQL Editor** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → Run.
   This creates the tables, RLS policies, functions, the storage bucket and its policies.
3. **SQL Editor** → paste the output of `node scripts/generate-key.js --sql 25` → Run.
4. **Authentication → Providers → Email** → turn *Confirm email* off while you're
   testing. Turn it back on before real venues sign up.
5. **Authentication → URL Configuration** → add `http://localhost:5173` to Redirect
   URLs; set Site URL to your deployed domain once you have one.
6. **Project Settings → API** → copy the Project URL and the **anon public** key.
   Never use the `service_role` key here — it bypasses RLS.

### Local

```bash
cp .env.example .env.local     # then paste in the two values from step 6
npm install
npm run dev                    # http://localhost:5173
```

Sign up, redeem a key, and you're in.

### Deploy (Vercel)

1. Push to a private GitHub repo. Check `.env.local` is gitignored first.
2. vercel.com → Add New → Project → import the repo. Vite is auto-detected.
3. **Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before the first build** —
   Vite inlines env vars at build time, so setting them later needs a redeploy.
4. Deploy, then set the Supabase Site URL to your new domain.

[`vercel.json`](vercel.json) rewrites all paths to `index.html`; without it,
refreshing `/d/<token>` 404s.

### On the TV

Staff app → **Display Link** → copy the URL → open it in the TV's browser and go
full screen. Works on a Fire Stick, Chromecast, smart TV browser, or any HDMI stick.
Regenerate the link from the same modal if it leaks.

---

## Commands

```bash
npm run dev       # dev server
npm run build     # production build to dist/
npm run preview   # serve the built bundle
npm test          # vitest
```

## Notes

- Camera capture needs HTTPS. Vercel provides it; `localhost` is exempt.
- The session blob is last-write-wins. One front desk is fine; two staff editing
  on separate tablets will clobber each other.
- Session history is capped at 50 entries in the blob to stay under the Realtime
  message limit. The full record lives in `match_history`.
