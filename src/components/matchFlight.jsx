import React from 'react';
import { motion } from 'motion/react';
import PlayerAvatar from './PlayerAvatar';

/* ─────────────────────────────────────────────
   MATCH FLIGHT — shared pieces
   The reveal itself is MatchRevealOverlay.jsx; this holds the timings and the
   court-side element, so both sides of the layoutId handover agree without the
   overlay importing App.jsx.
   ───────────────────────────────────────────── */

// Phase boundaries in ms from mount. Exported so tests assert the real numbers
// rather than guessing at them.
export const STAGGER_MS = 200;
export const DEAL_DELAY_MS = 100;
export const MATCHED_MS = 1600;   // all four landed → "Matched!" + chime
export const HOLD_END_MS = 5000;  // ≥5s on screen before anything moves
export const FADE_MS = 500;       // backdrop fades, cards stay
export const FLIGHT_START_MS = HOLD_END_MS + FADE_MS;
export const FLIGHT_MS = 900;
export const TOTAL_MS = FLIGHT_START_MS + FLIGHT_MS;

// One id per player, shared by the overlay card and the court row. Framer
// morphs between the two whenever one unmounts as the other mounts.
export const flightLayoutId = (playerId) => `flight-player-${playerId}`;

// How the flight moves: heavier than the deal springs, because it is crossing
// most of the screen and snapping would lose the sense of travel.
export const FLIGHT_TRANSITION = { type: 'spring', stiffness: 200, damping: 26 };

/* The court-side half of the handover. The overlay's card carries the same
   layoutId, so when the overlay drops it this is what Framer flies it into.
   Court-only detail (team label, payment dot, skill) belongs OUTSIDE this, in
   the row that wraps it, so the morphing subtree stays small and stable. */
export function FlightPlayerItem({ player }) {
  return (
    <motion.div
      layoutId={flightLayoutId(player.id)}
      transition={FLIGHT_TRANSITION}
      className="flex items-center gap-2 min-w-0 flex-1"
      data-flight-player={player.id}
    >
      <span className="shrink-0">
        <PlayerAvatar player={player} size="sm" />
      </span>
      <span className="text-sm font-semibold truncate">{player.name}</span>
    </motion.div>
  );
}
