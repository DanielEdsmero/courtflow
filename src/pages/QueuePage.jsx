import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DisplayView } from '../App';
import { fetchQueueState, subscribeToQueue } from '../lib/session';
import { hydrateCourts, isValidSlug } from '../lib/logic';
import { brand, screens, clubBoard, connection } from '../copy';

/* ─────────────────────────────────────────────
   PUBLIC CLUB BOARD (spec §F4)
   Deliberately a near-copy of DisplayPage rather than a shared component: the two
   differ on what validates the URL, which RPC answers it, and — the important one
   — how much the live channel is trusted. The rendering is the same, and keeping
   them apart means a change to the public board can't quietly alter the TV.
   ───────────────────────────────────────────── */

// Same safety net as the TV: broadcast is the live path, but a poster on a wall
// can be scanned hours after the socket quietly died.
const REFETCH_MS = 60_000;

// A ping only says "something changed". Bursts of them (a finish that also
// promotes the queue) should cost one re-fetch, not five.
const PING_DEBOUNCE_MS = 250;

export default function QueuePage() {
  const { slug } = useParams();
  const [data, setData] = useState(null); // { venueName, slug, state, players }
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);

  // Timers on court cards are computed from Date.now() at render, so the view
  // has to re-render every second to tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await fetchQueueState(slug));
      setError('');
    } catch (err) {
      setError(err.message === 'NOT_FOUND' ? 'NOT_FOUND' : 'LOAD_FAILED');
    }
  }, [slug]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!isValidSlug(slug ?? '')) {
      setError('NOT_FOUND');
      return;
    }
    load();

    let pingTimer = null;
    const unsub = subscribeToQueue(
      slug,
      // Ping-only channel on a guessable name: never apply broadcast data, always
      // re-ask the RPC. The worst a forged ping can do is cost one extra read.
      () => {
        if (pingTimer) clearTimeout(pingTimer);
        pingTimer = setTimeout(() => loadRef.current(), PING_DEBOUNCE_MS);
      },
      (status) => setLive(status === 'SUBSCRIBED')
    );

    const poll = setInterval(() => loadRef.current(), REFETCH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (pingTimer) clearTimeout(pingTimer);
      unsub();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, load]);

  const state = data?.state ?? {};
  const players = data?.players ?? [];

  const playerById = useCallback((id) => players.find((p) => p.id === id), [players]);

  const courts = useMemo(() => hydrateCourts(state.courts ?? []), [state.courts]);
  const history = state.history ?? [];

  const avgGameDurationMs = useMemo(() => {
    const completed = history.filter((h) => h.duration > 0);
    if (completed.length === 0) return 15 * 60 * 1000;
    return completed.reduce((sum, h) => sum + h.duration, 0) / completed.length;
  }, [history]);

  const openPlayCourtCount = useMemo(
    () => courts.filter((c) => c.type === 'open').length,
    [courts]
  );

  // Error copy differs from the TV's on purpose: this link came off a poster or a
  // QR code, so the reader is a player standing in the club, not staff.
  if (error === 'NOT_FOUND') return <Message title={clubBoard.notFoundTitle} body={clubBoard.notFoundBody} />;
  if (error === 'LOAD_FAILED') return <Message title={clubBoard.unreachableTitle} body={clubBoard.unreachableBody} />;
  if (!data) return <Message title={screens.loading} body="" />;

  return (
    <div className="font-body min-h-screen bg-zinc-950 text-zinc-100">
      <DisplayView
        competitiveMode={state.competitiveMode ?? false}
        courts={courts}
        queue={state.queue ?? []}
        history={history}
        announcement={state.announcement ?? ''}
        avgGameDurationMs={avgGameDurationMs}
        openPlayCourtCount={openPlayCourtCount}
        playerById={playerById}
      />
      {!live && (
        <div className="fixed bottom-3 right-3 text-[11px] text-zinc-600 bg-zinc-900/90 border border-zinc-800 rounded-full px-3 py-1">
          {connection.reconnecting}
        </div>
      )}
    </div>
  );
}

function Message({ title, body }) {
  return (
    <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 text-center">
      <div>
        <div className="font-display text-4xl text-lime-400 mb-3">{brand.name}</div>
        <p className="text-xl text-zinc-300 mb-2">{title}</p>
        {body && <p className="text-zinc-500 max-w-sm">{body}</p>}
      </div>
    </div>
  );
}
