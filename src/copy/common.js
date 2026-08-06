/* Text that shows up in more than one place, plus the whole-screen states.
   See ./README.md for how to edit these. */

export const brand = {
  // Shown as the big lime wordmark on every screen.
  name: 'COURTFLOW',
};

// Buttons and labels reused across screens.
export const buttons = {
  back: 'Back',
  tryAgain: 'Try again',
  cancel: 'Cancel',
  done: 'Done',
  next: 'Next',
  skip: 'Skip',
  signOut: 'Sign out',
  dismiss: 'Dismiss',
};

// The whole-page states: nothing loaded yet, or the load failed outright.
export const screens = {
  loading: 'Loading…',

  sessionLoadFailed: {
    title: 'Couldn’t load your session.',
    body: 'Check this device’s internet connection. Nothing has been lost.',
  },

  rankingsLoadFailed: {
    title: 'Couldn’t load the rankings.',
    body: 'Check this device’s internet connection. Nothing has been lost.',
  },
};
