/* ─────────────────────────────────────────────
   SUPABASE STUB LAYER
   Every network call the app makes is intercepted in the browser and answered
   from a fixture, so the suite is hermetic: no real project, no credentials, no
   writes. .env.test.local already points the client at 127.0.0.1:9999, which
   nothing is listening on — so a missed route fails loudly rather than silently
   escaping to a real host.

   The returned `calls` object counts requests. Several tests assert on it
   directly ("an invalid slug must not spend an RPC", "a burst of pings costs one
   re-fetch"), which is the only way to see behaviour that has no visible output.
   ───────────────────────────────────────────── */

export const SUPABASE_ORIGIN = 'http://127.0.0.1:9999';

// Derived exactly as SupabaseClient does: `sb-${hostname.split('.')[0]}-auth-token`.
export const AUTH_STORAGE_KEY = 'sb-127-auth-token';

export const VENUE = {
  id: 'venue-0000-0000-0000-000000000001',
  name: 'Demo Pickle Club',
  slug: 'demo-club',
  display_token: '11111111-2222-3333-4444-555555555555',
  owner_id: 'user-0000-0000-0000-000000000001',
  onboarded: true,
};

/* Roster tuned so the rankings page has something to get wrong:
   · Ben and Ada share a 75% rate, so games-played has to break the tie.
   · Dex sits under the 10-game threshold → unranked, "3/10 games".
   · Eve has never played → in neither list, but still counted in Total Players.
   Player-games sum to 67, while the venue has only played 21 matches — the two
   numbers must not be interchangeable. */
export const PLAYERS = [
  row('p1', 'Ada Lovelace',   'Advanced',     9,  3),
  row('p2', 'Ben Franklin',   'Pro',         30, 10),
  row('p3', 'Cleo Patra',     'Intermediate', 6,  6),
  row('p4', 'Dex Morgan',     'Novice',       2,  1),
  row('p5', 'Eve Newcomer',   'Beginner',     0,  0),
];

export const MATCH_HISTORY_COUNT = 21;
export const PLAYER_GAMES_SUM = 67; // 12 + 40 + 12 + 3 + 0 — deliberately different

function row(id, name, skill, totalWins, totalLosses) {
  return {
    id,
    name,
    skill,
    wins: 0,
    losses: 0,
    total_wins: totalWins,
    total_losses: totalLosses,
    total_games: totalWins + totalLosses,
    photo_url: null,
    payment: 'unpaid',
    checked_in_at: new Date().toISOString(),
    checked_out_at: null,
  };
}

// A live session blob: one court playing, one free, one group waiting.
export function queueState() {
  const startedAt = Date.now() - 5 * 60_000;
  return {
    competitiveMode: true,
    announcement: '',
    courts: [
      {
        id: 1,
        name: 'Court 1',
        type: 'open',
        match: { players: ['p1', 'p2', 'p3', 'p4'], startedAt, endsAt: startedAt + 15 * 60_000 },
      },
      { id: 2, name: 'Court 2', type: 'open', match: null },
    ],
    queue: [{ id: 'g1', players: ['p5', 'p1', 'p2', 'p3'], type: 'manual' }],
    history: [],
  };
}

/* What the PUBLIC display RPCs actually return per player, and nothing more.
   get_display_state / get_display_state_by_slug are granted to anon and keyed on
   a poster-printed slug, so they redact payment (a payment ledger), wins/losses
   (the hidden Value is derived from them: +1 a win, -0.5 a loss) and the
   auditLog key inside state (names + payment + method + session length).

   The stub mirrors that redaction deliberately. A fixture richer than the real
   payload would let a leak pass every test in this suite. */
const REDACTED_FROM_PUBLIC = ['payment', 'wins', 'losses', 'total_wins', 'total_losses', 'total_games'];

export function publicPlayers(players = PLAYERS) {
  return players.map((p) => {
    const out = { ...p };
    for (const key of REDACTED_FROM_PUBLIC) delete out[key];
    return out;
  });
}

export function publicState(state = queueState()) {
  const { auditLog, ...rest } = state;
  void auditLog;
  return rest;
}

export function displayPayload(overrides = {}) {
  return {
    venueName: VENUE.name,
    slug: VENUE.slug,
    state: publicState(),
    players: publicPlayers(),
    ...overrides,
  };
}

