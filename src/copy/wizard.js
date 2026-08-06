/* The three-step "Set up open play" guide. Opens by itself for a brand-new
   venue, and from the toolbar's "Guide me" button after that. */

export const wizard = {
  title: 'Set up open play',
  stepCounter: (step, total) => `Step ${step} of ${total}`,

  // Step 1 — how many courts, and how Auto builds a group.
  courtsHeading: 'Your courts',
  courtsBody: 'How many courts are you running today? You can add or rename them later.',
  courtsUnit: 'courts',
  matchingHeading: 'Matching style',
  matchingBodyBefore: 'How the',
  matchingBodyButton: 'Auto',
  matchingBodyAfter: 'button builds a group.',

  // Step 2 — get some names in.
  playersHeading: 'Add players',
  playersBody: 'Get a few names in now — you’ll check the rest in at the desk as they arrive.',
  playerPlaceholder: 'Player name…',
  addPlayer: 'Add',
  noPlayersYet: 'Nobody checked in yet.',
  checkedInCount: (n) => `${n} checked in`,
  needFour: '— you need at least 4 to start a game.',

  // Step 3 — the summary and the finish button.
  doneHeading: 'You’re all set',
  doneBody:
    'Check-in players at the desk, build a group, and CourtFlow fills the courts as they free up.',
  statCourts: 'Courts',
  statPlayers: 'Players',
  statMatching: 'Matching',
  start: 'Start Open Play',
};
