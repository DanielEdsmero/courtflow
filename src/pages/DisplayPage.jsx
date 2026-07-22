import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DisplayView } from '../App';
import { fetchDisplayState, subscribeToDisplay } from '../lib/session';
import { hydrateCourts } from '../lib/logic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Safety net: broadcast is the live path, but if the staff app was closed and
// reopened, or the socket dropped while the TV sat idle, we'd never hear about it.
const REFETCH_MS = 60_000;

export default function DisplayPage() {
  const { token } = useParams();
  const [data, setData] = useState(null); // { venueName, state, players }
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
      setData(await fetchDisplayState(token));
      setError('');
    } catch (err) {
      setError(err.message === 'NOT_FOUND' ? 'NOT_FOUND' : 'LOAD_FAILED');
    }
  }, [token]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!UUID_RE.test(token ?? '')) {
      setError('NOT_FOUND');
      return;
    }
    load();

    const unsub = subscribeToDisplay(
      token,
      // Only the session blob is broadcast; the roster changes rarely and comes
      // from the RPC, so merge rather than replace.
      (state) => setData((prev) => (prev ? { ...prev, state } : prev)),
      (status) => setLive(status === 'SUBSCRIBED')
    );

    const poll = setInterval(() => loadRef.current(), REFETCH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      unsub();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, load]);

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

  if (error === 'NOT_FOUND') return <Message title="Display not found" body="This link is no longer valid. Ask the front desk for a new one." />;
  if (error === 'LOAD_FAILED') return <Message title="Can’t reach CourtFlow" body="Check this device’s internet connection. Retrying automatically." />;
  if (!data) return <Message title="Loading…" body="" />;

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
          reconnecting…
        </div>
      )}
    </div>
  );
}

function Message({ title, body }) {
  return (
    <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 text-center">
      <div>
        <div className="font-display text-4xl text-lime-400 mb-3">COURTFLOW</div>
        <p className="text-xl text-zinc-300 mb-2">{title}</p>
        {body && <p className="text-zinc-500 max-w-sm">{body}</p>}
      </div>
    </div>
  );
}