/* Device preferences (animations, sound) live in localStorage. Seeded before any
   app script runs, same reasoning as signIn below.

   signIn() defaults ANIMATIONS OFF, which is the opposite of the app's own
   default. The match reveal is a ~7 second full-screen overlay that intercepts
   clicks, so leaving it on would make every assignment in every spec slow and
   would swallow the next click. Specs that are actually testing the reveal call
   this themselves with { animations: true }. */
export async function setPrefs(page, prefs) {
  await page.addInitScript(
    ([key, value]) => {
      // Seed only when nothing is stored yet. addInitScript re-runs on every
      // navigation, so writing unconditionally would overwrite whatever the app
      // saved and make a persistence bug impossible to see across a reload.
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    },
    ['courtflow:prefs', { animations: false, sound: false, ...prefs }]
  );
}

/* Seeds a signed-in session before any app script runs. addInitScript rather
   than an evaluate-after-goto, because AuthProvider reads storage during its
   first effect — writing it afterwards would race the redirect to /login. */
export async function signIn(page, prefs = {}) {
  await setPrefs(page, prefs);
  await page.addInitScript(
    ([key, venue]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          token_type: 'bearer',
          // Far future: an expired session would trigger a refresh round-trip.
          expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
          expires_in: 60 * 60 * 24 * 365,
          user: {
            id: venue.owner_id,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'staff@example.com',
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        })
      );
    },
    [AUTH_STORAGE_KEY, VENUE]
  );
}

/**
 * Intercept every Supabase REST/RPC call.
 *
 * opts:
 *   players            – roster rows, or 'error' to fail listPlayers
 *   matchCount         – match_history count, or 'error' to fail countMatchHistory
 *   queueRpc           – payload for get_display_state_by_slug; null → NOT_FOUND;
 *                        'error' → transport failure
 *   venue              – venue row, or null to simulate "no venue yet"
 */
