import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthProvider';

// Guard for the staff app: signed out → /login, signed in but no venue yet → /activate.
export default function RequireVenue({ children }) {
  const { session, venue, loading } = useAuth();
  const location = useLocation();

  // Render nothing rather than a spinner — resolving the cached session is fast,
  // and a flash of "loading" on every refresh looks worse than a beat of blank.
  if (loading) return null;
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!venue) return <Navigate to="/activate" replace />;

  return children;
}
