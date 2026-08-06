import React from 'react';
import { X } from 'lucide-react';

/* The shared modal primitive every dialog in the app is built on: dimmed
   backdrop, click-outside to close, title bar with an X, and a panel that
   scrolls internally rather than growing past the viewport.

   It lives here rather than in App.jsx so components outside that file — the
   setup wizard, for one — can use it without importing App and creating a cycle. */
export default function ModalShell({ children, onClose, title, wide }) {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto overscroll-contain`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-2xl">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
