import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import PlayerAvatar from './PlayerAvatar';
import { flightLayoutId, FLIGHT_TRANSITION, STAGGER_MS, DEAL_DELAY_MS, MATCHED_MS, HOLD_END_MS, FADE_MS, FLIGHT_START_MS, TOTAL_MS } from './matchFlight';
import { playTick, playChime, playThud } from '../lib/sound';
import { matchReveal as t } from '../copy';

/* ─────────────────────────────────────────────
   MATCH REVEAL — full-screen
   Four players land on a court and the whole staff view dims behind a reveal:
   the cards deal out across the middle, hold, then fly up into the court card.

   RENDERED THROUGH A PORTAL TO document.body. That is the whole point — an
   earlier version rendered inside the queue panel, which meant the queue's own
   width, stacking context and `overflow` box confined it to a cramped column.
   A portal escapes all three, so the overlay genuinely covers the viewport.

   The portal keeps its place in the REACT tree even though it moves in the DOM
   tree, so the <LayoutGroup> in App still reaches it. That is what lets a card
   here share a layoutId with a row inside a court card and morph between them.

   The court assignment is already committed before this mounts — this
   celebrates something that has happened rather than gating it, so a reload or
   an impatient click can never lose a match.
   ───────────────────────────────────────────── */

const container = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: STAGGER_MS / 1000,
      delayChildren: DEAL_DELAY_MS / 1000,
    },
  },
};

// Dealt from a deck: enters high, tilted, and overshoots slightly on landing.
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

// Snappier than the card and delayed behind it, so the face arrives just after
// the card it sits on.
const avatar = {
  hidden: { scale: 0, opacity: 0 },
  show: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 400, damping: 20, delay: 0.1 },
  },
};

export default function MatchRevealOverlay({ players, courtName, soundOn, phase, onSkip }) {
  // 1 dealing · 2 matched (holding) · 3 backdrop fading · 4 cards in flight.
  // Phase is owned here rather than by App: it is presentation, and App only
  // needs to know when the whole thing is finished.
  const [localPhase, setLocalPhase] = useState(1);
  const doneRef = useRef(false);

  useEffect(() => {
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));

    // One tick per card, matched to the visual stagger.
    if (soundOn) {
      players.forEach((_, i) => at(DEAL_DELAY_MS + i * STAGGER_MS, playTick));
    }

    at(MATCHED_MS, () => {
      setLocalPhase(2);
      if (soundOn) playChime();
    });
    // Backdrop goes first; the cards stay put so they read as being left behind
    // on a bare screen, ready to move.
    at(HOLD_END_MS, () => setLocalPhase(3));
    // Dropping the cards is the unmount that hands their layoutIds to the court.
    at(FLIGHT_START_MS, () => {
      setLocalPhase(4);
      if (soundOn) playThud();
    });

    return () => timers.forEach(clearTimeout);
    // Mount-only: a fixed timeline, restarting it midway would re-deal the cards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard against a double skip (click + the parent's own timer landing together).
  const skip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onSkip();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      /* `text-zinc-100` is load-bearing, not decoration: this portals to
         document.body, which sits OUTSIDE the app wrapper that normally sets
         the text colour. Without it every unstyled string in here inherits the
         document default and renders black on a black backdrop. */
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center cursor-pointer px-4 font-body text-zinc-100"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
      initial={{ opacity: 0 }}
      // The backdrop fades at phase 3 while the cards below stay opaque.
      animate={{ opacity: localPhase >= 3 ? 0 : 1 }}
      transition={{ duration: localPhase >= 3 ? FADE_MS / 1000 : 0.2 }}
      onClick={skip}
      role="status"
      aria-live="polite"
      aria-label={`${t.matched} ${t.goingTo(courtName)}`}
      data-match-reveal
    >
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex flex-wrap items-start justify-center gap-3 sm:gap-6"
      >
        {/* Phase 4 empties this list — that unmount is what starts the flight. */}
        {localPhase < 4 && players.map(p => (
          <motion.div
            key={p.id}
            layoutId={flightLayoutId(p.id)}
            variants={card}
            transition={FLIGHT_TRANSITION}
            data-reveal-card
            data-flight-player={p.id}
            className="w-[132px] sm:w-[156px] bg-zinc-900 border border-zinc-700 rounded-2xl px-3 py-4 flex flex-col items-center gap-2.5 shadow-2xl"
          >
            <motion.span variants={avatar} className="relative">
              <PlayerAvatar player={p} size="xxl" />
              {/* "These four are locked in." Only during the hold — a ring that
                  breathes through the whole sequence stops reading as a change. */}
              {localPhase === 2 && (
                <motion.span
                  aria-hidden
                  className="absolute -inset-1.5 rounded-full ring-2 ring-lime-400"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: [0.25, 0.75, 0.25], scale: [1, 1.07, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </motion.span>
            <span className="font-display text-lg leading-tight text-center truncate w-full text-lime-400">
              {p.name}
            </span>
          </motion.div>
        ))}
      </motion.div>

      {localPhase === 2 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="mt-8 text-center"
        >
          <div className="font-display text-4xl sm:text-5xl text-lime-400 drop-shadow-[0_0_18px_rgba(163,230,53,0.55)]">
            {t.matched}
          </div>
          <div className="text-zinc-300 text-lg mt-1.5">{t.goingTo(courtName)}</div>
        </motion.div>
      )}

      {localPhase < 3 && (
        <p className="absolute bottom-6 text-xs text-zinc-500">{t.skipHint}</p>
      )}
    </motion.div>,
    document.body
  );
}
