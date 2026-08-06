import React from 'react';
import { motion } from 'motion/react';
import PlayerAvatar from './PlayerAvatar';
import { matchReveal as t } from '../copy';

/* ─────────────────────────────────────────────
   QUEUE → COURT FLIGHT
   The four players are revealed inside their queue group card, the card pulses,
   and then the players physically fly up into the court card they were assigned.

   HOW THE FLIGHT WORKS
   Framer morphs between two elements that share a `layoutId` when one unmounts
   in the same commit the other mounts. So during phases 1–2 the players are
   rendered by the GHOST group down in the queue, and at phase 3 the ghost
   unmounts while the court card mounts the same ids — Framer measures both
   positions and animates the gap. Both sides sit inside one <LayoutGroup> in
   StaffView, which is what lets the ids find each other across two components.

   WHY A GHOST RATHER THAN THE REAL QUEUE GROUP
   The court assignment is committed the moment staff click — before any of this
   runs. That means the real group has already left `queue`, so there is nothing
   left in the queue to fly. The ghost is a purely visual stand-in holding the
   players' last known position.

   It is worth the extra piece: the alternative is to delay the assignment until
   the animation finishes, which makes a reload, a crash or an impatient click
   mid-flight able to lose the match entirely. With the ghost, refreshing at any
   point shows the true state — players on court — and simply skips the show.
   ───────────────────────────────────────────── */

// Phase boundaries in ms from the start. Exported so tests assert the real
// numbers rather than a guess.
export const STAGGER_MS = 150;
export const REVEAL_END_MS = 3000; // phase 1: players appear one at a time
export const HOLD_END_MS = 4000;   // phase 2: card glows, label fades in
export const TOTAL_MS = 6000;      // phase 3: the flight, then done

// One id per player, shared by the ghost item and the court item.
export const flightLayoutId = (playerId) => `flight-player-${playerId}`;

// Slide up into place with a spring, as specified.
export const queueItem = {
  hidden: { y: 20, opacity: 0, scale: 0.9 },
  show: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  },
};

export const queueList = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER_MS / 1000 } },
};

// The avatar pops in beside the name rather than fading with it.
export const avatarPop = {
  hidden: { scale: 0, opacity: 0 },
  show: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 400, damping: 20 },
  },
};

// How the flight itself moves. Slower and heavier than the reveal springs — it
// is crossing most of the screen, and snapping would lose the sense of travel.
const FLIGHT_TRANSITION = { type: 'spring', stiffness: 200, damping: 26 };

/* The morphing element itself. This subtree must be IDENTICAL in the queue and
   in the court card — same tags, same order, same classes — or the morph will
   visibly pop as Framer reconciles two different trees. Anything court-specific
   (team label, payment dot, skill) belongs OUTSIDE this component, in the row
   that wraps it. */
export function FlightPlayerItem({ player, animateIn = false }) {
  return (
    <motion.div
      layoutId={flightLayoutId(player.id)}
      layout
      transition={FLIGHT_TRANSITION}
      variants={animateIn ? queueItem : undefined}
      className="flex items-center gap-2 min-w-0 flex-1"
      data-flight-player={player.id}
    >
      <motion.span variants={animateIn ? avatarPop : undefined} className="shrink-0">
        <PlayerAvatar player={player} size="sm" />
      </motion.span>
      <span className="text-sm font-semibold truncate">{player.name}</span>
    </motion.div>
  );
}

/* The queue-side card for phases 1–2: the players reveal inside it, then it
   glows and announces where they are going. Rendered at the index the real
   group occupied, so it reads as that group rather than a new one. */
export function GhostQueueGroup({ reveal, onSkip }) {
  const glowing = reveal.phase >= 2;
  return (
    <motion.div
      layout
      onClick={onSkip}
      data-flight-ghost
      className={`rounded-xl border p-2.5 cursor-pointer transition-colors duration-500 ${
        glowing
          ? 'bg-lime-950/40 border-lime-500 shadow-[0_0_24px_-4px_rgba(163,230,53,0.55)]'
          : 'bg-zinc-900 border-zinc-800'
      }`}
      title={t.skipHint}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-display text-xl text-lime-400">
          #{reveal.groupIndex + 1}
        </span>
        {glowing && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] font-bold tracking-wider text-lime-300 bg-lime-950 border border-lime-700 px-2 py-0.5 rounded-full"
          >
            {t.matched}
          </motion.span>
        )}
      </div>

      {/* Phase 3 empties the list, which is the unmount that hands each id over
          to the court card and starts the flight. */}
      <motion.div
        variants={queueList}
        initial="hidden"
        animate="show"
        className="space-y-1"
      >
        {reveal.phase < 3 && reveal.players.map(p => (
          <div key={p.id} className="flex items-center rounded px-1 py-0.5">
            <FlightPlayerItem player={p} animateIn />
          </div>
        ))}
      </motion.div>

      {glowing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="text-xs text-lime-300 font-semibold mt-2 text-center"
        >
          {t.goingTo(reveal.courtName)}
        </motion.div>
      )}
    </motion.div>
  );
}
