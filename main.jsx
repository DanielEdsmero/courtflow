import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './src/index.css';

import App from './src/App.jsx';
import AuthPage from './src/pages/AuthPage.jsx';
import ActivatePage from './src/pages/ActivatePage.jsx';
import DisplayPage from './src/pages/DisplayPage.jsx';
import RequireVenue from './src/components/RequireVenue.jsx';
import { AuthProvider } from './src/lib/AuthProvider.jsx';

// Deliberately no <React.StrictMode>: it double-invokes effects in dev, which
// would fire the auto-assign and session-sync effects twice and make real
// behaviour harder to reason about than the bugs it would surface.
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      {/* Public: the TV display. No auth — the token in the URL is the credential. */}
      <Route path="/d/:token" element={<DisplayPage />} />

      <Route
        path="/*"
        element={
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/signup" element={<AuthPage mode="signup" />} />
              <Route path="/activate" element={<ActivatePage />} />
              <Route
                path="/"
                element={
                  <RequireVenue>
                    <App />
                  </RequireVenue>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        }
      />
    </Routes>
  </BrowserRouter>
);
