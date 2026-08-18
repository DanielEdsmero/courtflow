/* One import for everything, so a component can pull in just what it needs:

     import { modals, roster } from './copy';

   Each file is documented in ./README.md. Nothing in this folder imports
   anything else in the app, so it can never create a circular import. */

export { brand, buttons, screens } from './common';
export { toolbar, announcementBar } from './toolbar';
export { roster, checkIn, checkedOut } from './roster';
export { confirms, alerts, statsWriteBanner } from './prompts';
export { wizard } from './wizard';
export { sessionRank, leaderboardModal, allTime } from './rankings';
export { auth, activate } from './auth';
export { tvDisplay, clubBoard, connection, qrPoster } from './board';
export { settings, matchReveal, matcherDiagnostics } from './settings';
export { matchingStyles, payments } from './matching';
export { queue } from './queue';

// Namespaced rather than spread: `modals.checkout.title` reads better than a
// flat `checkoutTitle`, and every dialog has a `title`.
export * as modals from './modals';
