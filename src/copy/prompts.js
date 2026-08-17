/* The browser confirm/alert boxes, and the coloured warning banners that appear
   inside the app. These are the messages that interrupt someone, so they are
   worth wording carefully. */

// Native confirm() dialogs — the OK/Cancel boxes.
export const confirms = {
  resetSession: 'Start a new session? All player values will reset to 0.',
  regenerateDisplayLink:
    'Generate a new display link? The old one stops working immediately.',
};

// Native alert() boxes — a single OK.
export const alerts = {
  addPlayerFailed: (name) => `Couldn't add ${name}. Check your connection and try again.`,
  notEnoughToAutoGroup: 'Need at least 4 players between the queue and the roster before Auto can make a group.',
  // Auto ran, but every court was busy, the queue already had a waiting group,
  // and nothing else could legally be formed. Says so rather than looking broken.
  autoPassDidNothing: 'Nothing to do — courts are busy and a group is already waiting.',
  regenerateFailed: 'Could not regenerate the link. Check your connection and try again.',
};

// The red bar across the top when win/loss writes are being rejected.
export const statsWriteBanner = {
  headline: 'Win/loss results aren’t being saved.',
  body: 'They’ll reset when this page reloads. Your database is likely missing the latest',
  fileName: 'supabase/schema.sql',
  bodyAfter: '— re-run it, then finish a match to clear this.',
};
