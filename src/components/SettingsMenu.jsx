import React, { useEffect, useRef, useState } from 'react';
import { Settings2, Sparkles, Volume2, VolumeX, Check, Stethoscope } from 'lucide-react';
import { settings as t } from '../copy';

/* ─────────────────────────────────────────────
   SETTINGS MENU (gear)
   Sits in the toolbar's centre group beside Auto and the timer. A dropdown
   rather than a modal: these are two switches staff flip mid-shift, and a
   full-screen dialog for that would be heavier than the decision deserves.

   The two toggles are independent on purpose — animations can play silently.
   ───────────────────────────────────────────── */
export default function SettingsMenu({ prefs, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on an outside click or Escape. Bound only while open, so the app is
  // not carrying two document listeners for a menu nobody has opened.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(v => !v)}
        title={t.buttonTitle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t.heading}
        className={`px-2.5 py-1.5 rounded-lg border text-sm font-semibold flex items-center gap-2 transition ${
          open
            ? 'bg-zinc-800 border-zinc-600 text-zinc-100'
            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Settings2 className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t.heading}
          className="cf-fade-up absolute right-0 top-full mt-1.5 z-40 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2"
        >
          <div className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            {t.heading}
          </div>

          <ToggleRow
            icon={<Sparkles className="w-4 h-4" />}
            label={t.animationsLabel}
            hint={t.animationsHint}
            value={prefs.animations}
            onToggle={() => onChange({ ...prefs, animations: !prefs.animations })}
          />
          <ToggleRow
            icon={prefs.sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            label={t.soundLabel}
            hint={t.soundHint}
            value={prefs.sound}
            onToggle={() => onChange({ ...prefs, sound: !prefs.sound })}
          />
          {/* Staff-only. Lives with the other device preferences rather than in
              the session, so turning it on at the desk cannot leak it to the TV
              — nothing here is ever written to the shared session blob. */}
          <ToggleRow
            icon={<Stethoscope className="w-4 h-4" />}
            label={t.diagnosticsLabel}
            hint={t.diagnosticsHint}
            value={!!prefs.matcherDiagnostics}
            onToggle={() => onChange({ ...prefs, matcherDiagnostics: !prefs.matcherDiagnostics })}
          />

          <p className="px-2 pt-2 pb-1 text-[11px] text-zinc-600 border-t border-zinc-800 mt-1">
            {t.savedNote}
          </p>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ icon, label, hint, value, onToggle }) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={value}
      onClick={onToggle}
      className="w-full text-left px-2 py-2 rounded-lg hover:bg-zinc-800 transition flex items-start gap-2.5"
    >
      <span className={`mt-0.5 shrink-0 ${value ? 'text-lime-400' : 'text-zinc-600'}`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-zinc-100">{label}</span>
        <span className="block text-[11px] text-zinc-500 leading-snug">{hint}</span>
      </span>
      {/* A switch rather than a checkmark: the OFF state has to be as legible as
          the ON state, and a missing tick reads as "not loaded yet". */}
      <span
        aria-hidden
        className={`mt-0.5 shrink-0 w-9 h-5 rounded-full p-0.5 transition-colors duration-200 ${
          value ? 'bg-lime-400' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-zinc-950 transition-transform duration-200 ${
            value ? 'translate-x-4' : 'translate-x-0'
          }`}
        >
          {value && <Check className="w-4 h-4 text-lime-400" strokeWidth={3} />}
        </span>
      </span>
    </button>
  );
}
