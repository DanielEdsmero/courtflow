/* Wording for the two matching styles and the three payment states.

   These are referenced by name all over the app (the toolbar dropdown, the
   wizard cards, payment badges, the checkout screen and the activity log), so
   editing here changes every one of those at once.

   Only the text lives here — how the matcher actually behaves is in
   ../lib/logic.js, and changing a blurb does not change any behaviour. */

export const matchingStyles = {
  balanced: {
    label: 'Balanced',
    // The compact form, used where there is no room for the full label.
    short: 'Balanced',
    blurb:
      'Groups players who are having a similar day so the court is competitive, then balances the two teams inside it.',
  },
  winnersLosers: {
    label: 'Winners / Losers',
    short: 'Ladder',
    blurb: 'Groups players who are on form together — a winners court and a losers court.',
  },
};

export const payments = {
  online: {
    label: 'Paid — Online',
    // Shown on the small badge where the full label will not fit.
    short: 'Paid',
    // Appears in the activity log: "Checked in · Online".
    method: 'Online',
  },
  cash: {
    label: 'Paid — Cash',
    short: 'Cash',
    method: 'Cash',
  },
  unpaid: {
    label: 'Unpaid',
    short: 'Unpaid',
    method: null,
  },
};
