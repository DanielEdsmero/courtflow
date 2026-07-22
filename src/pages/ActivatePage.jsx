import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from '../lib/AuthProvider';
import { supabase } from '../lib/supabase';

// Same input masking the old desktop LicenseGate used: hex only, uppercased,
// auto-hyphenated into four groups of six.
export function formatKeyInput(raw) {
  return raw
    .replace(/[^0-9A-Fa-f]/g, '')
    .toUpperCase()
    .slice(0, 24)
    .replace(/(.{6})/g, '$1-')
    .replace(/-$/, '');
}

export default function ActivatePage() {
  const { session, venue, loading, refreshVenue, signOut } = useAuth();

  const [venueName, setVenueName] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (venue) return <Navigate to="/" replace />;

  async function handleActivate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('redeem_access_key', {
      p_code: key,
      p_venue_name: venueName.trim(),
    });
    if (rpcError) {
      setError(rpcError.message.replace(/^.*?:\s*/, ''));
      setBusy(false);
      return;
    }
    await refreshVenue(); // flips the guard, dropping us into the staff app
  }

  const ready = key.replace(/-/g, '').length === 24 && venueName.trim().length > 0;

  return (
    <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-lime-400 rounded-md flex items-center justify-center shrink-0">
            <Activity className="w-6 h-6 text-zinc-950" strokeWidth={3} />
          </div>
          <div>
            <div className="font-display text-3xl text-lime-400 leading-none">COURTFLOW</div>
            <p className="text-zinc-500 text-xs mt-1">Set up your venue</p>
          </div>
        </div>

        <form onSubmit={handleActivate}>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5" htmlFor="venue">
            Venue name
          </label>
          <input
            id="venue"
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            placeholder="Riverside Pickleball Club"
            className="w-full bg-zinc-950 border border-zinc-700 focus:border-lime-500 focus:outline-none rounded-xl px-4 py-3 text-sm text-white mb-4 transition-colors"
          />

          <label className="block text-xs font-semibold text-zinc-400 mb-1.5" htmlFor="key">
            Access key
          </label>
          <input
            id="key"
            value={key}
            onChange={(e) => {
              setError('');
              setKey(formatKeyInput(e.target.value));
            }}
            placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
            spellCheck={false}
            autoCapitalize="characters"
            className="w-full bg-zinc-950 border border-zinc-700 focus:border-lime-500 focus:outline-none rounded-xl px-4 py-3 font-mono text-sm text-white tracking-widest mb-3 transition-colors"
          />

          {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}

          <button
            type="submit"
            disabled={!ready || busy}
            className="w-full bg-lime-400 hover:bg-lime-300 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-950 font-bold rounded-xl py-3 transition-colors"
          >
            {busy ? 'Activating…' : 'Activate'}
          </button>
        </form>

        <p className="text-zinc-600 text-xs text-center mt-4">
          Need a key? Contact the person who set up CourtFlow for you.
        </p>
        <button
          onClick={signOut}
          className="w-full text-zinc-500 hover:text-zinc-300 text-xs mt-4 py-2"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
