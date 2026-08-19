/* The queue panel — the Auto action, the result line it writes, and the labels
   on each waiting group.

   Auto builds matchups and nothing else, so every string here is careful never
   to imply that a court was touched. Staff move a group onto a court themselves,
   with the Assign to court button. */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const queue = {
  heading: 'QUEUE',

  // The one Auto action. Named for what it does to the bench, not to the courts.
  autoButton: 'Auto-group Available',
  autoButtonBusy: 'Grouping…',
  autoHelp: 'Creates all possible 4-player matchups. Staff assigns groups to open courts.',
  autoTitle:
    'Builds every complete group the Available players can make — closest values, no recent rematches. Courts are never changed.',

  /* The result line. Non-blocking on purpose: Auto is a button staff press
     repeatedly through a session, and a modal alert on every press is unusable.
     It always ends by saying the courts were left alone, because that is the
     single thing about this action people get wrong. */
  autoCreated: (created, toppedUp, remaining) => {
    const parts = [];
    if (created > 0) parts.push(`Created ${plural(created, 'waiting group', 'waiting groups')}`);
    if (toppedUp > 0) parts.push(`filled ${plural(toppedUp, 'partial group', 'partial groups')}`);
    const done = parts.length ? `${parts.join(' and ')}.` : 'Nothing to create.';
    const left = remaining > 0 ? ` ${plural(remaining, 'player', 'players')} still Available.` : '';
    return `${done} Courts were not changed.${left}`;
  },

  // Nothing could be built. Says the true reason rather than blaming the courts.
  autoNothingCreated: (remaining) =>
    `No additional full groups can be created; ${plural(remaining, 'player', 'players')} remain Available.`,

  // Group card.
  typeAuto: 'Auto-grouped',
  typeManual: 'Manual',
  team: (n) => `TEAM ${n}`,
  allPaid: 'All paid',
  unpaid: (n) => `${n} unpaid`,
  assign: 'Assign to court',
  incomplete: (n) => `Incomplete — ${plural(n, 'more player', 'more players')} needed`,
  dropHere: (n) => `Drop to add here · ${plural(n, 'spot', 'spots')} left`,

};
