/* Skill tier → Tailwind classes. Extracted from App.jsx so components outside
   it (PlayerAvatar, the match reveal overlay) can render a player consistently
   without importing App and creating a circular import. */

// Outlined pill — used where the tier is written out in words.
export const skillStyle = (s) => ({
  Beginner:     'bg-slate-700 text-slate-200 border-slate-600',
  Novice:       'bg-emerald-900 text-emerald-200 border-emerald-700',
  Intermediate: 'bg-sky-900 text-sky-200 border-sky-700',
  Advanced:     'bg-amber-900 text-amber-200 border-amber-700',
  Pro:          'bg-rose-900 text-rose-200 border-rose-700',
}[s] || 'bg-slate-700 text-slate-200');

// Solid fill — the dot next to a name, and the fallback avatar background.
export const skillStyleSolid = (s) => ({
  Beginner:     'bg-slate-500',
  Novice:       'bg-emerald-500',
  Intermediate: 'bg-sky-500',
  Advanced:     'bg-amber-500',
  Pro:          'bg-rose-500',
}[s] || 'bg-slate-500');
