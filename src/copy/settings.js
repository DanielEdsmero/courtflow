/* The gear menu in the toolbar, and the match reveal sequence that plays when a
   group lands on a court. */

export const settings = {
  buttonTitle: 'Animations and sound',
  heading: 'Settings',
  savedNote: 'Saved on this device.',

  animationsLabel: 'Animations',
  animationsHint: 'Play the match reveal when a group takes a court.',

  soundLabel: 'Sound effects',
  soundHint: 'Card ticks, the match chime and the court thud.',

  // Staff-only, off by default. Explains which matching rules each auto-built
  // group had to bend. Never rendered in Preview or on the public screens.
  diagnosticsLabel: 'Matcher diagnostics',
  diagnosticsHint: 'Show why each auto group was matched. Staff view only.',

  on: 'On',
  off: 'Off',
};

// The full-screen sequence. Keep `matched` short — it sits under four faces and
// is read at a glance, not studied.
/* The staff-only matcher badge on a queue card. Says which rule had to give,
   never a hidden Value and never who played whom. */
export const matcherDiagnostics = {
  strict: 'Matcher: strict — cooldown clear',
  'same-teammate-relaxed': 'Matcher: teammate fallback',
  'opponent-cooldown-relaxed': (pairs) =>
    `Matcher: opponent fallback — ${pairs} unavoidable pair${pairs === 1 ? '' : 's'}`,
  'same-four-relaxed': 'Matcher: same-group fallback',
  staffOnly: 'Visible to staff only',
};

export const matchReveal = {
  matched: 'Matched!',
  goingTo: (courtName) => `Going to ${courtName}`,
  skipHint: 'Click anywhere to skip',
};
