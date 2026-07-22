import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [venue, setVenue] = useState(null);
  // Stays true until we know both the auth session AND whether a venue exists,
  // so route guards never flash the wrong screen on a hard refresh.
  const [loading, setLoading] = useState(true);

  const fetchVenue = useCallback(async (userId) => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from('venues')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) {
      console.error('Failed to load venue:', error);
      return null;
    }
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const s = data.session ?? null;
      setSession(s);
      setVenue(s ? await fetchVenue(s.user.id) : null);
      if (!cancelled) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (cancelled) return;
      setSession(s ?? null);
      // TOKEN_REFRESHED fires roughly hourly with the same user; refetching the
      // venue on it would cause a pointless reload of the whole staff view.
      if (event === 'TOKEN_REFRESHED') return;
      setVenue(s ? await fetchVenue(s.user.id) : null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [fetchVenue]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // With "Confirm email" ON, Supabase returns a user but no session. Tell the
    // caller so it can show "check your inbox" instead of silently doing nothing.
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setVenue(null);
  }, []);

  const refreshVenue = useCallback(async () => {
    if (!session?.user) return null;
    const v = await fetchVenue(session.user.id);
    setVenue(v);
    return v;
  }, [session, fetchVenue]);

  const value = { session, user: session?.user ?? null, venue, loading, signIn, signUp, signOut, refreshVenue, setVenue };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
