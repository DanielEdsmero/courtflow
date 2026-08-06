import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import PlayerAvatar from './PlayerAvatar';
import { skillStyle } from '../lib/skillStyles';
import { playTick, playChime, playThud } from '../lib/sound';
import { matchReveal as t } from '../copy';

/* ─────────────────────────────────────────────
   MATCH REVEAL
   Plays when four players land on a court. Three phases:

     0 – 4s   deal the four cards out, one at a time, photo first
     4 – 6s   hold them on screen, glowing, under "Going to Court X"
     6s +     fly the whole group into the court card they were assigned

   The court assignment itself is ALREADY COMMITTED before this mounts — this is
   a celebration of something that has happened, not a gate in front of it. That
   matters: a reload, a crash or an impatient click mid-sequence can never lose
   an assignment, and the TV display updates immediately regardless of what the
   staff screen is doing.

   Phase 3 measures the destination court card and flies to it rather than using
   layoutId. A layoutId morph needs the source to unmount in the same commit as
   the destination mounts, which would have meant holding the assignment back
   until the animation finished — exactly the fragility described above. The
   measured flight looks the same and cannot lose data.
   ───────────────────────────────────────────── */

// Phase boundaries, in ms from mount. Exported so tests assert against the real
// numbers instead of hard-coding a guess.
export const REVEAL_END_MS = 4000;
export const HOLD_END_MS = 6000;
export const FLIGHT_MS = 900;
export const TOTAL_MS = HOLD_END_MS + FLIGHT_MS;

// Stagger matches the tick sounds below: card n lands at 0.1 + n × 0.2s.
const DEAL_DELAY_S = 0.1;
const DEAL_STAGGER_S = 0.2;

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: DEAL_STAGGER_S, delayChildren: DEAL_DELAY_S },
  },
};

// Enters from above with a tilt, so it reads as a card dealt onto a table
// rather than a panel fading in.
const card = {
  hidden: { y: -40, rotate: -5, opacity: 0, scale: 0.8 },
  show: {
    y: 0,
    rotate: 0,
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 25, bounce: 0.4 },
  },
};

// Slightly snappier than the card and delayed behind it, so the face arrives
// just after the card it sits on.
const avatar = {
  hidden: { scale: 0, opacity: 0 },
  show: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 400, damping: 20, delay: 0.1 },
  },
};

export default function MatchRevealOverlay({ players, courtId, courtName, soundOn, onDone }) {
  // 1 = dealing, 2 = holding, 3 = flying to the court.
  const [phase, setPhase] = useState(1);
  const [flight, setFlight] = useState(null);
  const rowRef = useRef(null);
  const doneRef = useRef(false);

  // Fires onDone exactly once, however the sequence ends — timers, a skip
  // click, or an unmount mid-flight.
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Where the group has to land. Measured at flight time rather than on mount:
  // the courts band scrolls and reflows, so a rect captured 6 seconds ago is
  // not where the card is now.
  const measureFlight = () => {
    const row = rowRef.current;
    const target = document.querySelector(`[data-court-id="${String(courtId)}"]`);
    if (!row || !target) return { x: 0, y: -120, scale: 0.4 };
    const from = row.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return { x: 0, y: -120, scale: 0.4 };
    return {
      x: to.left + to.width / 2 - (from.left + from.width / 2),
      y: to.top + to.height / 2 - (from.top + from.height / 2),
      // Shrink toward the court card's width, but never so far that the faces
      // stop being readable on the way in.
      scale: Math.max(0.28, Math.min(0.5, to.width / from.width)),
    };
  };

  useEffect(() => {
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));

    // One tick per card, scheduled to match the visual stagger.
    if (soundOn) {
      players.forEach((_, i) => {
        at((DEAL_DELAY_S + i * DEAL_STAGGER_S) * 1000, playTick);
      });
    }

    at(REVEAL_END_MS, () => {
      setPhase(2);
      if (soundOn) playChime();
    });

    at(HOLD_END_MS, () => {
      setPhase(3);
      setFlight(measureFlight());
      if (soundOn) playThud();
    });

    at(TOTAL_MS, finish);

    return () => {
      timers.forEach(clearTimeout);
      // Unmounting mid-sequence still has to release the caller's lock.
      finish();
    };
    // Mount-only: the sequence is a fixed timeline, and re-running it on a prop
    // change would restart the deal halfway through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-sm cursor-pointer px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      onClick={finish}
      role="status"
      aria-live="polite"
      aria-label={`${t.matched} ${t.goingTo(courtName)}`}
      data-match-reveal
    >
      {/* Outer element owns the flight transform; the inner one owns the deal
          stagger. Splitting them keeps `animate` as a variant name on one and a
          value object on the other — Framer cannot do both on one element. */}
      <motion.div
        ref={rowRef}
        animate={flight ?? { x: 0, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 20, duration: FLIGHT_MS / 1000 }}
        style={{ opacity: phase === 3 ? 0.9 : 1 }}
      >
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-wrap items-start justify-center gap-3 sm:gap-5"
        >
          {players.map(p => (
            <motion.div
              key={p.id}
              variants={card}
              data-reveal-card
              className="w-[128px] sm:w-[150px] bg-zinc-900 border border-zinc-700 rounded-2xl px-3 py-4 flex flex-col items-center gap-2 shadow-2xl"
            >
              <motion.div variants={avatar} className="relative">
                <PlayerAvatar player={p} size="xxl" />
                {/* The "these four are locked in" pulse. Only during the hold —
                    a ring that breathes through the whole sequence stops
                    reading as a state change. */}
                {phase >= 2 && (
                  <motion.span
                    aria-hidden
                    className="absolute -inset-1.5 rounded-full ring-2 ring-lime-400"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: [0.25, 0.75, 0.25], scale: [1, 1.07, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </motion.div>

              <div className="text-center min-w-0 w-full">
                <div className="font-display text-lg leading-tight truncate">{p.name}</div>
                <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 border ${skillStyle(p.skill)}`}>
                  {p.skill}
                </span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {phase >= 2 && (
          <motion.div
            key="label"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            className="mt-7 text-center"
          >
            <div className="font-display text-3xl sm:text-4xl text-lime-400">{t.matched}</div>
            <div className="text-zinc-300 text-lg mt-1">{t.goingTo(courtName)}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="absolute bottom-6 text-xs text-zinc-600">{t.skipHint}</p>
    </motion.div>
  );
}
