/* The two read-only screens: the TV display and the public club board players
   reach by scanning the poster.

   Only the MESSAGES live here — the court cards and queue tiles keep their
   wording inline, as asked. */

// The TV, opened from the staff app's Display Link.
export const tvDisplay = {
  notFoundTitle: 'Display not found',
  notFoundBody: 'This link is no longer valid. Ask the front desk for a new one.',
  unreachableTitle: 'Can’t reach CourtFlow',
  unreachableBody: 'Check this device’s internet connection. Retrying automatically.',
};

// The public /club/<name> board. Worded for a player standing in the club with
// their phone, not for staff — hence the mention of the poster.
export const clubBoard = {
  notFoundTitle: 'Club not found',
  notFoundBody: 'Check the address on the poster, or ask the front desk for today’s queue.',
  unreachableTitle: 'Can’t reach CourtFlow',
  unreachableBody: 'Check your connection. This page retries on its own.',
};

// The little pill in the corner when the live connection has dropped.
export const connection = {
  reconnecting: 'reconnecting…',
};

// The printable QR poster inside the Display Link pop-up. `scanLine` is the one
// line a player reads from across the room, so keep it short and in capitals.
export const qrPoster = {
  scanLine: 'SCAN FOR THE LIVE QUEUE',
  copy: 'Copy link',
  copied: 'Copied',
  open: 'Open',
  print: 'Print poster',
};