export async function stubRest(page, opts = {}) {
  const calls = {
    players: 0,
    matchCount: 0,
    queueRpc: 0,
    displayRpc: 0,
    venues: 0,
    other: [],
    // Flipped by tests that want the *second* call to behave differently
    // (the "Try again" retry path).
    failNext: { players: false, matchCount: false },
  };

  const state = {
    players: opts.players ?? PLAYERS,
    matchCount: opts.matchCount ?? MATCH_HISTORY_COUNT,
    queueRpc: 'queueRpc' in opts ? opts.queueRpc : displayPayload(),
    venue: 'venue' in opts ? opts.venue : VENUE,
    // The staff app's saved session blob, so a test can start mid-match.
    session: opts.session,
  };
  calls.state = state;

  const json = (route, body, headers = {}) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', ...headers },
      body: JSON.stringify(body),
    });

  await page.route(`${SUPABASE_ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const accept = req.headers()['accept'] ?? '';
    // .maybeSingle()/.single() ask for a bare object; plain selects want an array.
    const wantsObject = accept.includes('vnd.pgrst.object+json');

    // ── auth ──────────────────────────────────────────────────────────────
    if (path.startsWith('/auth/v1/')) {
      if (path.includes('logout')) return json(route, {});
      return json(route, { user: null, session: null });
    }

    // ── venues (AuthProvider.fetchVenue) ─────────────────────────────────
    if (path === '/rest/v1/venues') {
      calls.venues += 1;
      if (!state.venue) {
        return wantsObject
          ? route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116' }) })
          : json(route, []);
      }
      return json(route, wantsObject ? state.venue : [state.venue]);
    }

    // ── sessions (loadSession / createSessionSync writes) ────────────────
    if (path === '/rest/v1/sessions') {
      if (req.method() === 'GET') {
        calls.sessionLoads = (calls.sessionLoads ?? 0) + 1;
        // Reads see the most recent write, the way Postgres would. Without this
        // a reload replays the seeded fixture and silently discards everything
        // the app did — which makes "does this survive a refresh?" untestable.
        const blob = { state: calls.lastSessionWrite ?? state.session ?? queueState() };
        return json(route, wantsObject ? blob : [blob]);
      }
      // Keep the most recent upsert. It is the staff app's own view of courts,
      // queue and history — a far sturdier thing to assert rotation against
      // than scraping the queue out of the DOM.
      calls.sessionWrites = (calls.sessionWrites ?? 0) + 1;
      try {
        calls.lastSessionWrite = JSON.parse(req.postData() ?? '{}').state ?? null;
      } catch {
        /* a malformed body is the app's problem, not this route's */
      }
      return json(route, []);
    }

    // ── players (listPlayers) ────────────────────────────────────────────
    if (path === '/rest/v1/players') {
      calls.players += 1;
      if (state.players === 'error' || calls.failNext.players) {
        calls.failNext.players = false;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'stubbed failure' }),
        });
      }
      return json(route, state.players);
    }

    // ── match_history count (countMatchHistory) ──────────────────────────
    if (path === '/rest/v1/match_history') {
      calls.matchCount += 1;
      if (state.matchCount === 'error' || calls.failNext.matchCount) {
        calls.failNext.matchCount = false;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      // head:true → empty body; the count rides in Content-Range.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-range',
          'content-range': `*/${state.matchCount}`,
        },
        body: '',
      });
    }

    // ── RPCs ─────────────────────────────────────────────────────────────
    // Simulate an RPC that the database doesn't have — what actually happens
    // when schema.sql hasn't been re-run. PostgREST answers 404 PGRST202.
    if (path.startsWith('/rest/v1/rpc/') && path.endsWith(state.failRpc ?? ' ')) {
      calls.failedRpcs = (calls.failedRpcs ?? 0) + 1;
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          code: 'PGRST202',
          message: `Could not find the function public.${state.failRpc}`,
        }),
      });
    }

    if (path === '/rest/v1/rpc/get_display_state_by_slug') {
      calls.queueRpc += 1;
      if (state.queueRpc === 'error') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      return json(route, state.queueRpc);
    }
    if (path === '/rest/v1/rpc/get_display_state') {
      calls.displayRpc += 1;
      return json(route, state.queueRpc);
    }

    // Anything unrouted is a gap in the stub — record it so a test can assert
    // the app made no call we didn't anticipate.
    calls.other.push(`${req.method()} ${path}`);
    return json(route, {});
  });

  return calls;
}

/**
 * Mock the Realtime websocket end to end, speaking just enough of the Phoenix
 * protocol for RealtimeChannel.subscribe() to report SUBSCRIBED.
 *
 * Returns { ping } — push a broadcast on a channel exactly as the staff app's
 * createSessionSync would. The QueuePage must answer it with a re-fetch, never
 * by trusting the payload.
 */
export async function stubRealtime(page) {
  const sockets = [];
  const joined = new Set();

  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    sockets.push(ws);
    ws.onMessage((raw) => {
      let msg;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        return;
      }
      // realtime-js speaks Phoenix's ARRAY serializer:
      //   [join_ref, ref, topic, event, payload]
      // (the object form is the older v1 wire format — tolerated here so a
      // library bump that switches back doesn't silently stop acknowledging.)
      const [joinRef, ref, topic, event] = Array.isArray(msg)
        ? msg
        : [msg.join_ref, msg.ref, msg.topic, msg.event];

      if (event === 'phx_join' || event === 'heartbeat' || event === 'access_token') {
        if (event === 'phx_join') joined.add(topic);
        ws.send(
          JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])
        );
      }
    });
  });

  // realtime-js backs off between connection attempts (1s, 2s, 5s…), so a fixed
  // assertion timeout races it. Tests wait on the join itself instead — and a
  // ping sent before the channel joined would simply be dropped.
  async function waitForJoin(slug, timeoutMs = 20_000) {
    const topic = `realtime:queue:${slug}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (joined.has(topic)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Realtime channel "${topic}" never joined within ${timeoutMs}ms`);
  }

  return {
    // Deliver a "changed" broadcast on queue:<slug>, shaped the way the server
    // relays one. `times` fires a burst, to exercise the debounce. Sent from the
    // route handler (Node side) — this is the mock server pushing to the page.
    ping(slug, times = 1) {
      // Same array serializer, server → client.
      const frame = JSON.stringify([
        null,
        null,
        `realtime:queue:${slug}`,
        'broadcast',
        { type: 'broadcast', event: 'changed', payload: { at: Date.now() } },
      ]);
      for (const ws of sockets) {
        for (let i = 0; i < times; i++) ws.send(frame);
      }
    },
    waitForJoin,
    sockets,
  };
}
