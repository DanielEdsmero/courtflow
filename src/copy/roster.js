/* The ROSTER panel on the left of the staff screen: checking people in, the
   returning-player dropdown, the staff-only Values peek, and the checked-out
   drawer underneath. */

export const roster = {
  heading: 'ROSTER',

  // Staff-only toggle that reveals the hidden match values. Off by default.
  valuesToggle: 'Values',
  valuesToggleTitle:
    'Staff only — reveal the hidden match values the matcher groups on. Not shown to players.',
  valueChipTitle: (wins, losses) => `Hidden match value — ${wins}W × +1, ${losses}L × -0.5`,

  searchPlaceholder: 'Search players...',
  noneMatch: 'No players match.',

  // Bottom strip: "12 checked in · 4 available"
  countLine: (checkedIn, available) => `${checkedIn} checked in · ${available} available`,

  // What a busy player's row says instead of the action buttons.
  statusPlaying: 'Playing',
  statusQueued: 'Queued',

  addToQueueTitle: (name) => `Add ${name} to the queue — or drag them onto a group`,
  checkOutTitle: (name) => `Check out ${name}`,
  removeTitle: (name) => `Remove ${name}`,
};

// The "New player name…" box and its as-you-type dropdown.
export const checkIn = {
  namePlaceholder: 'New player name...',
  addTitle: 'Add player',
  returningHeading: 'Returning players',
  alreadyActive: 'Active',
  checkInAction: 'Check in',
  addNewPrefix: 'Add new player',
};

// Collapsed drawer of people who have left for the day.
export const checkedOut = {
  heading: 'CHECKED OUT',
  empty: 'No one’s checked out yet.',
  searchPlaceholder: 'Search checked-out players...',
  noneMatch: 'No checked-out players match.',
  checkBackInTitle: (name) => `Check ${name} back in`,
};
