/* Every pop-up in the staff app. One object per dialog, named after the button
   that opens it. `title` is the bold heading at the top of the box. */

// Queue → "Assign to court"
export const assign = {
  title: 'Assign to court',
  groupLabel: 'Group:',
  noOpenCourts: 'No open courts. Finish a match first.',
  pickPrompt: 'Pick a court and duration:',
  rentalTag: 'RENTAL',
  openPlayTag: 'OPEN PLAY',
  // Winners / Losers only, and never binding — any court can still be picked.
  suggestedTag: 'SUGGESTED',
  autoWillUse: (minutes) => `auto will use ${minutes}m`,
  defaultDurationTitle: 'This is your default session time',
};

// Court card → "FINISH MATCH"
export const finishMatch = {
  title: (courtName) => `Finish ${courtName} — who won?`,
  team1: 'TEAM 1',
  team2: 'TEAM 2',
  markWinner: '↳ MARK AS WINNER',
};

// Roster → the log-out icon on a player's row
export const checkout = {
  title: (name) => `Check out — ${name}`,
  checkedInLabel: 'Checked in',
  sessionLengthLabel: 'Session length',
  paymentLabel: 'Payment',
  unpaidWarning: (name) => `${name} has not paid yet. Please collect payment.`,
  payOnline: 'Paid — Online',
  payCash: 'Paid — Cash',
  confirmPaid: 'Check out',
  confirmUnpaid: 'Check out anyway',
};

// Queue → the × next to a player inside a group.
// Deliberately shows no values: staff pick on names.
export const replacePlayer = {
  title: (name) => `Replace ${name}?`,
  intro: 'They’re leaving',
  introAfter: 'Who takes the spot?',
  groupLabel: (n) => `group #${n}`,
  fallbackGroupLabel: 'the queue',

  closestMatch: (name) => `Closest match — ${name}`,
  closestBadge: 'EVEN',

  randomDraw: 'Random draw',
  randomBadge: 'FAIR',
  randomTitle: 'Draw any available player at random — spreads the play around',

  pickPrompt: 'Or pick someone:',
  searchPlaceholder: 'Search available players...',
  noneMatch: 'No available players match.',
  leaveOpen: 'Leave the spot open',
};

// Court card → "RENTAL ▶" then "Book"
export const rental = {
  title: (courtName) => `Book ${courtName}`,
  fallbackCourtName: 'Rental',
  hostPrompt: 'Pick one person as the host for this rental:',
  searchPlaceholder: 'Search players...',
  noneAvailable: 'No available players.',
  durationLabel: 'Duration:',
  bookingFor: 'Booking for',
  partySuffix: (name) => `${name}'s Party`,
  confirm: 'Confirm Booking',
};

// Fires automatically after adding a brand-new player, if a camera exists.
export const camera = {
  title: (name) => `Photo for ${name}`,
  previewAlt: 'Preview',
  retake: 'Retake',
  save: 'Save Photo',
  take: 'Take Photo',
};

// Toolbar → "Display Link"
export const displayLink = {
  title: 'Customer Display',
  intro:
    'Open this link in the browser on your TV, then put it full screen. It updates live and is read-only — nobody can change anything from it.',
  copy: 'Copy link',
  copied: 'Copied',
  open: 'Open',

  clubHeading: 'Club queue link',
  clubIntro:
    'Print this for the front desk — players scan it to see the queue on their phone. It never changes, so regenerating the TV link above leaves every printed copy working.',

  noQrHeadline: 'No printable QR code yet.',
  noQrBody: 'This club has no queue address, which means the database is missing the latest',
  noQrFileName: 'supabase/schema.sql',
  noQrBodyAfter: 'Re-run it and reload — the QR poster appears here automatically.',

  regenerate: 'Generate a new link',
  regenerateNote:
    'Use this if the link was shared somewhere it shouldn’t have been. The old one stops working straight away.',
};

// Toolbar → "Log"
export const activityLog = {
  title: 'Activity Log',
  empty: 'No activity yet today.',
  footer: 'Showing this session’s events (most recent first). Cleared on session reset.',

  // The coloured label on each row.
  labels: {
    checkin: 'Checked in',
    checkout: 'Checked out',
    result: 'Match won',
    payment: 'Payment updated',
    autoGroup: 'Auto-grouped',
    // Nothing writes this any more; kept so old saved sessions still read right.
    noshow: 'No-show removed',
  },

  // The grey detail line under each row.
  returning: 'Returning',
  newPlayer: 'New',
  checkoutHere: (duration) => `here ${duration}`,
  resultDefeated: (loserNames) => `def. ${loserNames}`,
  paymentChange: (label) => `→ ${label}`,
  /* One line per Auto press. Staff-only, like the whole log — it names how
     many groups came out and which rules had to give, never who faced whom
     and never a hidden Value. */
  autoGroupRun: (created, before, after) =>
    `${created} group${created === 1 ? '' : 's'} from ${before} available · ${after} left`,
  autoGroupLevels: (levels) => {
    const fallbacks = levels.filter((l) => l !== 'strict').length;
    if (levels.length === 0) return 'nothing to build';
    return fallbacks === 0
      ? 'all strict'
      : `${fallbacks} fallback${fallbacks === 1 ? '' : 's'}`;
  },
  noshowFrom: (courtName) => `from ${courtName}`,
};
