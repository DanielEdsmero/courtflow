import React, { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from '../lib/AuthProvider';
import { brand, auth as t } from '../copy';

export default function AuthPage({ mode }) {
  const isSignUp = mode === 'signup';
  const { session, loading, signIn, signUp } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to={location.state?.from ?? '/'} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (isSignUp) {
        const { needsConfirmation } = await signUp(email.trim(), password);
        if (needsConfirmation) {
          setNotice(t.confirmEmailNotice);
          setBusy(false);
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      // On success the auth listener flips `session` and the redirect above fires.
    } catch (err) {
      setError(err.message ?? t.genericError);
      setBusy(false);
    }
  }

  const ready = email.includes('@') && password.length >= 6;

  return (
    <div className="font-body relative min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* Ambient aurora — subtle drifting light behind the card (§1). Decorative
          and pointer-events-none, so it never sits between the user and the form. */}
      <div className="cf-aurora" aria-hidden />

      <div className="cf-fade-up relative z-10 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800 rounded-2xl p-6 sm:p-8 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-lime-400 rounded-md flex items-center justify-center shrink-0 shadow-[0_0_20px_-4px_rgba(190,242,100,0.6)]">
            <Activity className="w-6 h-6 text-zinc-950" strokeWidth={3} />
          </div>
          <div>
            <div className="font-display text-3xl text-lime-400 leading-none" aria-label={brand.name}>
              {brand.name.split('').map((ch, i) => (
                <span key={i} className="cf-letter" style={{ '--cf-delay': `${150 + i * 55}ms` }} aria-hidden>
                  {ch}
                </span>
              ))}
            </div>
            <p className="text-zinc-500 text-xs mt-1">
              {isSignUp ? t.taglineSignUp : t.taglineSignIn}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5" htmlFor="email">
            {t.emailLabel}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 focus:border-lime-500 focus:outline-none focus:ring-2 focus:ring-lime-500/25 focus:shadow-[0_0_18px_-6px_rgba(190,242,100,0.5)] rounded-xl px-4 py-3 text-sm text-white mb-4 transition duration-200"
          />

          <label className="block text-xs font-semibold text-zinc-400 mb-1.5" htmlFor="password">
            {t.passwordLabel}
          </label>
          <input
            id="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 focus:border-lime-500 focus:outline-none focus:ring-2 focus:ring-lime-500/25 focus:shadow-[0_0_18px_-6px_rgba(190,242,100,0.5)] rounded-xl px-4 py-3 text-sm text-white mb-2 transition duration-200"
          />
          {isSignUp && (
            <p className="text-zinc-600 text-xs mb-3">{t.passwordHint}</p>
          )}

          {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}
          {notice && <p className="text-lime-400 text-sm mb-3">{notice}</p>}

          <button
            type="submit"
            disabled={!ready || busy}
            className="w-full bg-lime-400 hover:bg-lime-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 text-zinc-950 font-bold rounded-xl py-3 mt-2 transition-all duration-150 will-change-transform"
          >
            {busy ? t.submitBusy : isSignUp ? t.submitSignUp : t.submitSignIn}
          </button>
        </form>

        <p className="text-zinc-500 text-sm text-center mt-5">
          {isSignUp ? (
            <>
              {t.haveAccount}{' '}
              <Link to="/login" className="text-lime-400 hover:text-lime-300 font-semibold">
                {t.haveAccountLink}
              </Link>
            </>
          ) : (
            <>
              {t.haveKey}{' '}
              <Link to="/signup" className="text-lime-400 hover:text-lime-300 font-semibold">
                {t.haveKeyLink}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
