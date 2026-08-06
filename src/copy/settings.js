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

  on: 'On',
  off: 'Off',
};

// The full-screen sequence. Keep `matched` short — it sits under four faces and
// is read at a glance, not studied.
export const matchReveal = {
  matched: 'Matched!',
  goingTo: (courtName) => `Going to ${courtName}`,
  skipHint: 'Click anywhere to skip',
};
