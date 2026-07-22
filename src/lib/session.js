import { supabase } from './supabase';

// Replaces the old localStorage layer. The live session — courts, queue,
// announcement, toggles — is one JSON blob per venue:
//   • written to sessions.state so a refresh restores it, and
//   • broadcast on "display:<token>" so the TV updates instantly.
//
// Writes are debounced because the source effect in App.jsx fires on every state
// change (and once a second while a timer runs); without this we'd hammer the API.

const SAVE_DEBOUNCE_MS = 600;

// Bound the payload. The display only ever renders recent results, and Realtime
// broadcast messages are capped at 256KB — an all-day session would blow past that.
const MAX_HISTORY = 50;

const trim = (state) => ({
  ...state,
  history: Array.isArray(state.history) ? state.history.slice(0, MAX_HISTORY) : [],
});

export async function loadSession(venueId) {
  const { data, error } = await supabase
    .from('sessions')
    .select('state')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) {
    console.error('Failed to load session:', error);
    return null;
  }
  const state = data?.state;
  // A fresh venue has '{}' — treat that as "no saved session" so App uses defaults.
  return state && Object.keys(state).length > 0 ? state : null;
}

export function channelName(displayToken) {
  return `display:${displayToken}`;
}

// Returns { push, flush, destroy }. Call push() on every state change; it
// coalesces bursts into one write + one broadcast.
export function createSessionSync(venueId, displayToken) {
  const channel = supabase.channel(channelName(displayToken), {
    config: { broadcast: { self: false } },
  });
  channel.subscribe();

  let timer = null;
  let pending = null;
  let destroyed = false;

  async function commit() {
    timer = null;
    if (destroyed || !pending) return;
    const state = pending;
    pending = null;

    // Broadcast first: the TV should feel instant even if the write is slow.
    channel.send({ type: 'broadcast', event: 'state', payload: state }).catch(() => {});

    const { error } = await supabase
      .from('sessions')
      .upsert({ venue_id: venueId, state, updated_at: new Date().toISOString() });
    if (error) console.error('Failed to save session:', error);
  }

  return {
    push(state) {
      if (destroyed) return;
      pending = trim(state);
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, SAVE_DEBOUNCE_MS);
    },
    // Write immediately — used on reset, where losing the pending write would
    // resurrect the old session on the next reload.
    flush() {
      if (timer) clearTimeout(timer);
      return commit();
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    },
  };
}

// ── Display side ────────────────────────────────────────────────────────────

// Public, unauthenticated read. The token from the URL is the credential.
export async function fetchDisplayState(token) {
  const { data, error } = await supabase.rpc('get_display_state', { p_token: token });
  if (error) throw error;
  if (!data) throw new Error('NOT_FOUND');
  return data; // { venueName, state, players }
}

// Live push from the staff app. onState is called with the raw state blob.
// onStatus reports connection changes so the display can show a stale badge.
export function subscribeToDisplay(token, onState, onStatus) {
  const channel = supabase.channel(channelName(token), {
    config: { broadcast: { self: false } },
  });

  channel
    .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .subscribe((status) => onStatus?.(status));

  return () => supabase.removeChannel(channel);
}
