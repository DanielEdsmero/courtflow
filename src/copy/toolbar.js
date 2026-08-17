/* The staff header bar — every button, dropdown label and hover tooltip.
   `title:` entries are the tooltips that appear when you hover a control. */

export const toolbar = {
  // Left — which view you're looking at.
  viewStaff: 'Staff',
  viewPreview: 'Preview',

  // Default session length applied when a court is auto-filled.
  durationTitle: 'Default open-play session time — applied when auto-assigning',
  durationNone: 'No timer',
  durationMinutes: (n) => `${n} min`,

  // Competitive records winners; Casual just clears the court.
  competitive: 'Competitive',
  casual: 'Casual',
  competitiveTitleOn: 'Competitive mode ON — winners tracked, leaderboard active',
  competitiveTitleOff: 'Casual mode — no winner tracking, courts auto-clear when timer ends',

  // Right — the action buttons.
  displayLink: 'Display Link',
  displayLinkTitle: 'Get the link to open on your TV',

  announce: 'Announce',
  announcement: 'Announcement',
  announceTitle: 'Broadcast announcement to the customer display screen',

  log: 'Log',
  logTitle: 'Check-in, checkout, match results and payment history',

  sessionRank: 'Session Rank',
  sessionRankTitle: 'Today’s standings — wins, losses and recent form',

  rankings: 'Rankings',
  rankingsTitle: 'All-time rankings across every session',

  guideMe: 'Guide me',
  guideMeTitle: 'Walk through setting up open play',

  reset: 'Reset',
  signOutTitle: 'Sign out',
};

// The strip that slides down when you press Announce.
export const announcementBar = {
  placeholder: 'Type a message for the customer display...',
  clearTitle: 'Clear announcement',
  live: 'Live on customer display',
};
