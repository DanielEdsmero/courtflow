import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { LayoutGroup } from 'motion/react';
import {
  Plus, Trophy, RotateCcw, X, Check, Search, Zap, Monitor,
  Settings, Users, ChevronRight, Clock, Trash2, UserPlus,
  Shuffle, Crown, Activity, Megaphone, BarChart2, Camera,
  Copy, LogOut, RefreshCw, ExternalLink, AlertTriangle, ClipboardList,
  LogIn, DollarSign, Medal, HelpCircle, Eye, EyeOff,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth } from './lib/AuthProvider';
import { supabase } from './lib/supabase';
import { loadSession, createSessionSync } from './lib/session';
import {
  listPlayers, createPlayer, deletePlayer, updatePlayerPhoto,
  updatePlayerPayment, recheckInPlayer, checkOutPlayer, recordResult, resetAllStats, recordMatchHistory,
} from './lib/players';
import { uploadPhoto } from './lib/photos';
// All user-facing wording lives in ./copy — see ./copy/README.md. The courts and
// queue panels deliberately keep theirs inline.
import {
  brand, buttons, screens, toolbar, announcementBar,
  roster as rosterCopy, checkIn, checkedOut as checkedOutCopy,
  confirms, alerts, statsWriteBanner,
  sessionRank as sessionRankCopy, leaderboardModal as leaderboardCopy,
  queue as queueCopy,
  matcherDiagnostics as diagCopy,
  modals,
} from './copy';
import ModalShell from './components/ModalShell';
import OnboardingWizard from './components/OnboardingWizard';
import ClubQrPoster from './components/ClubQrPoster';
import SettingsMenu from './components/SettingsMenu';
import PlayerAvatar from './components/PlayerAvatar';
import MatchRevealOverlay from './components/MatchRevealOverlay';
import { FlightPlayerItem, FLIGHT_START_MS, TOTAL_MS } from './components/matchFlight';
import { skillStyle, skillStyleSolid } from './lib/skillStyles';
import { loadPrefs, savePrefs } from './lib/prefs';
import { setSoundEnabled } from './lib/sound';

// Pure logic lives in ./lib/logic.js so tests can import it without booting the
// Supabase client. Re-exported here because existing callers import from App.
import {
  SKILL_TIERS, skillRank, fmtElapsed, fmtDuration, fmtWaiting, balancedGroup,
  defaultCourts, hydrateCourts, matchRoster, findExactPlayer,
  PAYMENT_STATUSES, PAYMENT_ORDER, paymentInfo, isPaid,
  DEFAULT_MATCHING_STYLE, MATCHING_STYLE_ORDER, matchingStyleInfo,
  playerValue, closestByValue, randomFrom, sessionLeaderboard,
} from './lib/logic';
// Group formation, court filling and the repeat ladder (spec §1–§7). Pure and
// clock-free: every call below hands it `now`.
import { generateAutoQueueGroups, assignQueuedGroupToCourt } from './lib/queue-engine';
// When a waiting group is likely to be called. Pure and clock-free; every
// caller hands it `now`. See lib/wait-estimate.js for why it would rather say
// nothing than say a number it cannot stand behind.
import { callEstimate } from './lib/wait-estimate';
// One canonical timestamp shape (epoch ms) and one place that does the
// arithmetic — see lib/time.js.
import {
  durationBetween, matchEndsAt, formatDuration, normalizeTimestamp, TIME_UNAVAILABLE,
} from './lib/time';
export { SKILL_TIERS, skillRank, fmtElapsed, fmtWaiting, balancedGroup };

// Bounds the in-memory activity log carried in the session blob.
const MAX_AUDIT = 100;

/* Ids for courts and queue groups (spec §10). Date.now() on its own collides
   whenever two are created inside the same millisecond, and two rows sharing a
   React key is exactly how "Court 1" and "Court 2" ended up rendering on top of
   each other as "Court12". A monotonic counter cannot collide. */
let uidSeq = 0;
const nextUid = (prefix) => `${prefix}-${Date.now().toString(36)}-${uidSeq++}`;

/* Every queue group carries its own formation timestamp (spec §9). Topping a
   partial group up later must NOT refresh it — the group has been waiting since
   the moment staff started it. */
const newQueueGroup = (playerIds, type = 'manual') => ({
  id: nextUid('q'),
  players: playerIds,
  type,
  createdAt: Date.now(),
});

// True if this device has a webcam. Lets the check-in flow skip the photo step
// silently when there's no camera, instead of popping an error modal (spec §5).
// enumerateDevices exposes device *kinds* without camera permission, so this is a
// permission-free probe; we only need to know a videoinput exists.
async function hasCamera() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(d => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

// Subtle vertical divider between toolbar button groups (spec §4A). Hidden when
// the toolbar wraps to a second row on narrow screens.
function Divider() {
  return <div className="hidden lg:block w-px h-7 bg-zinc-800 mx-1 shrink-0" aria-hidden />;
}

/* ─────────────────────────────────────────────
   PAYMENT BADGE + EDITOR
   Rendered everywhere a player name appears. `dot` is the compact form (a single
   coloured circle for tight rows like the queue); the default is a labelled pill.
   ───────────────────────────────────────────── */
function PaymentBadge({ payment, dot = false, title }) {
  const info = paymentInfo(payment);
  // A quick "pop" whenever the status actually changes (spec §4) — confirms a
  // staff edit at a glance. Seeded from the first value so it never fires on
  // mount, only on a real change.
  const prev = useRef(payment);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (prev.current === payment) return;
    prev.current = payment;
    setPop(true);
    const t = setTimeout(() => setPop(false), 340);
    return () => clearTimeout(t);
  }, [payment]);
  const popClass = pop ? 'cf-pop' : '';

  if (dot) {
    return (
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${info.dot} ${popClass}`}
        title={title ?? info.label}
        aria-label={info.label}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${info.badge} ${popClass}`}
      title={title ?? info.label}
    >
      <span aria-hidden>{info.icon}</span>
      {info.short}
    </span>
  );
}

// A payment badge that opens a little menu to change the status. Used in the
// roster so staff can correct a payment at any time (spec §8).
function PaymentEditor({ payment, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        title="Change payment status"
        className="focus:outline-none"
      >
        <PaymentBadge payment={payment} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1 w-44"
          onClick={(e) => e.stopPropagation()}
        >
          {PAYMENT_ORDER.map(status => {
            const info = PAYMENT_STATUSES[status];
            const active = status === payment;
            return (
              <button
                key={status}
                onClick={(e) => { e.stopPropagation(); onChange(status); setOpen(false); }}
                className={`w-full flex items-center gap-2 text-left text-xs font-semibold px-2 py-1.5 rounded-md transition ${
                  active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span aria-hidden>{info.icon}</span>
                {info.label}
                {active && <Check className="w-3.5 h-3.5 ml-auto text-lime-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   APP
   ───────────────────────────────────────────── */
export default function App() {
  const { venue, signOut } = useAuth();
  const venueId = venue.id;

  // Nothing renders until the roster and saved session are back from Supabase —
  // mounting with empty defaults first would flash an empty gym, then pop.
  const [booting, setBooting] = useState(true);
  // If the load fails we must NOT fall through to the app: the save effect would
  // then push default state over a perfectly good saved session.
  const [loadFailed, setLoadFailed] = useState(false);

  const [view, setView]               = useState('staff');
  const [players, setPlayers]         = useState([]);
  const [courts, setCourts]           = useState(defaultCourts);
  const [queue, setQueue]             = useState([]);
  const [history, setHistory]         = useState([]);
  // Append-only audit trail: check-ins, checkouts, payment changes (spec §9).
  // Lives in the session blob so it survives a refresh; capped at MAX_AUDIT.
  const [auditLog, setAuditLog]       = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const [competitiveMode, setCompetitiveMode] = useState(false);
  // null = no timer; number = minutes. Applies to auto-assign for open-play courts.
  const [defaultOpenDuration, setDefaultOpenDuration] = useState(null);
  // How the Auto button forms a group (spec §F1, §F2). In the session blob so
  // it's a club setting rather than a per-device one.
  const [matchingStyle, setMatchingStyle] = useState(DEFAULT_MATCHING_STYLE);
  // Whether the setup wizard has been run for this venue (spec §F5). Also in the
  // blob: a club that set up on the desk iPad must not be re-onboarded on the
  // manager's laptop.
  const [onboarded, setOnboarded] = useState(true);
  // Set when a win/loss write is rejected. Purely a warning surface: the session
  // keeps working, but staff need to know the numbers on screen are not saved,
  // because a reload silently reverts them all to zero.
  const [statsWriteFailed, setStatsWriteFailed] = useState(false);

  const [showDisplayLink, setShowDisplayLink] = useState(false);
  const [displayToken, setDisplayToken] = useState(venue.display_token);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerSkill, setNewPlayerSkill] = useState('Intermediate');
  const [newPlayerPayment, setNewPlayerPayment] = useState('unpaid');
  const [search, setSearch]           = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showSessionRank, setShowSessionRank] = useState(false);
  // { playerId, groupId } while staff decide who takes a vacated queue slot.
  const [replacing, setReplacing] = useState(null);

  // Animations + sound. Per-device (localStorage), not per-club — the desk
  // tablet and the office laptop can reasonably disagree. Read once on mount so
  // the very first render already has the right answer.
  const [prefs, setPrefs] = useState(loadPrefs);
  const updatePrefs = (next) => { setPrefs(next); savePrefs(next); };
  // The sound module holds its own enabled flag so deep callers don't have to
  // thread the preference down to every cue.
  useEffect(() => { setSoundEnabled(prefs.sound); }, [prefs.sound]);

  // The match reveal currently playing: { players, courtId, courtName }.
  // Non-null also acts as the lock that stops a second assignment stacking a
  // second overlay on top of the first.
  const [reveal, setReveal] = useState(null);
  const revealRef = useRef(null);
  revealRef.current = reveal;

  // Called AFTER the court has already been assigned, by both the manual and
  // the auto-assign paths. Returns silently when animations are off, when a
  // reveal is already playing, or for a group that isn't a full four — a
  // celebration of a half-empty court would be worse than none.
  const startReveal = (playerIds, court) => {
    if (!prefs.animations || revealRef.current || !court) return;
    const revealed = playerIds.map(playerById).filter(Boolean);
    if (revealed.length < 4) return;
    const next = {
      token: `${court.id}-${Date.now()}`, // stable key for the phase timers
      players: revealed,
      courtId: court.id,
      courtName: court.name,
      // False until the overlay drops the cards; see the effect below.
      handedOver: false,
    };
    revealRef.current = next; // claim the lock now, not on the next render
    setReveal(next);
  };

  const endReveal = () => { revealRef.current = null; setReveal(null); };

  // App owns only the START and the END of the sequence; the overlay runs its
  // own phase timeline internally, because every phase is presentation.
  //
  // `handedOver` is the one thing App needs from the middle of it: once the
  // overlay drops the cards, the court card must render them so the layoutIds
  // have somewhere to land. Keyed on `token` so advancing it doesn't restart.
  const revealToken = reveal?.token;
  useEffect(() => {
    if (!revealToken) return;
    const timers = [
      setTimeout(() => setReveal(r => (r ? { ...r, handedOver: true } : r)), FLIGHT_START_MS),
      setTimeout(endReveal, TOTAL_MS),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealToken]);
  // Staff-only peek at the hidden values (spec §1). Deliberately plain state:
  // it is not persisted and not in the session blob, so it is off again on every
  // reload and can never reach the TV display or the public club board.
  const [showValues, setShowValues] = useState(false);
  const [finishingCourt, setFinishingCourt]   = useState(null);
  // Id of the player being checked out (spec §3). Checkout is a roster action —
  // a person leaving for the day — not something a court ending triggers.
  const [checkoutPlayerId, setCheckoutPlayerId] = useState(null);
  const [showAssign, setShowAssign]           = useState(null);
  // What the last Auto press did, shown inline under the Queue header rather
  // than as a dialog: Auto is pressed over and over through a session, and a
  // modal on every press would be unusable. Cleared on its own after a few
  // seconds by the Queue panel.
  const [autoStatus, setAutoStatus]           = useState(null);
  /* Why the matcher grouped people the way it did, keyed by group id.
     Deliberately React-only: it is NOT written into the session blob, so it
     cannot reach the TV display or the public club board, which read that blob.
     The cost is that it does not survive a reload — correct, since it describes
     a particular Auto run rather than the group itself. */
  const [matcherRuns, setMatcherRuns]         = useState({});
  const [showRental, setShowRental]           = useState(null);
  const [showAnnouncementBar, setShowAnnouncementBar] = useState(false);
  const [pendingPhotoPlayerId, setPendingPhotoPlayerId] = useState(null);
  const [draggingPlayerId, setDraggingPlayerId]         = useState(null);

  const [tick, setTick] = useState(0);
  // The clock the UI hands to anything that renders elapsed time (spec §9). Read
  // once per render rather than inside the queue card, so every group on screen
  // is measured against the same instant.
  const nowTick = useMemo(() => Date.now(), [tick]);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Boot: roster from the players table, live session from the sessions row ──
  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    setLoadFailed(false);
    (async () => {
      try {
        const [roster, saved] = await Promise.all([listPlayers(venueId), loadSession(venueId)]);
        if (cancelled) return;
        setPlayers(roster);
        if (saved) {
          setCourts(saved.courts ? hydrateCourts(saved.courts) : defaultCourts());
          setQueue(saved.queue ?? []);
          setHistory(saved.history ?? []);
          setAuditLog(saved.auditLog ?? []);
          setAnnouncement(saved.announcement ?? '');
          setCompetitiveMode(saved.competitiveMode ?? false);
          setDefaultOpenDuration(saved.defaultOpenDuration ?? null);
          setMatchingStyle(saved.matchingStyle ?? DEFAULT_MATCHING_STYLE);
          // A venue with a saved session predates the wizard by definition — it's
          // already set up, so default to onboarded rather than ambushing staff.
          setOnboarded(saved.onboarded ?? true);
        } else {
          // A genuinely empty sessions row is a brand new venue: run the tour.
          setOnboarded(false);
        }
        if (!cancelled) setBooting(false);
      } catch (err) {
        console.error('Failed to load venue data:', err);
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, reloadNonce]);

  // Fire the setup wizard once, the first time a brand new venue reaches the
  // dashboard. Manual re-runs come from the "Guide me" toolbar button.
  useEffect(() => {
    if (!booting && !onboarded) setShowWizard(true);
  }, [booting, onboarded]);

  // ── Session sync: debounced write to Postgres + instant broadcast to the TV ──
  const syncRef = useRef(null);
  useEffect(() => {
    const sync = createSessionSync(venueId, displayToken, venue.slug);
    syncRef.current = sync;
    return () => {
      sync.destroy();
      syncRef.current = null;
    };
  }, [venueId, displayToken, venue.slug]);

  // Replaces the old localStorage write. Players are excluded — they live in
  // their own table now, and the display fetches them separately.
  useEffect(() => {
    if (booting) return;
    syncRef.current?.push({
      courts, queue, history, auditLog, competitiveMode, announcement, defaultOpenDuration,
      matchingStyle, onboarded,
    });
  }, [booting, courts, queue, history, auditLog, competitiveMode, announcement,
      defaultOpenDuration, matchingStyle, onboarded]);

  // Auto-expire courts when their duration runs out.
  useEffect(() => {
    const now = Date.now();
    const expired = courts.filter(c => {
      if (!c.match?.endsAt || now < c.match.endsAt) return false;
      if (c.type === 'rental') return true;
      if (!competitiveMode) return true;
      return false;
    });
    if (expired.length === 0) return;
    expired.forEach(c => {
      const entry = {
        id: Date.now() + Math.random(),
        courtId: c.id,
        players: c.match.players,
        type: c.type === 'rental' ? 'rental' : 'casual',
        duration: now - c.match.startedAt,
        finishedAt: now,
        autoEnded: true,
      };
      setHistory(h => [entry, ...h]);
      recordMatchHistory(venueId, { ...entry, courtName: c.name });
      // The timer running out just frees the court — the players dissolve back to
      // the roster, still checked in (spec §8). Nothing is re-queued and no court
      // is refilled: group formation only ever happens when staff click Auto.
    });
    setCourts(prev => prev.map(c =>
      expired.find(e => e.id === c.id) ? { ...c, match: null } : c
    ));
  }, [tick, competitiveMode]);

  const busyPlayerIds = useMemo(() => {
    const ids = new Set();
    courts.forEach(c => c.match?.players.forEach(p => ids.add(p)));
    queue.forEach(g => g.players.forEach(p => ids.add(p)));
    return ids;
  }, [courts, queue]);

  const playerById = (id) => players.find(p => p.id === id);

  // Append to the audit trail (spec §9). Newest first, capped so the session blob
  // stays well under the Realtime broadcast limit.
  const logEvent = (entry) =>
    setAuditLog(prev => [{ id: `${Date.now()}-${Math.random()}`, at: Date.now(), ...entry }, ...prev].slice(0, MAX_AUDIT));

  // Re-check-in a returning player (spec §1, §4). They're already a roster row —
  // keep their skill/W/L/photo, just start a fresh session: new checked-in time
  // and this visit's payment (the picker, unpaid by default). Optimistic, with a
  // rollback, and a check-in logged so the activity log reads the same as a
  // brand-new arrival. Busy players are skipped — you can't re-check-in someone
  // who's mid-match or already queued.
  const checkInExisting = (playerId, payment = newPlayerPayment) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    setNewPlayerName('');
    if (busyPlayerIds.has(playerId)) return; // already active this session
    setNewPlayerPayment('unpaid');
    const previous = { payment: player.payment, checkedInAt: player.checkedInAt, checkedOut: player.checkedOut };
    // checkedOut → false brings a checked-out player back onto the active roster.
    setPlayers(prev => prev.map(p =>
      p.id === playerId ? { ...p, payment, checkedInAt: Date.now(), checkedOut: false } : p));
    logEvent({
      type: 'checkin', playerName: player.name, payment,
      method: paymentInfo(payment).method, returning: true,
    });
    recheckInPlayer(playerId, payment).catch(err => {
      console.error('Failed to check in returning player:', err);
      setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, ...previous } : p));
    });
  };

  // Players live in Postgres now, so the id comes back from the insert rather
  // than from Date.now(). The camera prompt waits for that id.
  const addPlayer = async () => {
    const n = newPlayerName.trim();
    if (!n) return;
    // A name that already exists is a returning player, not a new one — re-check
    // them in instead of spawning a duplicate account (spec §1, §4).
    const existing = findExactPlayer(players, n);
    if (existing) { checkInExisting(existing.id); return; }
    const payment = newPlayerPayment;
    setNewPlayerName('');
    setNewPlayerPayment('unpaid'); // reset for the next check-in
    try {
      const player = await createPlayer(venueId, { name: n, skill: newPlayerSkill, payment });
      setPlayers(prev => [...prev, player]);
      logEvent({
        type: 'checkin', playerName: player.name, payment,
        method: paymentInfo(payment).method,
      });
      // Only prompt for a photo when a camera is actually present — otherwise
      // this would pop a dead modal staff have to dismiss on every check-in.
      if (await hasCamera()) setPendingPhotoPlayerId(player.id);
    } catch (err) {
      console.error('Failed to add player:', err);
      alert(alerts.addPlayerFailed(n));
      setNewPlayerName(n);
      setNewPlayerPayment(payment);
    }
  };

  // Change a player's payment status (spec §8) — optimistic, rolls back on error,
  // and records the change in the audit log.
  const setPlayerPayment = (id, payment) => {
    const player = players.find(p => p.id === id);
    if (!player || player.payment === payment) return;
    const previous = player.payment;
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, payment } : p));
    logEvent({
      type: 'payment', playerName: player.name, payment,
      method: paymentInfo(payment).method, from: previous,
    });
    updatePlayerPayment(id, payment).catch(err => {
      console.error('Failed to update payment:', err);
      setPlayers(prev => prev.map(p => p.id === id ? { ...p, payment: previous } : p));
    });
  };

  const removePlayer = async (id) => {
    if (busyPlayerIds.has(id)) return;
    const previous = players;
    setPlayers(prev => prev.filter(p => p.id !== id));
    try {
      await deletePlayer(id);
    } catch (err) {
      console.error('Failed to remove player:', err);
      setPlayers(previous); // put them back rather than silently diverging from the DB
    }
  };

  // Groups are built in the queue itself: a roster player joins the first group
  // with a free slot, and only starts a new one when every group is full. Click
  // does the same thing as a drag so the roster still works on a tablet, where
  // dragging across panels is fiddly.
  const addPlayerToQueue = (playerId) => {
    if (busyPlayerIds.has(playerId)) return;
    setQueue(prev => {
      const target = prev.find(g => g.players.length < 4);
      return target
        ? prev.map(g => g.id === target.id ? { ...g, players: [...g.players, playerId] } : g)
        : [...prev, newQueueGroup([playerId])];
    });
  };

  // Dropping on the "start a new group" strip: the player leaves whatever group
  // they were in and opens a fresh one at the back of the line. Lets staff hold
  // a group open for people who haven't arrived yet.
  const startQueueGroup = (playerId) => {
    setQueue(prev => [
      ...prev
        .map(g => g.players.includes(playerId) ? { ...g, players: g.players.filter(x => x !== playerId) } : g)
        .filter(g => g.players.length > 0),
      newQueueGroup([playerId]),
    ]);
  };

  /* ── Auto ─ build every group the bench can make ─────────────────────
     One explicit staff click, and it only ever touches the QUEUE. It completes
     the partial groups staff started, then keeps building fours until fewer than
     four players are left on the bench. No court is filled, nobody starts
     playing, and no reveal animation runs ─ that all belongs to Assign to court.

     Every matching decision lives in the pure engine; this is the plumbing that
     hands it the world, applies the queue it hands back, and reports what
     happened without blocking anyone with a dialog. */
  const autoGroup = () => {
    const now = Date.now();
    const result = generateAutoQueueGroups({ players, courts, queue, history, matchingStyle, now });
    setQueue(result.queue);
    // Kept alongside earlier runs so a group built two presses ago still explains
    // itself; groups that have since left the queue are pruned on render.
    setMatcherRuns(prev => ({ ...prev, ...result.decisions }));
    /* One staff-only audit line per press. Records the shape of the run — how
       many were on the bench, what was built, and which rule each group had to
       bend — without naming an opponent or a Value. */
    logEvent({
      type: 'autoGroup',
      availableBefore: result.startedWith,
      availableAfter: result.remaining,
      createdCount: result.created.length,
      toppedUpCount: result.toppedUp.length,
      levels: result.created.map(id => result.decisions[id]?.constraintLevel ?? 'strict'),
      fallbackReasons: Object.values(result.decisions)
        .map(d => d.fallbackReason)
        .filter(Boolean),
    });
    setAutoStatus({
      at: now,
      text: result.reason === 'noFullGroupPossible'
        ? queueCopy.autoNothingCreated(result.remaining)
        : queueCopy.autoCreated(result.created.length, result.toppedUp.length, result.remaining),
    });
  };

  /* Assign to court ─ the ONLY path from Queued to Playing.
     The group goes on exactly as staff are looking at it: same four players, same
     teams. Re-running the matcher here would hand them a different match from the
     one they clicked. */
  const assignToCourt = (groupId, courtId, durationMin) => {
    const now = Date.now();
    const next = assignQueuedGroupToCourt({ groupId, courtId, courts, queue, now, durationMin });
    setShowAssign(null);
    if (!next) return;
    setCourts(next.courts);
    setQueue(next.queue);
    startReveal(next.assigned.playerIds, courts.find(c => c.id === courtId));
  };

  const assignRental = (courtId, hostId, durationMin) => {
    const now = Date.now();
    setCourts(prev => prev.map(c => c.id === courtId ? {
      ...c,
      match: {
        players: [hostId],
        host: hostId,
        startedAt: now,
        endsAt: matchEndsAt(now, durationMin, { now }),
        durationMin,
      },
    } : c));
    setShowRental(null);
  };

  // ── Checkout (spec §3) ────────────────────────────────────────────────────
  // Checkout is a ROSTER action, not a court one. Clearing a court just sends its
  // players back to the roster to play again; a player only checks out when
  // they're leaving for the day. completeCheckout records the session length and
  // payment, then drops them from the active roster (their profile is kept in the
  // DB so the check-in autocomplete can bring them back next visit).
  const completeCheckout = () => {
    const p = playerById(checkoutPlayerId);
    if (!p) { setCheckoutPlayerId(null); return; }
    const now = Date.now();
    // Normalised rather than subtracted raw: a check-in time that came back from
    // an older row in epoch SECONDS used to turn a five-minute visit into a
    // fifty-year one. An untrustworthy pair records no duration at all.
    const session = durationBetween(p.checkedInAt, now, { now });
    logEvent({
      type: 'checkout', playerName: p.name,
      checkedInAt: p.checkedInAt, checkoutAt: now,
      sessionMs: session.ok ? session.ms : null,
      sessionUnavailableReason: session.ok ? null : session.reason,
      payment: p.payment,
    });
    setPlayers(prev => prev.map(pl => pl.id === p.id ? { ...pl, checkedOut: true } : pl));
    setCheckoutPlayerId(null);
    checkOutPlayer(p.id).catch(err => {
      console.error('Failed to check out player:', err);
      setPlayers(prev => prev.map(pl => pl.id === p.id ? { ...pl, checkedOut: false } : pl));
    });
  };

  /* After a match, players dissolve to the BACK of Available (spec §8). They are
     not re-queued and they get no priority for the next group: the whole point
     is that the same four cannot cycle onto a court all evening. Nothing else
     happens until staff click Auto again — there is no RE-QUEUED state any more.
     Where they land in Available is derived from the history entry we just wrote,
     so this function has no work left to do beyond documenting that. */

  // Pull a single player out of the queue and back to the roster — staff need to
  // peel one person off a group (e.g. to check them out) without deleting the
  // whole group. Removing them clears their busy flag, so they reappear in the
  // roster automatically. A group emptied by the removal is dropped.
  //
  // Replacement (spec §4) is a CHOICE, not something that happens to staff. The
  // closest-value stand-in is offered first because that is what keeps the group
  // as tight as the matcher made it — but always taking it can quietly stack one
  // strong group all evening, so the same prompt offers a random draw, a free
  // pick from everyone available, and leaving the spot open. With nobody free
  // there is nothing to choose between, so the removal just happens.
  const removePlayerFromQueue = (playerId) => {
    const group = queue.find(g => g.players.includes(playerId));
    const anyFree = players.some(p => !p.checkedOut && !busyPlayerIds.has(p.id));
    if (group && anyFree) {
      setReplacing({ playerId, groupId: group.id });
      return;
    }
    applyQueueReplacement(playerId, null);
  };

  // The single writer for "player X leaves their group". A replacementId takes
  // their exact slot so the on-court teams don't shuffle; null drops them and
  // lets the group go short.
  const applyQueueReplacement = (playerId, replacementId) => {
    setQueue(prev => prev
      .map(g => {
        if (!g.players.includes(playerId)) return g;
        return replacementId
          ? { ...g, players: g.players.map(id => id === playerId ? replacementId : id) }
          : { ...g, players: g.players.filter(id => id !== playerId) };
      })
      .filter(g => g.players.length > 0));
    setReplacing(null);
  };

  const clearCourtCasual = (courtId) => {
    const court = courts.find(c => c.id === courtId);
    if (!court?.match) return;
    const now = Date.now();
    const entry = {
      id: now,
      courtId,
      players: court.match.players,
      type: court.type === 'rental' ? 'rental' : 'casual',
      duration: now - court.match.startedAt,
      finishedAt: now,
    };
    setHistory(prev => [entry, ...prev]);
    // Players return to the roster — no checkout here.
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, match: null } : c));
    recordMatchHistory(venueId, { ...entry, courtName: court.name });
  };

  const finishMatch = (courtId, winningPair) => {
    const court = courts.find(c => c.id === courtId);
    if (!court?.match) return;
    const [p1, p2, p3, p4] = court.match.players;
    const winners = winningPair === 1 ? [p1, p2] : [p3, p4];
    const losers  = winningPair === 1 ? [p3, p4] : [p1, p2];
    // Both counters move together: wins/losses are today's, total_* are forever
    // (spec §F3). Mirrors what record_match_result does server-side.
    setPlayers(prev => prev.map(p => {
      if (winners.includes(p.id)) return {
        ...p, wins: p.wins + 1,
        totalWins: (p.totalWins ?? 0) + 1, totalGames: (p.totalGames ?? 0) + 1,
      };
      if (losers.includes(p.id)) return {
        ...p, losses: p.losses + 1,
        totalLosses: (p.totalLosses ?? 0) + 1, totalGames: (p.totalGames ?? 0) + 1,
      };
      return p;
    }));
    const now = Date.now();
    const entry = {
      id: now, courtId,
      players: court.match.players,
      winners, losers,
      duration: now - court.match.startedAt,
      finishedAt: now,
    };
    setHistory(prev => [entry, ...prev]);
    // Names are resolved and stored on the entry rather than looked up when the
    // log renders: a player can be removed later, and the log is a record of what
    // happened, not a live view of the roster.
    const nameList = (ids) => ids.map(id => playerById(id)?.name).filter(Boolean).join(' & ');
    logEvent({
      type: 'result',
      playerName: nameList(winners) || '(unknown)',
      loserNames: nameList(losers) || '(unknown)',
      courtName: court.name,
      durationMs: entry.duration,
    });
    // Winners and losers both go back to the roster — checkout is separate.
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, match: null } : c));
    setFinishingCourt(null);

    // Fire-and-forget: the UI has already moved on, and both of these are
    // recoverable (stats can be corrected, history is for later analysis).
    // Not silent on failure any more: the optimistic update above makes a broken
    // write invisible until staff reload and find every W/L back at zero. The
    // usual cause is record_match_result() missing because schema.sql hasn't
    // been re-run against this database.
    recordResult(winners, losers).catch(err => {
      console.error('Failed to save win/loss:', err);
      setStatsWriteFailed(true);
    });
    recordMatchHistory(venueId, { ...entry, courtName: court.name });
  };

  // Names come off the highest number already in use, not off the array length:
  // remove Court 2 from a floor of three and the next court added is Court 4, not
  // a second Court 3. Ids come from the collision-free counter (spec §10).
  const nextCourtName = (existing) => {
    const highest = existing.reduce((n, c) => {
      const m = /(\d+)\s*$/.exec(c.name ?? '');
      return m ? Math.max(n, Number(m[1])) : n;
    }, 0);
    return `Court ${Math.max(highest, existing.length) + 1}`;
  };

  const addCourt = () => {
    setCourts(prev => [
      ...prev,
      { id: nextUid('court'), name: nextCourtName(prev), type: 'open', match: null },
    ]);
  };

  // Used by the setup wizard (spec §F5) to dial the floor in with one control.
  // Growing appends; shrinking drops from the tail but never removes a court with
  // a live match on it — those are kept past the target rather than vanishing
  // mid-game, and staff can remove them normally once the match ends.
  const setCourtCount = (n) => {
    const target = Math.max(1, Math.min(12, Math.round(Number(n) || 1)));
    setCourts(prev => {
      if (prev.length === target) return prev;
      if (prev.length < target) {
        const grown = [...prev];
        while (grown.length < target) {
          grown.push({
            id: nextUid('court'),
            name: nextCourtName(grown),
            type: 'open',
            match: null,
          });
        }
        return grown;
      }
      return [...prev.slice(0, target), ...prev.slice(target).filter(c => c.match)];
    });
  };

  const toggleCourtType = (courtId) => {
    setCourts(prev => prev.map(c =>
      c.id === courtId ? { ...c, type: c.type === 'open' ? 'rental' : 'open' } : c
    ));
  };

  const renameCourt = (courtId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, name: trimmed } : c));
  };

  const removeCourt = (courtId) => {
    const court = courts.find(c => c.id === courtId);
    if (court?.match) return;
    setCourts(prev => prev.filter(c => c.id !== courtId));
  };

  const removeFromQueue = (groupId) => setQueue(prev => prev.filter(g => g.id !== groupId));

  // Add a player to a queue group — and pull them out of whatever group they were
  // in, so queue members are freely interchangeable: drag someone from group #1
  // into group #2 and they move rather than duplicate. Also handles the plain
  // roster→queue drop (the player isn't in any group, so nothing is removed).
  // A group emptied by the move is dropped from the queue.
  const movePlayerToQueueGroup = (groupId, playerId) => {
    setQueue(prev => {
      const target = prev.find(g => g.id === groupId);
      if (!target || target.players.includes(playerId) || target.players.length >= 4) return prev;
      return prev
        .map(g => {
          if (g.id === groupId) return { ...g, players: [...g.players, playerId] };
          if (g.players.includes(playerId)) return { ...g, players: g.players.filter(x => x !== playerId) };
          return g;
        })
        .filter(g => g.players.length > 0);
    });
  };

  // A drop landing on a specific person (rather than a group's empty space).
  // Lets staff rearrange even when groups are full:
  //   • dragged player is already queued → swap the two, wherever they sit (so two
  //     full groups can trade a player each);
  //   • dragged player is from the roster and the target group has room → just add;
  //   • target group is full → the dragged player takes that person's slot and the
  //     person they replaced goes back to the roster.
  const dropOnQueuePlayer = (draggedId, targetId) => {
    if (draggedId === targetId) return;
    setQueue(prev => {
      const targetGroup = prev.find(g => g.players.includes(targetId));
      if (!targetGroup) return prev;
      const draggedInQueue = prev.some(g => g.players.includes(draggedId));

      if (draggedInQueue) {
        // Exchange the two ids in place — handles same-group reorder and the
        // two-full-groups swap identically, and never changes any group's size.
        return prev.map(g => ({
          ...g,
          players: g.players.map(id =>
            id === draggedId ? targetId : id === targetId ? draggedId : id),
        }));
      }

      if (targetGroup.players.length < 4) {
        return prev
          .map(g => (g.id === targetGroup.id ? { ...g, players: [...g.players, draggedId] } : g));
      }

      // Full group + roster player → replace, target returns to the roster.
      return prev.map(g =>
        g.id === targetGroup.id
          ? { ...g, players: g.players.map(id => (id === targetId ? draggedId : id)) }
          : g);
    });
  };

  /* Reset (spec §11) puts the club back to the start of a session: every queue
     group gone (partials included), every court cleared, every W/L and therefore
     every hidden Value back to zero, and the whole history dropped — which is
     what returns all four repeat trackers (same-4, same-opponent, same-partner,
     previous result) to neutral, since they are derived from it rather than
     stored. Court names and the roster itself survive; this is not a wipe. */
  const resetSession = async () => {
    if (!confirm(confirms.resetSession)) return;
    const clearedCourts = courts.map(c => ({ ...c, match: null }));
    setCourts(clearedCourts);
    setQueue([]);
    setHistory([]);
    setAuditLog([]);
    setAnnouncement('');
    setShowAnnouncementBar(false);
    setCheckoutPlayerId(null);
    setPlayers(prev => prev.map(p => ({ ...p, wins: 0, losses: 0 })));
    setFinishingCourt(null);
    setShowAssign(null);
    setReplacing(null);
    // A reveal caught mid-flight leaves the layout in its "flying" mode, where
    // the panels stop clipping so the cards can travel — that is the stray
    // scrollbar on the roster after a reset. Landing it puts the frame back.
    endReveal();

    // One statement for the whole roster rather than a round-trip per player.
    resetAllStats(venueId).catch(err => console.error('Failed to reset stats:', err));

    // Push the cleared state immediately — the debounced write would be dropped
    // if staff closed the tab straight after resetting, resurrecting the session.
    syncRef.current?.push({
      courts: clearedCourts, queue: [], history: [], auditLog: [],
      competitiveMode, announcement: '', defaultOpenDuration,
      // Both are settings, not session data: a reset must not re-run the wizard
      // or silently flip the club back to the default matching style.
      matchingStyle, onboarded,
    });
    await syncRef.current?.flush();
  };

  const regenerateDisplayLink = async () => {
    if (!confirm(confirms.regenerateDisplayLink)) return;
    const { data, error } = await supabase.rpc('rotate_display_token');
    if (error) {
      alert(alerts.regenerateFailed);
      return;
    }
    setDisplayToken(data);
  };

  // The active roster is everyone currently checked in. Checked-out players stay
  // in `players` (so the check-in autocomplete can find them) but drop off here.
  const activePlayers = useMemo(() => players.filter(p => !p.checkedOut), [players]);

  const filteredPlayers = useMemo(() => {
    const q = search.toLowerCase().trim();
    return activePlayers
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => skillRank(b.skill) - skillRank(a.skill) || a.name.localeCompare(b.name));
  }, [activePlayers, search]);

  const leaderboard = useMemo(() =>
    [...players]
      .map(p => ({ ...p, total: p.wins + p.losses, rate: (p.wins + p.losses) ? p.wins / (p.wins + p.losses) : 0 }))
      .filter(p => p.total > 0)
      .sort((a, b) => b.wins - a.wins || b.rate - a.rate),
    [players]
  );

  // Who can take a vacated queue slot. The departing player is still in the
  // group when this runs, so busyPlayerIds already excludes them — nobody can be
  // offered as their own replacement.
  const replacementCandidates = useMemo(
    () => players.filter(p => !p.checkedOut && !busyPlayerIds.has(p.id)),
    [players, busyPlayerIds]
  );

  // Today's board (spec §6). Both inputs are session state that resetSession()
  // clears, so this empties itself on reset — and because it's derived, it is
  // already up to date the moment finishMatch() records a result.
  const sessionRanking = useMemo(
    () => sessionLeaderboard(players, history),
    [players, history]
  );

  // Stable identity so the Queue panel's dismiss timer isn't torn down and
  // rebuilt on every render of the app.
  const clearAutoStatus = useCallback(() => setAutoStatus(null), []);

  if (loadFailed) {
    return (
      <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 text-center">
        <div>
          <div className="font-display text-4xl text-lime-400 mb-3">{brand.name}</div>
          <p className="text-zinc-300 mb-1">{screens.sessionLoadFailed.title}</p>
          <p className="text-zinc-500 text-sm mb-6 max-w-xs">
            {screens.sessionLoadFailed.body}
          </p>
          <button
            onClick={() => setReloadNonce(n => n + 1)}
            className="bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold px-6 py-2.5 rounded-lg transition"
          >
            {buttons.tryAgain}
          </button>
        </div>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="font-display text-4xl text-lime-400 animate-pulse">{brand.name}</div>
      </div>
    );
  }

  return (
    /* The staff dashboard is a fixed-height app frame on desktop: the page itself
       never scrolls, and each panel scrolls internally instead. Below `lg` the
       lock is released and the document scrolls normally (three side-by-side
       columns can't fit a phone viewport). */
    /* The LayoutGroup wraps the WHOLE app, not just the dashboard: the reveal
       overlay portals out to document.body, and its cards have to share
       layoutIds with rows inside the court cards. A portal keeps its place in
       the React tree, so this context still reaches it. */
    <LayoutGroup id="match-flight">
    <div className="font-body min-h-screen lg:h-screen lg:overflow-hidden lg:flex lg:flex-col bg-zinc-950 text-zinc-100">
      {/* ── HEADER ─────────────────────────────── */}
      <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30 shrink-0">
        <div className="px-4 sm:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-lime-400 rounded-md flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-zinc-950" strokeWidth={3} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl text-lime-400 leading-none">{brand.name}</h1>
              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{venue.name}</p>
            </div>
          </div>

          {/* Toolbar — three logical groups (left toggle · centre session controls ·
              right actions) separated by subtle dividers (spec §4A). */}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {/* LEFT — view toggle */}
                <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
                  <button
                    onClick={() => setView('staff')}
                    className={`px-2.5 sm:px-3 py-1 rounded-md text-sm font-semibold flex items-center gap-2 transition ${
                      view === 'staff' ? 'bg-lime-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Settings className="w-4 h-4" /> {toolbar.viewStaff}
                  </button>
                  <button
                    onClick={() => setView('display')}
                    className={`px-2.5 sm:px-3 py-1 rounded-md text-sm font-semibold flex items-center gap-2 transition ${
                      view === 'display' ? 'bg-lime-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Monitor className="w-4 h-4" /> {toolbar.viewPreview}
                  </button>
                </div>

                {view === 'staff' && (
                  <>
                    <Divider />

                    {/* CENTRE — session controls: Auto, timer, mode */}
                    {/* No Auto ON/OFF switch any more (spec §2): nothing fills a
                        court by itself, so there is no continuous mode to turn
                        off. The one Auto button lives in the Queue panel. */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Default open-play session time */}
                      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1">
                        <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <select
                          value={defaultOpenDuration === null ? 'none' : String(defaultOpenDuration)}
                          onChange={e => setDefaultOpenDuration(e.target.value === 'none' ? null : Number(e.target.value))}
                          className="bg-transparent text-sm font-semibold text-zinc-300 focus:outline-none cursor-pointer"
                          title={toolbar.durationTitle}
                        >
                          <option value="none">{toolbar.durationNone}</option>
                          {[10, 15, 20, 30, 45, 60].map(m => (
                            <option key={m} value={String(m)}>{toolbar.durationMinutes(m)}</option>
                          ))}
                        </select>
                      </div>

                      {/* Matching style (spec §F1, §F2). Sits next to the timer
                          because it's the other thing that changes how a group
                          reaches the court. */}
                      <div
                        className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1"
                        title={matchingStyleInfo(matchingStyle).blurb}
                      >
                        {/* No shuffle icon beside the dropdown (spec §2) — the
                            only shuffle in the app is the Auto button itself. */}
                        <select
                          value={matchingStyle}
                          onChange={e => setMatchingStyle(e.target.value)}
                          className="bg-transparent text-sm font-semibold text-zinc-300 focus:outline-none cursor-pointer"
                        >
                          {MATCHING_STYLE_ORDER.map(s => (
                            <option key={s} value={s}>{matchingStyleInfo(s).label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Animations + sound. Sits with Auto and the timer
                          because it changes how assigning a court behaves. */}
                      <SettingsMenu prefs={prefs} onChange={updatePrefs} />

                      {/* Competitive mode */}
                      <button
                        onClick={() => setCompetitiveMode(v => !v)}
                        className={`px-2.5 py-1.5 rounded-lg border text-sm font-semibold flex items-center gap-2 transition ${
                          competitiveMode
                            ? 'bg-rose-500 text-zinc-950 border-rose-400 hover:bg-rose-400'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={competitiveMode ? toolbar.competitiveTitleOn : toolbar.competitiveTitleOff}
                      >
                        <Trophy className="w-4 h-4" />
                        {competitiveMode ? toolbar.competitive : toolbar.casual}
                      </button>

                      {competitiveMode && (
                        <button
                          onClick={() => setShowLeaderboard(true)}
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        >
                          <Crown className="w-4 h-4" /> Leaderboard
                        </button>
                      )}
                    </div>

                    <Divider />

                    {/* RIGHT — display link, announce, log, reset, sign out */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setShowDisplayLink(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title={toolbar.displayLinkTitle}
                      >
                        <Monitor className="w-4 h-4" /> {toolbar.displayLink}
                      </button>

                      <button
                        onClick={() => setShowAnnouncementBar(v => !v)}
                        className={`px-2.5 py-1.5 rounded-lg border text-sm font-semibold flex items-center gap-2 transition ${
                          announcement
                            ? 'bg-lime-400 text-zinc-950 border-lime-300 hover:bg-lime-300'
                            : showAnnouncementBar
                            ? 'bg-zinc-800 border-zinc-600 text-zinc-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={toolbar.announceTitle}
                      >
                        <Megaphone className="w-4 h-4" />
                        {announcement ? toolbar.announcement : toolbar.announce}
                      </button>

                      <button
                        onClick={() => setShowActivityLog(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title={toolbar.logTitle}
                      >
                        <ClipboardList className="w-4 h-4" /> {toolbar.log}
                      </button>

                      <button
                        onClick={() => setShowSessionRank(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title={toolbar.sessionRankTitle}
                      >
                        <Trophy className="w-4 h-4" /> {toolbar.sessionRank}
                      </button>

                      <Link
                        to="/leaderboard"
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title={toolbar.rankingsTitle}
                      >
                        <Medal className="w-4 h-4" /> {toolbar.rankings}
                      </Link>

                      <button
                        onClick={() => setShowWizard(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title={toolbar.guideMeTitle}
                      >
                        <HelpCircle className="w-4 h-4" /> {toolbar.guideMe}
                      </button>

                      <button
                        onClick={resetSession}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-rose-950 hover:text-rose-300 hover:border-rose-900 text-sm font-semibold flex items-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" /> {toolbar.reset}
                      </button>

                      <button
                        onClick={signOut}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-200 text-sm font-semibold flex items-center gap-2"
                        title={toolbar.signOutTitle}
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
          </div>
        </div>

        {/* ── ANNOUNCEMENT BAR (staff only) ─── */}
        {view === 'staff' && showAnnouncementBar && (
          <div className="border-t border-zinc-800 bg-zinc-900 px-4 sm:px-6 py-2">
            <div className="flex items-center gap-3">
              <Megaphone className="w-4 h-4 text-lime-400 shrink-0" />
              <input
                value={announcement}
                onChange={e => setAnnouncement(e.target.value)}
                placeholder={announcementBar.placeholder}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-lime-500"
                autoFocus
              />
              {announcement && (
                <button
                  onClick={() => setAnnouncement('')}
                  className="text-zinc-500 hover:text-rose-400 shrink-0"
                  title={announcementBar.clearTitle}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setShowAnnouncementBar(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 font-semibold px-3 py-1.5 rounded border border-zinc-700 hover:border-zinc-500 shrink-0"
              >
                {buttons.done}
              </button>
            </div>
            {announcement && (
              <p className="text-xs text-lime-500 mt-1.5 ml-7">{announcementBar.live}</p>
            )}
          </div>
        )}
      </header>

      {/* Stats are updated optimistically, so a rejected write leaves correct
          numbers on screen that vanish on the next reload. Say so rather than
          letting staff discover it after a full session of scorekeeping. */}
      {statsWriteFailed && (
        <div className="bg-rose-950 border-b border-rose-800 px-4 sm:px-6 py-2 flex items-center gap-3 shrink-0">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-rose-200 text-sm flex-1 min-w-0">
            <span className="font-bold">{statsWriteBanner.headline}</span>{' '}
            {statsWriteBanner.body}{' '}
            <code className="text-rose-300">{statsWriteBanner.fileName}</code>{' '}
            {statsWriteBanner.bodyAfter}
          </p>
          <button
            onClick={() => setStatsWriteFailed(false)}
            className="text-rose-400 hover:text-rose-200 text-xs font-semibold shrink-0"
          >
            {buttons.dismiss}
          </button>
        </div>
      )}

      {/* ── VIEWS ───────────────────────────────
          `min-h-0` is what lets this flex child shrink to the leftover height
          instead of growing to fit its content — without it the 100vh lock on
          the wrapper above silently does nothing. */}
      <main className="lg:flex-1 lg:min-h-0">
      {/* Only StaffView receives matcherRuns/showDiagnostics. DisplayView — which
          renders both the Preview tab and the public /d and /queue pages — is
          never handed them, so matcher reasoning cannot reach a player-facing
          screen even if the staff toggle is on. */}
      {view === 'staff' ? (
        <StaffView
          competitiveMode={competitiveMode}
          players={players}
          filteredPlayers={filteredPlayers}
          courts={courts}
          queue={queue}
          busyPlayerIds={busyPlayerIds}
          search={search}
          newPlayerName={newPlayerName}
          newPlayerSkill={newPlayerSkill}
          newPlayerPayment={newPlayerPayment}
          now={nowTick}
          setSearch={setSearch}
          setNewPlayerName={setNewPlayerName}
          setNewPlayerSkill={setNewPlayerSkill}
          setNewPlayerPayment={setNewPlayerPayment}
          addPlayer={addPlayer}
          checkInExisting={checkInExisting}
          onCheckoutPlayer={setCheckoutPlayerId}
          removePlayer={removePlayer}
          setPlayerPayment={setPlayerPayment}
          addPlayerToQueue={addPlayerToQueue}
          startQueueGroup={startQueueGroup}
          autoGroup={autoGroup}
          showValues={showValues}
          setShowValues={setShowValues}
          autoStatus={autoStatus}
          clearAutoStatus={clearAutoStatus}
          matcherRuns={matcherRuns}
          showDiagnostics={!!prefs.matcherDiagnostics}
          defaultOpenDuration={defaultOpenDuration}
          reveal={reveal}
          setShowAssign={setShowAssign}
          setShowRental={setShowRental}
          removeFromQueue={removeFromQueue}
          removePlayerFromQueue={removePlayerFromQueue}
          movePlayerToQueueGroup={movePlayerToQueueGroup}
          dropOnQueuePlayer={dropOnQueuePlayer}
          draggingPlayerId={draggingPlayerId}
          setDraggingPlayerId={setDraggingPlayerId}
          setFinishingCourt={setFinishingCourt}
          clearCourtCasual={clearCourtCasual}
          addCourt={addCourt}
          removeCourt={removeCourt}
          toggleCourtType={toggleCourtType}
          renameCourt={renameCourt}
          playerById={playerById}
        />
      ) : (
        <DisplayView
          competitiveMode={competitiveMode}
          courts={courts}
          queue={queue}
          history={history}
          announcement={announcement}
          playerById={playerById}
          defaultOpenDuration={defaultOpenDuration}
        />
      )}
      </main>

      {/* ── MODALS ─────────────────────────────── */}
      {showAssign !== null && (
        <AssignModal
          competitiveMode={competitiveMode}
          group={queue.find(g => g.id === showAssign)}
          courts={courts}
          playerById={playerById}
          defaultOpenDuration={defaultOpenDuration}
          onAssign={(courtId, durationMin) => assignToCourt(showAssign, courtId, durationMin)}
          onClose={() => setShowAssign(null)}
        />
      )}
      {finishingCourt !== null && (
        <FinishMatchModal
          court={courts.find(c => c.id === finishingCourt)}
          playerById={playerById}
          onFinish={(pair) => finishMatch(finishingCourt, pair)}
          onClose={() => setFinishingCourt(null)}
        />
      )}
      {showLeaderboard && (
        <LeaderboardModal
          leaderboard={leaderboard}
          history={history}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
      {checkoutPlayerId !== null && (
        <CheckoutModal
          player={playerById(checkoutPlayerId)}
          onSetPayment={setPlayerPayment}
          onComplete={completeCheckout}
          onClose={() => setCheckoutPlayerId(null)}
        />
      )}
      {showActivityLog && (
        <ActivityLogModal
          auditLog={auditLog}
          onClose={() => setShowActivityLog(false)}
        />
      )}
      {showSessionRank && (
        <SessionRankModal
          rows={sessionRanking}
          onClose={() => setShowSessionRank(false)}
        />
      )}
      {replacing && (
        <ReplaceQueuePlayerModal
          leaving={playerById(replacing.playerId)}
          groupIndex={queue.findIndex(g => g.id === replacing.groupId)}
          available={replacementCandidates}
          suggested={closestByValue(
            replacementCandidates,
            playerValue(playerById(replacing.playerId)),
            history,
          )}
          onReplace={(id) => applyQueueReplacement(replacing.playerId, id)}
          onLeaveOpen={() => applyQueueReplacement(replacing.playerId, null)}
          onClose={() => setReplacing(null)}
        />
      )}
      {showRental !== null && (
        <RentalModal
          court={courts.find(c => c.id === showRental)}
          players={players}
          busyPlayerIds={busyPlayerIds}
          onBook={(hostId, durationMin) => assignRental(showRental, hostId, durationMin)}
          onClose={() => setShowRental(null)}
        />
      )}
      {pendingPhotoPlayerId !== null && (
        <CameraModal
          playerName={players.find(p => p.id === pendingPhotoPlayerId)?.name ?? ''}
          onSave={async (photo) => {
            const playerId = pendingPhotoPlayerId;
            setPendingPhotoPlayerId(null);
            // Show it straight away from the local data URL, then swap in the
            // hosted URL once the upload lands — the display can only see the latter.
            setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, photo } : p));
            try {
              const url = await uploadPhoto(venueId, playerId, photo);
              await updatePlayerPhoto(playerId, url);
              setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, photo: url } : p));
            } catch (err) {
              console.error('Photo upload failed:', err);
              setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, photo: null } : p));
            }
          }}
          onClose={() => setPendingPhotoPlayerId(null)}
        />
      )}
      {showDisplayLink && (
        <DisplayLinkModal
          token={displayToken}
          slug={venue.slug}
          venueName={venue.name}
          onRegenerate={regenerateDisplayLink}
          onClose={() => setShowDisplayLink(false)}
        />
      )}
      {/* Rendered from the app ROOT and portalled to document.body, so no
          panel's width, stacking context or overflow box can confine it. */}
      {reveal && (
        <MatchRevealOverlay
          key={reveal.token}
          players={reveal.players}
          courtName={reveal.courtName}
          soundOn={prefs.sound}
          onSkip={endReveal}
        />
      )}
      {showWizard && (
        <OnboardingWizard
          courtCount={courts.length}
          setCourtCount={setCourtCount}
          matchingStyle={matchingStyle}
          setMatchingStyle={setMatchingStyle}
          players={activePlayers}
          newPlayerName={newPlayerName}
          setNewPlayerName={setNewPlayerName}
          newPlayerSkill={newPlayerSkill}
          setNewPlayerSkill={setNewPlayerSkill}
          addPlayer={addPlayer}
          // Dismissing counts as finishing — otherwise the wizard would reopen on
          // every reload for a venue that closed it deliberately.
          onFinish={() => { setOnboarded(true); setShowWizard(false); }}
          onClose={() => { setOnboarded(true); setShowWizard(false); }}
        />
      )}
    </div>
    </LayoutGroup>
  );
}

/* ─────────────────────────────────────────────
   DISPLAY LINK
   ───────────────────────────────────────────── */
function DisplayLinkModal({ token, slug, venueName, onRegenerate, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/d/${token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // clipboard is blocked outside HTTPS; the URL is on screen to type
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ModalShell onClose={onClose} title={modals.displayLink.title} wide>
      <p className="text-zinc-400 text-sm mb-4">{modals.displayLink.intro}</p>

      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 mb-3">
        <code className="text-lime-400 text-xs break-all leading-relaxed">{url}</code>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <button
          onClick={copy}
          className="flex-1 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition"
        >
          {copied
            ? <><Check className="w-4 h-4" /> {modals.displayLink.copied}</>
            : <><Copy className="w-4 h-4" /> {modals.displayLink.copy}</>}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition"
        >
          <ExternalLink className="w-4 h-4" /> {modals.displayLink.open}
        </a>
      </div>

      {/* The club board (spec §F4). Needs venues.slug, which is null until
          schema.sql has been re-run on an existing database — in which case say
          so, because silently rendering nothing reads as "the QR feature is
          missing" rather than "your database is out of date". */}
      <div className="border-t border-zinc-800 pt-4 mb-5">
        <h4 className="font-display text-lg mb-1">{modals.displayLink.clubHeading}</h4>
        {slug ? (
          <>
            <p className="text-zinc-400 text-sm mb-3">{modals.displayLink.clubIntro}</p>
            <ClubQrPoster venueName={venueName} slug={slug} />
          </>
        ) : (
          <div className="bg-amber-950 bg-opacity-40 border border-amber-800 rounded-lg p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-200 text-sm">
              <span className="font-bold">{modals.displayLink.noQrHeadline}</span>{' '}
              {modals.displayLink.noQrBody}{' '}
              <code className="text-amber-300">{modals.displayLink.noQrFileName}</code>.{' '}
              {modals.displayLink.noQrBodyAfter}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <button
          onClick={onRegenerate}
          className="text-zinc-500 hover:text-rose-400 text-xs font-semibold flex items-center gap-2 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> {modals.displayLink.regenerate}
        </button>
        <p className="text-zinc-600 text-xs mt-1.5">{modals.displayLink.regenerateNote}</p>
      </div>
    </ModalShell>
  );
}

// Module-level: set synchronously in onDragStart so dragover handlers can read it
// without waiting for a React state update (which would be deferred and stale).
let _dragId = null;

/* ─────────────────────────────────────────────
   PLAYER CHECK-IN FIELD (spec §1, §4, §6, §7)
   The "New player name…" box, now search-as-you-type. As staff type, returning
   players surface in a dropdown with their skill and W/L — one click re-checks
   them in (keeping their history, resetting payment). Typing a brand-new name and
   hitting Add/Enter creates an account; an exact match never makes a duplicate.
   ───────────────────────────────────────────── */
function PlayerCheckInField({
  newPlayerName, setNewPlayerName, newPlayerSkill, setNewPlayerSkill,
  players, busyPlayerIds, addPlayer, checkInExisting,
}) {
  const [focused, setFocused] = useState(false);
  // -1 = nothing highlighted; Enter then falls through to Add (create / exact match).
  const [highlight, setHighlight] = useState(-1);

  const matches = useMemo(() => matchRoster(players, newPlayerName), [players, newPlayerName]);
  const exact = useMemo(() => findExactPlayer(players, newPlayerName), [players, newPlayerName]);
  const open = focused && newPlayerName.trim().length > 0 && matches.length > 0;

  // A moving target list means a stale highlight would point at the wrong player.
  useEffect(() => { setHighlight(-1); }, [newPlayerName]);

  const pick = (p) => {
    if (busyPlayerIds.has(p.id)) return; // already active — nothing to re-check-in
    checkInExisting(p.id); // clears the name, which closes the dropdown
  };

  const onKeyDown = (e) => {
    if (open && e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, matches.length - 1));
    } else if (open && e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight >= 0) pick(matches[highlight]);
      else addPlayer(); // create, or re-check-in on an exact name match
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          value={newPlayerName}
          onChange={e => setNewPlayerName(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={checkIn.namePlaceholder}
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-lime-500"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <select
          value={newPlayerSkill}
          onChange={e => setNewPlayerSkill(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded-md px-2 text-sm focus:outline-none focus:border-lime-500"
        >
          {SKILL_TIERS.map(s => <option key={s}>{s}</option>)}
        </select>
        <button
          onClick={addPlayer}
          className="bg-lime-400 text-zinc-950 rounded-md px-3 hover:bg-lime-300"
          title={checkIn.addTitle}
        >
          <UserPlus className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-800 flex items-center gap-1.5">
            <Search className="w-3 h-3" /> {checkIn.returningHeading}
          </div>
          {matches.map((p, i) => {
            const busy = busyPlayerIds.has(p.id);
            const active = i === highlight;
            return (
              <button
                key={p.id}
                type="button"
                // Keep focus on the input so the blur-to-close doesn't beat the click.
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(p)}
                onMouseEnter={() => setHighlight(i)}
                disabled={busy}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition border-b border-zinc-800 last:border-0 ${
                  busy ? 'opacity-40 cursor-not-allowed' : active ? 'bg-zinc-800' : 'hover:bg-zinc-800'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{p.name}</span>
                  <span className="block text-xs text-zinc-500">{p.skill} • {p.wins}W {p.losses}L</span>
                </span>
                {busy ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 shrink-0">
                    {checkIn.alreadyActive}
                  </span>
                ) : (
                  <>
                    <PaymentBadge payment={p.payment} />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-lime-400 shrink-0">
                      {checkIn.checkInAction}
                    </span>
                  </>
                )}
              </button>
            );
          })}
          {!exact && (
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={addPlayer}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 border-t border-zinc-800 transition"
            >
              <UserPlus className="w-3.5 h-3.5 text-lime-400 shrink-0" />
              {checkIn.addNewPrefix} “<span className="font-semibold">{newPlayerName.trim()}</span>”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   CHECKED-OUT BOX (spec §4)
   Players who've left for the day are held here — not deleted — so staff can find
   them by name and bring them back with one click, W/L history and skill intact.
   ───────────────────────────────────────────── */
function CheckedOutBox({ players, onCheckIn }) {
  const [search, setSearch] = useState('');
  // Collapsed by default: this list is consulted occasionally, and left open it
  // was the single biggest reason the dashboard outgrew the viewport.
  const [open, setOpen] = useState(false);
  const q = search.trim().toLowerCase();
  const list = useMemo(
    () => players
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [players, q]
  );

  return (
    <div className="mt-2 shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-1.5 text-zinc-300 hover:text-zinc-100 transition"
      >
        <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="font-display text-sm tracking-wide">{checkedOutCopy.heading}</span>
        <span className="text-zinc-600 text-xs">({players.length})</span>
      </button>
      {open && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          {players.length === 0 ? (
            <p className="p-2.5 text-xs text-zinc-500 text-center">{checkedOutCopy.empty}</p>
          ) : (
            <>
              <div className="p-2 border-b border-zinc-800">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2 text-zinc-500" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={checkedOutCopy.searchPlaceholder}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-lime-500"
                  />
                </div>
              </div>
              <div className="max-h-[140px] overflow-y-auto">
                {list.length === 0 && (
                  <p className="p-2.5 text-xs text-zinc-500 text-center">{checkedOutCopy.noneMatch}</p>
                )}
                {list.map(p => (
                  <div
                    key={p.id}
                    className="px-3 py-1.5 flex items-center gap-2 border-b border-zinc-800 last:border-0"
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate text-zinc-300">{p.name}</div>
                      <div className="text-xs text-zinc-500">{p.skill} • {p.wins}W {p.losses}L</div>
                    </div>
                    <button
                      onClick={() => onCheckIn(p.id, 'unpaid')}
                      className="p-1.5 rounded-md bg-lime-400 text-zinc-950 hover:bg-lime-300 shrink-0"
                      title={checkedOutCopy.checkBackInTitle(p.name)}
                      aria-label={checkedOutCopy.checkBackInTitle(p.name)}
                    >
                      <LogIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   STAFF VIEW
   ───────────────────────────────────────────── */
function StaffView(props) {
  const {
    competitiveMode,
    players, filteredPlayers, courts, queue, busyPlayerIds,
    search, newPlayerName, newPlayerSkill, newPlayerPayment,
    now,
    setSearch, setNewPlayerName, setNewPlayerSkill, setNewPlayerPayment,
    addPlayer, checkInExisting, onCheckoutPlayer, removePlayer, setPlayerPayment, addPlayerToQueue, startQueueGroup, autoGroup,
    setShowAssign, setShowRental, removeFromQueue, removePlayerFromQueue, movePlayerToQueueGroup, dropOnQueuePlayer,
    draggingPlayerId, setDraggingPlayerId,
    setFinishingCourt, clearCourtCasual,
    addCourt, removeCourt, toggleCourtType, renameCourt, playerById,
    showValues, setShowValues, reveal,
    autoStatus, clearAutoStatus,
    matcherRuns, showDiagnostics,
    defaultOpenDuration,
  } = props;

  // Framer positions a travelling element inside its DESTINATION, so without
  // this the courts band would clip the cards until they had already arrived.
  const flying = !!reveal;
  const scrollClass = flying ? 'overflow-visible' : 'overflow-y-auto';

  const [dragOverZone, setDragOverZone] = useState(null);
  // The specific queued player a drag is hovering — the one who'll be swapped out.
  const [dragOverPlayerId, setDragOverPlayerId] = useState(null);
  // Brief "thinking" state so Auto-group feels deliberate rather than instant.
  const [autoBusy, setAutoBusy] = useState(false);
  const runAutoGroup = () => {
    if (autoBusy) return;
    setAutoBusy(true);
    setTimeout(() => { autoGroup(); setAutoBusy(false); }, 550);
  };

  // The result line reads once and gets out of the way. Keyed on the press time
  // so a second press restarts the countdown rather than inheriting the first.
  const statusAt = autoStatus?.at;
  useEffect(() => {
    if (!statusAt) return;
    const t = setTimeout(clearAutoStatus, 7000);
    return () => clearTimeout(t);
  }, [statusAt, clearAutoStatus]);

  /* How many complete groups sit in front of position `idx`. This is the queue
     position the estimate projects from — incomplete groups are skipped, because
     they cannot be assigned and so do not hold anyone up. */
  const readyGroupsBefore = (idx) =>
    queue.slice(0, idx).filter(g => g.players.length === 4).length;

  /* The duration the next assignment will use. Competitive matches are played to
     a score rather than a clock, so there is no length to project from and the
     estimator correctly declines to guess. */
  const matchMinutes = competitiveMode ? null : defaultOpenDuration;

  // Checked-out players stay in `players` for re-check-in but are not part of the
  // active roster: they're counted separately and shown in their own box below.
  const activeCount = players.filter(p => !p.checkedOut).length;
  const checkedOutPlayers = players.filter(p => p.checkedOut);

  return (
    /* Desktop: a fixed-height column — courts band on top, then the two working
       panels sharing the leftover height. Each panel scrolls internally so the
       page itself never grows past the viewport. */
    <div className={`p-3 sm:p-4 flex flex-col gap-3 lg:h-full ${flying ? '' : 'lg:overflow-hidden'}`}>
      {/* COURTS */}
      <section className="shrink-0 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-1.5 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl text-zinc-200 tracking-wide">COURTS</h2>
          </div>
          <button
            onClick={addCourt}
            className="text-sm font-semibold text-lime-400 hover:text-lime-300 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add court
          </button>
        </div>
        {/* auto-FIT (not auto-fill): empty tracks collapse, so however many
            courts exist they stretch to share the full row width — 2 courts →
            50% each, 4 → 25%, and beyond that they wrap. `min(230px,100%)`
            keeps a single narrow-screen card from overflowing its container.
            The band scrolls internally once courts wrap past one row. */}
        <div className={`${scrollClass} lg:max-h-[38vh] grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))]`}>
          {courts.map((court, i) => (
            <CourtCardStaff
              index={i}
              key={court.id}
              competitiveMode={competitiveMode}
              court={court}
              playerById={playerById}
              // While the overlay still holds these players' layoutIds, the
              // court must not render them too — duplicated ids break the morph.
              awaitingFlight={!!reveal && reveal.courtId === court.id && !reveal.handedOver}
              onFinish={() => setFinishingCourt(court.id)}
              onClear={() => clearCourtCasual(court.id)}
              onRemove={() => removeCourt(court.id)}
              onToggleType={() => toggleCourtType(court.id)}
              onRename={(name) => renameCourt(court.id, name)}
              onBookRental={() => setShowRental(court.id)}
            />
          ))}
        </div>
      </section>

      {/* ROSTER + QUEUE */}
      {/* `lg:grid-rows-1` is load-bearing: it pins the single row to
          `minmax(0, 1fr)` of the frame's leftover height. Left auto-sized, the
          row would grow to its tallest column's content and overflow the lock. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-1 gap-3 lg:flex-1 lg:min-h-0">
        {/* ROSTER */}
        <section className="lg:col-span-5 flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 mb-1.5 shrink-0">
            <h2 className="font-display text-xl text-zinc-200 tracking-wide">{rosterCopy.heading}</h2>
            {/* Staff-only peek at the hidden match values (spec §1). Off by
                default and never persisted, so players never see it over a
                shoulder unless staff deliberately turn it on. */}
            <button
              onClick={() => setShowValues(v => !v)}
              className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition flex items-center gap-1.5 ${
                showValues
                  ? 'bg-zinc-800 border-zinc-600 text-zinc-300'
                  : 'bg-transparent border-transparent text-zinc-700 hover:text-zinc-400'
              }`}
              title={rosterCopy.valuesToggleTitle}
              aria-pressed={showValues}
            >
              {showValues ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {rosterCopy.valuesToggle}
            </button>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="p-2.5 border-b border-zinc-800 space-y-2 shrink-0">
              <PlayerCheckInField
                newPlayerName={newPlayerName}
                setNewPlayerName={setNewPlayerName}
                newPlayerSkill={newPlayerSkill}
                setNewPlayerSkill={setNewPlayerSkill}
                players={players}
                busyPlayerIds={busyPlayerIds}
                addPlayer={addPlayer}
                checkInExisting={checkInExisting}
              />
              {/* Payment status at check-in (spec §1). Player is added regardless
                  of what's picked; unpaid is the default so it's never assumed. */}
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <div className="flex gap-1 flex-1">
                  {PAYMENT_ORDER.map(status => {
                    const info = PAYMENT_STATUSES[status];
                    const active = newPlayerPayment === status;
                    return (
                      <button
                        key={status}
                        onClick={() => setNewPlayerPayment(status)}
                        title={info.label}
                        className={`flex-1 text-[11px] font-bold py-1 rounded-md border transition flex items-center justify-center gap-1 ${
                          active ? info.badge : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <span aria-hidden>{info.icon}</span>
                        {info.short}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2 text-zinc-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={rosterCopy.searchPlaceholder}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-lime-500"
                />
              </div>
            </div>
            {/* The scroller sits on the list alone — putting it (or any new
                clipping ancestor) around the check-in field above would cut off
                its returning-player autocomplete dropdown. */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filteredPlayers.length === 0 && (
                <p className="p-3 text-xs text-zinc-500 text-center">{rosterCopy.noneMatch}</p>
              )}
              {filteredPlayers.map((p, i) => {
                const busy = busyPlayerIds.has(p.id);
                const canDrag = !busy;
                return (
                  <div
                    key={p.id}
                    draggable={canDrag}
                    onDragStart={e => {
                      _dragId = p.id; // synchronous — readable by dragover handlers immediately
                      e.dataTransfer.setData('text/plain', String(p.id));
                      e.dataTransfer.effectAllowed = 'move';
                      requestAnimationFrame(() => setDraggingPlayerId(p.id));
                    }}
                    onDragEnd={() => { _dragId = null; setDraggingPlayerId(null); setDragOverZone(null); setDragOverPlayerId(null); }}
                    style={{ '--cf-delay': `${Math.min(i, 12) * 40}ms` }}
                    className={`cf-slide-in px-3 py-2 flex items-center gap-2 border-b border-zinc-800 last:border-0 transition ${
                      busy ? 'opacity-40' : 'hover:bg-zinc-800'
                    } ${draggingPlayerId === p.id ? 'opacity-40' : ''} ${
                      canDrag ? 'cursor-grab' : 'cursor-default'
                    }`}
                    onClick={() => !busy && addPlayerToQueue(p.id)}
                    title={busy ? undefined : rosterCopy.addToQueueTitle(p.name)}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-zinc-500">
                        {p.skill} • {p.wins}W {p.losses}L
                      </div>
                    </div>
                    {showValues && (
                      <span
                        className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-400 shrink-0"
                        title={rosterCopy.valueChipTitle(p.wins, p.losses)}
                      >
                        {playerValue(p) > 0 ? '+' : ''}{playerValue(p)}
                      </span>
                    )}
                    {/* Payment badge doubles as the editor (spec §2, §8) */}
                    <PaymentEditor payment={p.payment} onChange={(status) => setPlayerPayment(p.id, status)} />
                    {busy && (
                      <span className="text-xs text-zinc-500 shrink-0">
                        {courts.some(c => c.match?.players.includes(p.id))
                          ? rosterCopy.statusPlaying
                          : rosterCopy.statusQueued}
                      </span>
                    )}
                    {!busy && (
                      <>
                        {/* Check out — the player is leaving for the day (spec §3).
                            Records their session + payment, then drops them from the
                            active roster (profile kept for a future re-check-in). */}
                        <button
                          onClick={e => { e.stopPropagation(); onCheckoutPlayer(p.id); }}
                          className="text-zinc-600 hover:text-lime-400 p-2 -m-1 shrink-0 transition-colors duration-150"
                          title={rosterCopy.checkOutTitle(p.name)}
                          aria-label={rosterCopy.checkOutTitle(p.name)}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                        {/* Remove — a mistaken entry; deletes the account entirely. */}
                        <button
                          onClick={e => { e.stopPropagation(); removePlayer(p.id); }}
                          className="text-zinc-600 hover:text-rose-400 p-2 -m-1 shrink-0 transition-colors duration-150"
                          title={rosterCopy.removeTitle(p.name)}
                          aria-label={rosterCopy.removeTitle(p.name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-1.5 text-[11px] text-zinc-500 border-t border-zinc-800 shrink-0">
              {rosterCopy.countLine(activeCount, activeCount - busyPlayerIds.size)}
            </div>
          </div>

          {/* CHECKED OUT — players who've left for the day, kept for one-click
              re-check-in (spec §4). Searchable, and re-checking-in returns them
              to the roster above with their W/L history intact. */}
          <CheckedOutBox players={checkedOutPlayers} onCheckIn={checkInExisting} />
        </section>

        {/* QUEUE — groups are built here directly: click or drag a roster name
            to fill the first open slot, drag between groups to rearrange, or
            drop on the strip at the bottom to start a fresh group. */}
        <section className="lg:col-span-7 flex flex-col min-h-0">
          <div className="flex items-start justify-between gap-3 mb-1.5 shrink-0">
            <div className="min-w-0">
              <h2 className="font-display text-xl text-zinc-200 tracking-wide">
                {queueCopy.heading} <span className="text-zinc-600 text-sm">({queue.length})</span>
              </h2>
              {/* Says what the button does, because "Auto" on its own has read as
                  "start the matches" to every member of staff who has used it. */}
              <p className="text-[11px] text-zinc-500 leading-snug">{queueCopy.autoHelp}</p>
            </div>
            <button
              onClick={runAutoGroup}
              disabled={autoBusy}
              className={`relative overflow-hidden shrink-0 bg-zinc-800 text-zinc-200 text-sm font-semibold py-1.5 px-3 rounded-lg hover:bg-zinc-700 flex items-center gap-2 transition-colors disabled:cursor-wait ${autoBusy ? 'cf-shimmer' : ''}`}
              title={queueCopy.autoTitle}
            >
              {autoBusy
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> {queueCopy.autoButtonBusy}</>
                : <><Shuffle className="w-4 h-4" /> {queueCopy.autoButton}</>}
            </button>
          </div>
          {/* What the last press actually did. Inline and self-clearing rather
              than a dialog: Auto is pressed over and over through a session. */}
          {autoStatus && (
            <div
              role="status"
              className="cf-fade-up shrink-0 mb-1.5 text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5"
            >
              {autoStatus.text}
            </div>
          )}
          <div className={`flex-1 min-h-0 ${scrollClass} space-y-2 pr-0.5`}>
            {queue.map((g, idx) => {
              const groupPlayers = g.players.map(playerById).filter(Boolean);
              const avgSkill = groupPlayers.length
                ? Math.round(groupPlayers.reduce((s, p) => s + skillRank(p.skill), 0) / groupPlayers.length)
                : 0;
              const hasFreeCourt = courts.some(c => c.type === 'open' && !c.match);
              const isImmediateNext = idx === 0 && hasFreeCourt && groupPlayers.length >= 4;
              const unpaidCount = groupPlayers.filter(p => !isPaid(p.payment)).length;
              /* Roughly when this group gets called. Only complete groups get one
                 — a group still being built has no place in the running order to
                 project from. The estimator returns nothing rather than guessing
                 when the floor cannot support an answer. */
              const estimate = groupPlayers.length === 4
                ? callEstimate({
                    attendance: 'queued',
                    groupsAhead: readyGroupsBefore(idx),
                    courts,
                    durationMin: matchMinutes,
                    now,
                  })
                : null;
              /* Staff-only: which matching rules this group had to bend. Says the
                 rule that gave and how many pairs it affected — never a hidden
                 Value, never who played whom. */
              const decision = showDiagnostics ? matcherRuns?.[g.id] : null;
              const diagText = !decision ? null
                : decision.constraintLevel === 'opponent-cooldown-relaxed'
                ? diagCopy['opponent-cooldown-relaxed'](decision.cooldownConflictPairs.length)
                : diagCopy[decision.constraintLevel];
              // Teams only exist once a group is complete; the snake draft put
              // slots [0,1] on one side and [2,3] on the other.
              const showTeams = groupPlayers.length === 4;

              const canDrop = !!_dragId && groupPlayers.length < 4 && !g.players.includes(_dragId);
              return (
                <div
                  key={g.id}
                  style={{ animationDelay: `${Math.min(idx, 8) * 60}ms` }}
                  className={`cf-fade-up bg-zinc-900 rounded-xl border p-2.5 transition ${
                    dragOverZone === g.id
                      ? 'border-lime-500 ring-1 ring-lime-600 bg-lime-950/10'
                      : canDrop ? 'border-lime-800'
                      : 'border-zinc-800'
                  }`}
                  onDragOver={e => { if (!_dragId || !canDrop) return; e.preventDefault(); setDragOverZone(g.id); setDragOverPlayerId(null); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverZone(null); }}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOverZone(null);
                    setDragOverPlayerId(null);
                    const id = _dragId || Number(e.dataTransfer.getData('text/plain'));
                    if (id && groupPlayers.length < 4 && !g.players.includes(id))
                      movePlayerToQueueGroup(g.id, id);
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-xl text-lime-400">#{idx + 1}</span>
                      <span className="text-xs uppercase tracking-wider text-zinc-500">
                        {g.type === 'auto' ? queueCopy.typeAuto : queueCopy.typeManual}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${skillStyleSolid(SKILL_TIERS[avgSkill])} bg-opacity-20 text-zinc-300`}>
                        avg {SKILL_TIERS[avgSkill]}
                      </span>
                      {/* Payment summary for the whole group — staff need to know
                          before a group goes on, not once it is already playing. */}
                      {unpaidCount > 0 ? (
                        <span className="text-xs font-bold text-rose-300 bg-rose-950 border border-rose-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {queueCopy.unpaid(unpaidCount)}
                        </span>
                      ) : groupPlayers.length > 0 && (
                        <span className="text-xs text-emerald-400 bg-emerald-950 border border-emerald-900 px-2 py-0.5 rounded-full">
                          {queueCopy.allPaid}
                        </span>
                      )}
                      {isImmediateNext && (
                        <span className="text-xs font-bold text-lime-400 bg-lime-950 border border-lime-800 px-2 py-0.5 rounded-full">
                          Now
                        </span>
                      )}
                      {/* How long this group has actually been waiting, measured
                          from its own createdAt — elapsed, never an estimate. */}
                      <span className="text-xs text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmtWaiting(now, g.createdAt)}
                      </span>
                      {/* Waited, then likely to be called. Two different facts. */}
                      {estimate?.text && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          estimate.status === 'ready'
                            ? 'text-lime-300 bg-lime-950 border-lime-800'
                            : 'text-zinc-400 bg-zinc-950 border-zinc-800'
                        }`}>
                          {estimate.text}
                        </span>
                      )}
                      {diagText && (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${
                            decision.constraintLevel === 'strict'
                              ? 'text-zinc-400 bg-zinc-950 border-zinc-700'
                              : 'text-amber-300 bg-amber-950 border-amber-900'
                          }`}
                          title={decision.fallbackReason ?? diagCopy.staffOnly}
                        >
                          {diagText}
                        </span>
                      )}
                    </div>
                    <button onClick={() => removeFromQueue(g.id)} className="text-zinc-600 hover:text-rose-400 transition-colors duration-150">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-0.5 mb-2">
                    {groupPlayers.map((p, slot) => {
                      const canSwapHere = !!_dragId && _dragId !== p.id;
                      return (
                      <React.Fragment key={p.id}>
                      {showTeams && slot % 2 === 0 && (
                        <div className="text-[10px] font-bold tracking-widest text-zinc-600 pt-0.5">
                          {queueCopy.team(slot / 2 + 1)}
                        </div>
                      )}
                      <div
                        draggable
                        onDragStart={e => {
                          _dragId = p.id; // synchronous — readable by dragover handlers immediately
                          e.dataTransfer.setData('text/plain', String(p.id));
                          e.dataTransfer.effectAllowed = 'move';
                          requestAnimationFrame(() => setDraggingPlayerId(p.id));
                        }}
                        onDragEnd={() => { _dragId = null; setDraggingPlayerId(null); setDragOverZone(null); setDragOverPlayerId(null); }}
                        // Dropping ON a person targets them specifically — a swap
                        // (or a replace if this group is full). stopPropagation keeps
                        // the group's own "add to empty slot" drop from also firing.
                        onDragOver={e => {
                          if (!canSwapHere) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverZone(null);
                          setDragOverPlayerId(p.id);
                        }}
                        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverPlayerId(null); }}
                        onDrop={e => {
                          if (!canSwapHere) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverPlayerId(null);
                          setDragOverZone(null);
                          const id = _dragId || Number(e.dataTransfer.getData('text/plain'));
                          if (id && id !== p.id) dropOnQueuePlayer(id, p.id);
                        }}
                        className={`flex items-center gap-2 text-sm rounded px-1 -mx-1 cursor-grab transition ${
                          dragOverPlayerId === p.id
                            ? 'bg-lime-950 ring-1 ring-lime-600'
                            : 'hover:bg-zinc-800/60'
                        } ${draggingPlayerId === p.id ? 'opacity-40' : ''}`}
                        title="Drag to another group — or onto a player to swap"
                      >
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                        <span className="flex-1 truncate">{p.name}</span>
                        <PaymentBadge payment={p.payment} dot title={`${p.name} — ${paymentInfo(p.payment).label}`} />
                        {/* Pull this one player back to the roster without touching
                            the rest of the group — e.g. to check them out. */}
                        <button
                          onClick={e => { e.stopPropagation(); removePlayerFromQueue(p.id); }}
                          className="text-zinc-600 hover:text-rose-400 shrink-0 p-1 -m-1 transition-colors duration-150"
                          title={`Remove ${p.name} from queue`}
                          aria-label={`Remove ${p.name} from queue`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      </React.Fragment>
                      );
                    })}
                    {groupPlayers.length < 4 && (
                      <div className={`text-xs italic ${canDrop ? 'text-lime-400' : 'text-amber-500'}`}>
                        {canDrop
                          ? queueCopy.dropHere(4 - groupPlayers.length)
                          : queueCopy.incomplete(4 - groupPlayers.length)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAssign(g.id)}
                    disabled={groupPlayers.length < 4}
                    className="w-full bg-zinc-800 hover:bg-lime-400 hover:text-zinc-950 text-sm font-semibold py-1.5 rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-current"
                  >
                    {queueCopy.assign} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}

            {/* Start a new group. Groups otherwise fill front-to-back, so this is
                how staff deliberately open a fresh one — e.g. to hold slots for
                players still walking in. Doubles as the queue's empty state, so
                there is always somewhere to drop. */}
            <div
              onDragOver={e => { if (!_dragId) return; e.preventDefault(); setDragOverZone('newgroup'); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverZone(null); }}
              onDrop={e => {
                e.preventDefault();
                setDragOverZone(null);
                const id = _dragId || Number(e.dataTransfer.getData('text/plain'));
                if (id) startQueueGroup(id);
              }}
              className={`flex flex-col items-center gap-1.5 px-3 py-4 border border-dashed rounded-xl text-center transition ${
                dragOverZone === 'newgroup'
                  ? 'border-lime-500 bg-lime-950/30 ring-1 ring-lime-600'
                  : draggingPlayerId ? 'border-lime-700 text-lime-400'
                  : 'border-zinc-800'
              }`}
            >
              {draggingPlayerId ? (
                <span className="text-sm font-semibold text-lime-400">Drop to start a new group</span>
              ) : queue.length === 0 ? (
                <>
                  <Users className="cf-breathe w-6 h-6 text-zinc-600" />
                  <span className="cf-breathe text-sm text-zinc-500 italic">Waiting for groups…</span>
                  <span className="text-xs text-zinc-600">Click a roster name to add them</span>
                </>
              ) : (
                <span className="text-xs text-zinc-600">Drag a player here to start a new group</span>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* PlayerAvatar now lives in ./components/PlayerAvatar.jsx so the flight items
   can render a player without importing App.jsx. */

/* ─────────────────────────────────────────────
   COURT CARD (STAFF) — double-click name to rename
   ───────────────────────────────────────────── */
function CourtCardStaff({ index = 0, competitiveMode, court, playerById, onFinish, onClear, onRemove, onToggleType, onRename, onBookRental, awaitingFlight = false }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(court.name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    onRename(editName || court.name);
    setEditing(false);
  };

  const isPlaying = !!court.match;
  const isRental  = court.type === 'rental';
  const now = Date.now();
  const elapsed    = isPlaying ? now - court.match.startedAt : 0;
  const hasTimer   = isPlaying && court.match.endsAt;
  const remaining  = hasTimer ? court.match.endsAt - now : 0;
  const timeUp     = hasTimer && remaining <= 0;
  const showTimeUp = timeUp && !isRental && competitiveMode;

  // Empty courts get a dashed "placeholder" border + a hover lift; the waiting
  // pulse is carried by the breathing icon/text in the body (§2). Keeping the
  // pulse off the card itself leaves the entrance fade-up free to run — an
  // element can only host one CSS `animation` at a time.
  const borderClass = showTimeUp
    ? 'bg-rose-950 border-rose-600'
    : isPlaying && isRental ? 'bg-amber-950 border-amber-600'
    : isPlaying ? 'bg-lime-950 border-lime-700'
    : isRental ? 'bg-zinc-900 border-amber-800 border-dashed cf-lift'
    : 'bg-zinc-900 border-zinc-800 border-dashed cf-lift';

  return (
    <div
      // The match reveal measures this at flight time to know where to land.
      data-court-id={court.id}
      className={`cf-fade-up rounded-xl border p-3 transition ${borderClass}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditName(court.name); setEditing(false); }
              }}
              className="font-display text-xl bg-transparent border-b-2 border-lime-400 outline-none w-28 text-zinc-100"
            />
          ) : (
            <h3
              className="font-display text-xl cursor-pointer hover:text-lime-400 transition"
              onDoubleClick={() => { setEditName(court.name); setEditing(true); }}
              title="Double-click to rename"
            >
              {court.name}
            </h3>
          )}
          {isRental && (
            <span className="text-[10px] font-bold tracking-widest bg-amber-500 text-zinc-950 px-1.5 py-0.5 rounded">
              RENTAL
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showTimeUp ? (
            <span className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
              <span className="w-2 h-2 bg-rose-400 rounded-full animate-pulse" /> TIME UP
            </span>
          ) : isPlaying ? (
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${isRental ? 'text-amber-300' : 'text-lime-400'}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${isRental ? 'bg-amber-400' : 'bg-lime-400'}`} />
              {isRental ? 'IN USE' : 'LIVE'}
              <Clock className="w-3 h-3 ml-1" />
              {hasTimer ? fmtElapsed(remaining) : fmtElapsed(elapsed)}
              {hasTimer && <span className="opacity-60 ml-1">left</span>}
            </span>
          ) : (
            <span className="text-xs text-zinc-500">{isRental ? 'AVAILABLE' : 'EMPTY'}</span>
          )}
        </div>
      </div>

      {/* Type toggle + remove — label is abbreviated to keep the card short; the
          full wording lives in the tooltip. */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onToggleType}
          title={isRental ? 'Switch to open play' : 'Switch to rental'}
          className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border transition flex-1 ${
            isRental
              ? 'bg-amber-950 border-amber-700 text-amber-300 hover:bg-amber-900'
              : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {isRental ? '◀ OPEN PLAY' : 'RENTAL ▶'}
        </button>
        {!isPlaying && (
          <button
            onClick={onRemove}
            className="text-zinc-600 hover:text-rose-400 p-2 -m-1 shrink-0 transition-colors duration-150"
            title="Remove court"
            aria-label={`Remove ${court.name}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {isPlaying ? (
        <>
          {isRental ? (
            /* Rental — host party display */
            (() => {
              const host = playerById(court.match.players[0]);
              return host ? (
                <div className="flex flex-col items-center py-3 gap-2 mb-3">
                  <PlayerAvatar player={host} size="lg" />
                  <div className="font-display text-xl text-center">{host.name}'s Party</div>
                </div>
              ) : null;
            })()
          ) : (
            /* Open play — 4-player grid.
               While a flight is inbound this list stays EMPTY: the ghost group
               down in the queue is holding these players' layoutIds, and having
               both mounted at once would duplicate every id. The moment the
               ghost drops them (phase 3) these mount and Framer flies them up.
               The row keeps its height reserved so the card doesn't jump. */
            <div className="grid grid-cols-1 gap-1 mb-2" style={awaitingFlight ? { minHeight: 4 * 34 } : undefined}>
              {!awaitingFlight && court.match.players.map((id, i) => {
                const p = playerById(id);
                if (!p) return null;
                const teamLabel = i < 2 ? 'T1' : 'T2';
                return (
                  <div key={id} className="flex items-center gap-2 bg-zinc-950 bg-opacity-50 rounded px-2 py-1">
                    <span className="text-xs text-zinc-500 font-mono w-6">{teamLabel}</span>
                    {/* Identical subtree to the queue side — see matchFlight.jsx */}
                    <FlightPlayerItem player={p} />
                    <PaymentBadge payment={p.payment} dot title={`${p.name} — ${paymentInfo(p.payment).label}`} />
                    <span className="text-[10px] text-zinc-500">{p.skill}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(competitiveMode && !isRental) ? (
            <button
              onClick={onFinish}
              className="w-full bg-zinc-950 hover:bg-zinc-100 hover:text-zinc-950 border border-zinc-700 text-sm font-bold py-1.5 rounded-lg transition"
            >
              FINISH MATCH
            </button>
          ) : (
            <button
              onClick={onClear}
              className="w-full bg-zinc-950 hover:bg-zinc-100 hover:text-zinc-950 border border-zinc-700 text-sm font-bold py-1.5 rounded-lg transition"
            >
              {isRental ? 'END RENTAL' : 'CLEAR COURT'}
            </button>
          )}
        </>
      ) : isRental ? (
        <button
          onClick={onBookRental}
          className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm py-2 rounded-lg flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Book Rental
        </button>
      ) : (
        <div className="cf-breathe text-center py-3 text-zinc-400 text-sm italic flex flex-col items-center gap-1">
          <Users className="w-5 h-5 text-zinc-600" />
          Assign a group from queue
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   DISPLAY VIEW (customer-facing)
   ───────────────────────────────────────────── */
// Exported so the public /d/:token route can render it with data from the RPC.
/* The public board: the TV at /d/:token, the poster-linked club page at
   /queue/:slug, and the staff Preview tab. Everything rendered here is visible to
   anyone standing in the building, so it deliberately shows no payment status, no
   win/loss counters (the hidden Value is derived from them), and none of the
   staff-only reasoning. It is never handed matcherRuns or showDiagnostics. */
export function DisplayView({ competitiveMode, courts, queue, history, announcement, playerById, defaultOpenDuration = null }) {
  const now = new Date();
  const nowMs = now.getTime();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const activeCourts  = courts.filter(c => c.match).length;
  const playersOnCourt = courts.reduce((n, c) => n + (c.match ? c.match.players.length : 0), 0);
  const gamesServed   = history.length;
  const openCourts    = courts.filter(c => c.type === 'open' && !c.match).length;
  // Front-desk call-to-action: only worth shouting about when a court is free
  // AND nobody is already waiting for it (spec §6).
  const showCta       = openCourts > 0 && queue.length === 0;

  return (
    /* `lg:h-full` + its own scroller so the preview still works inside the
       staff shell's fixed-height frame; standalone (the public /d/:token page)
       it just falls back to natural document height. */
    <div className="min-h-screen lg:h-full lg:min-h-0 lg:overflow-y-auto">
      {/* ── ANNOUNCEMENT BANNER ── */}
      {announcement && (
        <div className="bg-lime-400 text-zinc-950 px-8 py-4 flex items-center gap-4">
          <Megaphone className="w-7 h-7 shrink-0" />
          <p className="font-bold text-2xl leading-snug">{announcement}</p>
        </div>
      )}

      {/* ── COURTS-AVAILABLE CALL TO ACTION (spec §6) ── */}
      {showCta && (
        <div className="bg-lime-400 text-zinc-950 px-8 py-3 flex items-center justify-center gap-3 text-center">
          <Check className="w-7 h-7 shrink-0" strokeWidth={3} />
          <p className="font-display text-3xl sm:text-4xl">
            {openCourts} COURT{openCourts > 1 ? 'S' : ''} AVAILABLE — CHECK IN AT THE DESK!
          </p>
        </div>
      )}

      {/* Sized for a TV, but players do open this link on their phones to check
          the queue, so the padding gives way on small screens. */}
      <div className="p-4 sm:p-8 max-w-[1600px] mx-auto">
        {/* ── SESSION HEADER ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="font-display text-5xl text-lime-400 leading-none mb-1">COURTFLOW</div>
            <div className="flex items-center gap-4 text-base text-zinc-400">
              <span>
                <span className="text-zinc-200 font-semibold">{activeCourts}</span> courts active
              </span>
              <span>·</span>
              <span>
                <span className="text-zinc-200 font-semibold">{playersOnCourt}</span> players on court
              </span>
              {gamesServed > 0 && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span className="text-zinc-200 font-semibold">{gamesServed}</span> games today
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="font-display text-5xl text-zinc-500">{timeStr}</div>
        </div>

        {/* ── COURTS ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {courts.map(court => {
            const isPlaying = !!court.match;
            const isRental  = court.type === 'rental';
            const nowMs      = Date.now();
            const elapsed    = isPlaying ? nowMs - court.match.startedAt : 0;
            const hasTimer   = isPlaying && court.match.endsAt;
            const remaining  = hasTimer ? court.match.endsAt - nowMs : 0;
            const timeUp     = hasTimer && remaining <= 0;
            const showTimeUp = timeUp && !isRental && competitiveMode;

            const cardClass = showTimeUp
              ? 'bg-gradient-to-br from-rose-950 to-zinc-900 border-rose-500'
              : isPlaying && isRental ? 'bg-gradient-to-br from-amber-950 to-zinc-900 border-amber-500'
              : isPlaying ? 'bg-gradient-to-br from-lime-950 to-zinc-900 border-lime-500'
              : isRental ? 'bg-zinc-900 border-amber-700 border-dashed'
              : 'bg-zinc-900 border-zinc-800';

            // Re-keying the body on the status token remounts it, so a change like
            // EMPTY → OCCUPIED crossfades in rather than snapping (spec §5). The
            // card's own colours transition at the same time (transition-colors).
            const statusKey = showTimeUp ? 'timeup' : isPlaying ? (isRental ? 'rental' : 'live') : 'idle';

            return (
              <div key={court.id} className={`rounded-2xl border-2 overflow-hidden transition-colors duration-500 ${cardClass}`}>
                <div key={statusKey} className="cf-fade-in">
                {/* ── Card header ── */}
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-4xl">{court.name}</h3>
                    {isRental && (
                      <span className="text-xs font-bold tracking-widest bg-amber-500 text-zinc-950 px-2 py-1 rounded">
                        RENTAL
                      </span>
                    )}
                  </div>
                  {showTimeUp ? (
                    <div className="text-right">
                      <div className="flex items-center gap-2 text-rose-300 text-sm font-bold mb-1">
                        <span className="w-2.5 h-2.5 bg-rose-400 rounded-full animate-pulse" /> TIME UP
                      </div>
                      <div className="font-display text-3xl text-rose-300">0:00</div>
                    </div>
                  ) : isPlaying ? (
                    <div className="text-right">
                      <div className={`flex items-center gap-2 text-sm font-bold mb-1 ${isRental ? 'text-amber-300' : 'text-lime-400'}`}>
                        <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${isRental ? 'bg-amber-400' : 'bg-lime-400'}`} />
                        {isRental ? 'IN USE' : 'LIVE'}
                      </div>
                      <div className={`font-display text-4xl ${isRental ? 'text-amber-300' : 'text-lime-400'}`}>
                        {hasTimer ? fmtElapsed(remaining) : fmtElapsed(elapsed)}
                      </div>
                      {hasTimer && (
                        <div className={`text-xs mt-0.5 ${isRental ? 'text-amber-400' : 'text-lime-500'} opacity-70`}>
                          remaining
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className={`font-display text-6xl leading-none ${isRental ? 'text-amber-400' : 'text-lime-400'}`}>
                      {isRental ? 'AVAILABLE' : 'OPEN'}
                    </span>
                  )}
                </div>

                {/* ── Court body ── */}
                {isPlaying && isRental ? (
                  /* Rental — host party */
                  (() => {
                    const host = playerById(court.match.players[0]);
                    return (
                      <div className="flex flex-col items-center py-10 border-t border-zinc-700/50">
                        {host && <PlayerAvatar player={host} size="xl" />}
                        <div className="mt-4 font-display text-3xl text-center">
                          {host ? `${host.name}'s Party` : 'Rental'}
                        </div>
                      </div>
                    );
                  })()
                ) : isPlaying ? (
                  <>
                    {/* Team 1 — top half */}
                    <div className="flex border-t border-zinc-700/50">
                      {court.match.players.slice(0, 2).map((id, i) => {
                        const p = playerById(id);
                        if (!p) return null;
                        return (
                          <div
                            key={id}
                            className={`flex-1 flex flex-col items-center py-5 px-3 ${i === 0 ? 'border-r border-zinc-700/50' : ''}`}
                          >
                            <PlayerAvatar player={p} size="xl" />
                            <div className="mt-3 text-center">
                              <div className="cf-text-glow font-display text-xl leading-tight">{p.name}</div>
                              <span className={`inline-block text-xs px-2 py-0.5 rounded mt-1 border ${skillStyle(p.skill)}`}>
                                {p.skill}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* NET divider */}
                    <div className="flex items-center gap-3 px-5 py-2 bg-zinc-900/70">
                      <div className="flex-1 h-px bg-zinc-600" />
                      <span className="text-[10px] font-bold tracking-[0.3em] text-zinc-500">NET</span>
                      <div className="flex-1 h-px bg-zinc-600" />
                    </div>
                    {/* Team 2 — bottom half */}
                    <div className="flex">
                      {court.match.players.slice(2, 4).map((id, i) => {
                        const p = playerById(id);
                        if (!p) return null;
                        return (
                          <div
                            key={id}
                            className={`flex-1 flex flex-col items-center py-5 px-3 ${i === 0 ? 'border-r border-zinc-700/50' : ''}`}
                          >
                            <PlayerAvatar player={p} size="xl" />
                            <div className="mt-3 text-center">
                              <div className="cf-text-glow font-display text-xl leading-tight">{p.name}</div>
                              <span className={`inline-block text-xs px-2 py-0.5 rounded mt-1 border ${skillStyle(p.skill)}`}>
                                {p.skill}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-14 border-t border-zinc-800/50">
                    <div className={`font-display text-4xl ${isRental ? 'text-amber-400' : 'text-lime-400'}`}>
                      {isRental ? 'AVAILABLE TO RENT' : 'WAITING FOR PLAYERS'}
                    </div>
                    {!isRental && (
                      <div className="mt-2 text-lg font-semibold text-zinc-300">
                        Check in at the desk to play
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── QUEUE ── */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-4xl text-lime-400 flex items-center gap-3">
              UP NEXT <span className="text-zinc-600 text-2xl">({queue.length})</span>
            </h2>
            {gamesServed > 0 && (
              <span className="text-zinc-500 text-sm flex items-center gap-1.5">
                <BarChart2 className="w-4 h-4" /> {gamesServed} groups served today
              </span>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="bg-zinc-900 border-2 border-dashed border-zinc-700 rounded-2xl p-10 text-center">
              <p className="font-display text-4xl text-zinc-400 mb-2">QUEUE EMPTY</p>
              <p className="text-zinc-300 text-lg font-semibold">
                {openCourts > 0
                  ? `${openCourts} court${openCourts > 1 ? 's' : ''} ready — check in at the desk!`
                  : 'All courts are currently in use'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {queue.map((g, idx) => {
                const groupPlayers = g.players.map(playerById).filter(Boolean);
                const hasFreeCourt = courts.some(c => c.type === 'open' && !c.match);
                const isImmediateNext = idx === 0 && hasFreeCourt && groupPlayers.length >= 4;
                // The approximate call window, for people reading this across a
                // room and deciding whether they have time to get a drink.
                const estimate = groupPlayers.length === 4
                  ? callEstimate({
                      attendance: 'queued',
                      groupsAhead: queue.slice(0, idx).filter(x => x.players.length === 4).length,
                      courts,
                      durationMin: competitiveMode ? null : defaultOpenDuration,
                      now: nowMs,
                    })
                  : null;
                // Every complete group is snake-drafted into two teams, however
                // it was built, so the board can always show the sides.
                const isAutoBalanced = groupPlayers.length === 4;

                return (
                  <div
                    key={g.id}
                    style={{ animationDelay: `${Math.min(idx, 8) * 70}ms` }}
                    className={`cf-fade-up rounded-2xl p-5 border-2 transition-colors duration-500 ${
                      isImmediateNext
                        ? 'bg-lime-950 border-lime-600'
                        : 'bg-zinc-900 border-zinc-800'
                    }`}
                  >
                    {/* Group header */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <span className="font-display text-6xl text-lime-400 leading-none">#{idx + 1}</span>
                        <div className="text-xs uppercase tracking-widest text-zinc-500 mt-0.5">
                          {g.type === 'auto' ? 'Auto-balanced' : 'Group'}
                        </div>
                      </div>
                      {isImmediateNext ? (
                        <span className="text-xs font-bold text-lime-300 bg-lime-900 border border-lime-700 px-3 py-1.5 rounded-full animate-pulse mt-1">
                          STEPPING ON
                        </span>
                      ) : (
                        <div className="flex flex-col items-end gap-1 mt-1">
                          {/* Time waited — measured, never predicted. */}
                          <span className="text-sm text-zinc-300 bg-zinc-800 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-zinc-500" />
                            {fmtWaiting(nowMs, g.createdAt)}
                          </span>
                          {/* Roughly when they are called — a range, on purpose. */}
                          {estimate?.text && (
                            <span className="text-xs text-zinc-400 text-right max-w-[14rem]">
                              {estimate.text}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Players — split into teams if auto-balanced */}
                    {isAutoBalanced ? (
                      <div className="grid grid-cols-2 gap-2">
                        {[0, 1].map(team => (
                          <div key={team} className="bg-zinc-950 bg-opacity-60 rounded-xl p-2.5">
                            <div className="text-[10px] text-zinc-500 font-bold tracking-widest mb-1.5">TEAM {team + 1}</div>
                            {groupPlayers.slice(team * 2, team * 2 + 2).map(p => (
                              <div key={p.id} className="flex items-center gap-1.5 mb-1.5 last:mb-0">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                                <span className="font-display text-xl leading-tight flex-1">{p.name}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {groupPlayers.map(p => (
                          <div key={p.id} className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                            <span className="font-display text-2xl flex-1">{p.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MODALS
   ───────────────────────────────────────────── */
const OPEN_DURATIONS = [
  { label: 'Open', value: null },
  { label: '10m',  value: 10 },
  { label: '15m',  value: 15 },
  { label: '20m',  value: 20 },
  { label: '30m',  value: 30 },
  { label: '45m',  value: 45 },
  { label: '60m',  value: 60 },
];

const RENTAL_DURATIONS = [
  { label: '1 hr', value: 60 },
  { label: '2 hr', value: 120 },
  { label: '3 hr', value: 180 },
  { label: '4 hr', value: 240 },
];

function AssignModal({ competitiveMode, group, courts, playerById, defaultOpenDuration, onAssign, onClose }) {
  if (!group) return null;
  /* Every open court, presented as an equal choice: no preselection, no
     highlight, no reordering, no colour that marks one out. Where a group plays
     is entirely staff's call, and the app deliberately has no opinion. */
  const openCourts = courts.filter(c => !c.match);

  return (
    <ModalShell onClose={onClose} title={modals.assign.title} wide>
      <div className="mb-4">
        <p className="text-sm text-zinc-400 mb-2">{modals.assign.groupLabel}</p>
        {/* The four in their team order — the same split the queue card shows,
            so what staff confirm here is what walks onto the court. */}
        <div className="bg-zinc-950 rounded-lg p-2 grid grid-cols-2 gap-2">
          {[0, 1].map(team => (
            <div key={team}>
              <div className="text-[10px] font-bold tracking-widest text-zinc-600 mb-1">
                {queueCopy.team(team + 1)}
              </div>
              {group.players.slice(team * 2, team * 2 + 2).map(id => {
                const p = playerById(id);
                return p ? (
                  <div key={id} className="text-sm">{p.name} <span className="text-zinc-500">· {p.skill}</span></div>
                ) : null;
              })}
            </div>
          ))}
        </div>
      </div>

      {openCourts.length === 0 ? (
        <p className="text-amber-400 text-sm py-4 text-center">{modals.assign.noOpenCourts}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400 mb-2">{modals.assign.pickPrompt}</p>
          {openCourts.map(c => {
            const isRental = c.type === 'rental';
            const durations = isRental ? RENTAL_DURATIONS : OPEN_DURATIONS;
            return (
              <div key={c.id} className={`rounded-lg p-3 border-2 ${
                isRental
                  ? 'bg-amber-950 bg-opacity-30 border-amber-800 border-dashed'
                  : 'bg-zinc-950 border-zinc-800'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg">{c.name}</span>
                    {isRental ? (
                      <span className="text-[10px] font-bold tracking-widest bg-amber-500 text-zinc-950 px-1.5 py-0.5 rounded">{modals.assign.rentalTag}</span>
                    ) : (
                      <span className="text-[10px] font-bold tracking-widest text-zinc-500">{modals.assign.openPlayTag}</span>
                    )}
                  </div>
                  {!isRental && !competitiveMode && defaultOpenDuration && (
                    <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" /> {modals.assign.autoWillUse(defaultOpenDuration)}
                    </span>
                  )}
                </div>
                {/* 7 across is unreadable on a phone; wrap to 4 until there's room. */}
                <div className={`grid gap-1.5 ${isRental ? 'grid-cols-4' : 'grid-cols-4 sm:grid-cols-7'}`}>
                  {durations.map(d => {
                    const isDefault = !isRental && d.value === defaultOpenDuration;
                    return (
                      <button
                        key={String(d.value)}
                        onClick={() => onAssign(c.id, d.value)}
                        className={`text-xs font-bold py-2 rounded-md transition relative ${
                          isRental
                            ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                            : isDefault
                            ? 'bg-cyan-400 text-zinc-950 hover:bg-cyan-300 ring-2 ring-cyan-300'
                            : 'bg-lime-400 text-zinc-950 hover:bg-lime-300'
                        }`}
                        title={isDefault ? modals.assign.defaultDurationTitle : undefined}
                      >
                        {d.label}
                        {isDefault && (
                          <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-cyan-300 rounded-full flex items-center justify-center">
                            <Zap className="w-2 h-2 text-zinc-950" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}

function FinishMatchModal({ court, playerById, onFinish, onClose }) {
  if (!court?.match) return null;
  const [t1a, t1b, t2a, t2b] = court.match.players.map(playerById);
  return (
    <ModalShell onClose={onClose} title={modals.finishMatch.title(court.name)}>
      {/* Stacked on phones: these are big tap targets and player names wrap badly
          in two narrow columns. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => onFinish(1)}
          className="bg-zinc-900 border-2 border-zinc-800 hover:border-lime-500 hover:bg-lime-950 rounded-xl p-4 text-left transition"
        >
          <div className="text-xs text-zinc-500 font-bold mb-2">{modals.finishMatch.team1}</div>
          <div className="font-display text-xl">{t1a?.name}</div>
          <div className="font-display text-xl">{t1b?.name}</div>
          <div className="mt-3 text-lime-400 text-xs font-bold">{modals.finishMatch.markWinner}</div>
        </button>
        <button
          onClick={() => onFinish(2)}
          className="bg-zinc-900 border-2 border-zinc-800 hover:border-lime-500 hover:bg-lime-950 rounded-xl p-4 text-left transition"
        >
          <div className="text-xs text-zinc-500 font-bold mb-2">{modals.finishMatch.team2}</div>
          <div className="font-display text-xl">{t2a?.name}</div>
          <div className="font-display text-xl">{t2b?.name}</div>
          <div className="mt-3 text-lime-400 text-xs font-bold">{modals.finishMatch.markWinner}</div>
        </button>
      </div>
    </ModalShell>
  );
}

function LeaderboardModal({ leaderboard, history, onClose }) {
  return (
    <ModalShell onClose={onClose} title={leaderboardCopy.title} wide>
      {leaderboard.length === 0 ? (
        <p className="text-zinc-500 text-center py-8">{leaderboardCopy.empty}</p>
      ) : (
        <div className="space-y-1">
          {leaderboard.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 bg-zinc-950 rounded-lg px-3 py-2">
              <span className={`font-display text-2xl w-10 ${
                i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-700' : 'text-zinc-600'
              }`}>
                {i === 0 ? <Crown className="w-6 h-6" /> : `#${i + 1}`}
              </span>
              <div className="flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-zinc-500">{p.skill}</div>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl text-lime-400">{p.wins}W</div>
                <div className="text-xs text-zinc-500">{p.losses}L · {Math.round(p.rate * 100)}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 pt-4 border-t border-zinc-800 text-xs text-zinc-500">
        {leaderboardCopy.totalMatches(history.length)}
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   CHECKOUT (spec §3)
   A roster action — the player is leaving for the day. Shows their session length,
   flags them if still unpaid, and lets staff take payment on the spot. It never
   blocks: the "Check out" button always works; the warning is just a nudge. On
   confirm the player leaves the active roster (their profile is kept in the DB).
   ───────────────────────────────────────────── */
function CheckoutModal({ player, onSetPayment, onComplete, onClose }) {
  // Looked up fresh from state each render, so it can briefly be undefined right
  // after checkout clears the id — bail cleanly.
  if (!player) return null;
  const paid = isPaid(player.payment);
  // Same normalisation the logged event uses, so the number on this screen and
  // the number in the activity log can never disagree.
  const now = Date.now();
  const session = durationBetween(player.checkedInAt, now, { now });
  const checkedInMs = normalizeTimestamp(player.checkedInAt, { now });
  const checkedIn = checkedInMs.ok
    ? new Date(checkedInMs.ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : TIME_UNAVAILABLE;

  return (
    <ModalShell onClose={onClose} title={modals.checkout.title(player.name)}>
      <div className="flex items-center gap-3 mb-4">
        <PlayerAvatar player={player} size="lg" />
        <div className="min-w-0">
          <div className="font-semibold text-lg truncate">{player.name}</div>
          <div className="text-xs text-zinc-500">{player.skill} • {player.wins}W {player.losses}L</div>
        </div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 mb-4 space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400 flex items-center gap-1.5">
            <LogIn className="w-4 h-4 text-zinc-500" /> {modals.checkout.checkedInLabel}
          </span>
          <span className="text-zinc-200">{checkedIn}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-400 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-zinc-500" /> {modals.checkout.sessionLengthLabel}
          </span>
          <span className="font-semibold text-lime-400">
            {session.ok ? formatDuration(session.ms) : TIME_UNAVAILABLE}
          </span>
        </div>
      </div>

      {paid ? (
        <div className="flex items-center gap-2 text-sm text-zinc-300 mb-5">
          <span className="text-zinc-400">{modals.checkout.paymentLabel}</span>
          <PaymentBadge payment={player.payment} />
        </div>
      ) : (
        <div className="bg-rose-950 border border-rose-700 rounded-lg p-3 mb-5">
          <div className="flex items-start gap-2.5 mb-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-200 font-bold">
              {modals.checkout.unpaidWarning(player.name)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onSetPayment(player.id, 'online')}
              className="flex-1 text-xs font-bold py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> {modals.checkout.payOnline}
            </button>
            <button
              onClick={() => onSetPayment(player.id, 'cash')}
              className="flex-1 text-xs font-bold py-2 rounded-md bg-amber-400 hover:bg-amber-300 text-zinc-950 flex items-center justify-center gap-1"
            >
              <DollarSign className="w-3.5 h-3.5" /> {modals.checkout.payCash}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={onComplete}
        className="w-full bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition"
      >
        <LogOut className="w-4 h-4" />
        {paid ? modals.checkout.confirmPaid : modals.checkout.confirmUnpaid}
      </button>
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   REPLACE A QUEUED PLAYER (spec §4)
   Someone is leaving a group; this asks who takes the slot rather than deciding
   for staff. The closest-value stand-in leads because it keeps the group as
   even as the matcher made it, but it is one option among four — taking it
   every time is exactly how one strong group ends up stacked all evening.

   No values anywhere on this screen, including the suggestion: staff pick on
   names. The roster's Values toggle deliberately does not reach in here.
   ───────────────────────────────────────────── */
function ReplaceQueuePlayerModal({ leaving, groupIndex, available, suggested, onReplace, onLeaveOpen, onClose }) {
  const [search, setSearch] = useState('');

  const listed = available
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const c = modals.replacePlayer;
  const groupLabel = groupIndex >= 0 ? c.groupLabel(groupIndex + 1) : c.fallbackGroupLabel;

  return (
    <ModalShell onClose={onClose} title={c.title(leaving?.name ?? 'player')}>
      <p className="text-sm text-zinc-400 mb-3">
        {c.intro} <span className="text-zinc-200 font-semibold">{groupLabel}</span>.{' '}
        {c.introAfter}
      </p>

      <div className="space-y-2 mb-4">
        {suggested && (
          <button
            onClick={() => onReplace(suggested.id)}
            className="w-full bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-2.5 px-3 rounded-lg flex items-center gap-2 text-left"
          >
            <Zap className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate">{c.closestMatch(suggested.name)}</span>
            <span className="text-[10px] font-bold tracking-wider opacity-70 shrink-0">{c.closestBadge}</span>
          </button>
        )}
        <button
          onClick={() => onReplace(randomFrom(available)?.id ?? null)}
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold py-2.5 px-3 rounded-lg flex items-center gap-2 text-left"
          title={c.randomTitle}
        >
          <Shuffle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{c.randomDraw}</span>
          <span className="text-[10px] font-bold tracking-wider text-zinc-500 shrink-0">{c.randomBadge}</span>
        </button>
      </div>

      <p className="text-sm text-zinc-400 mb-2">{c.pickPrompt}</p>
      <div className="relative mb-2">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={c.searchPlaceholder}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-lime-500"
        />
      </div>
      <div className="max-h-44 overflow-y-auto bg-zinc-950 rounded-lg p-1 mb-4">
        {listed.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-4">{c.noneMatch}</p>
        )}
        {listed.map(p => (
          <button
            key={p.id}
            onClick={() => onReplace(p.id)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800 text-left transition"
          >
            <PlayerAvatar player={p} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{p.name}</div>
              <div className="text-xs text-zinc-500">{p.skill}</div>
            </div>
            <PaymentBadge payment={p.payment} dot />
          </button>
        ))}
      </div>

      <button
        onClick={onLeaveOpen}
        className="w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold py-2 rounded-lg text-sm"
      >
        {c.leaveOpen}
      </button>
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   SESSION RANKINGS (spec §6)
   Today's standings, separate from the all-time /leaderboard page: raw wins
   rather than win rate, and no minimum-games gate, because on a single evening
   nobody has ten games. Shows W/L and recent form only — the hidden value the
   matcher groups on is deliberately absent, and staff who need it use the
   roster's Values toggle instead.
   ───────────────────────────────────────────── */
const RANK_COLORS = ['text-amber-300', 'text-zinc-300', 'text-amber-600'];

function SessionRankModal({ rows, onClose }) {
  return (
    <ModalShell onClose={onClose} title={sessionRankCopy.title} wide>
      {rows.length === 0 ? (
        <p className="text-zinc-500 text-center py-10">{sessionRankCopy.empty}</p>
      ) : (
        <>
          <div className="flex items-center gap-3 px-3 pb-2 text-[11px] font-bold tracking-wider text-zinc-600 uppercase">
            <span className="w-8 shrink-0">{sessionRankCopy.colRank}</span>
            <span className="flex-1">{sessionRankCopy.colPlayer}</span>
            <span className="w-16 text-center shrink-0">{sessionRankCopy.colRecord}</span>
            <span className="w-28 text-right shrink-0" title={sessionRankCopy.streakTitle}>
              {sessionRankCopy.colStreak}
            </span>
          </div>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 bg-zinc-950 rounded-lg px-3 py-2">
                <span className={`w-8 shrink-0 font-display text-lg ${RANK_COLORS[i] ?? 'text-zinc-600'}`}>
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">{r.name}</span>
                <span className="w-16 text-center shrink-0 text-sm font-mono">
                  <span className="text-lime-400 font-bold">{r.wins}</span>
                  <span className="text-zinc-600"> — </span>
                  <span className="text-rose-400">{r.losses}</span>
                </span>
                {/* Newest first, so the leftmost chip is the game they just
                    played — read it as "how are they going right now". */}
                <span className="w-28 flex justify-end gap-1 shrink-0" title={sessionRankCopy.streakTitle}>
                  {r.streak.map((s, j) => (
                    <span
                      key={j}
                      className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${
                        s === 'W' ? 'bg-lime-950 text-lime-400 border border-lime-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-900'
                      }`}
                    >
                      {s}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="text-xs text-zinc-600 mt-4 pt-3 border-t border-zinc-800">
        {sessionRankCopy.footer}
      </p>
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   ACTIVITY LOG (spec §9)
   A simple reverse-chronological list of check-ins, checkouts, match results
   and payment changes. Kept lightweight — a review list, not an analytics
   surface.
   ───────────────────────────────────────────── */
const AUDIT_META = {
  checkin:  { icon: LogIn,         color: 'text-cyan-400',  label: modals.activityLog.labels.checkin },
  checkout: { icon: LogOut,        color: 'text-zinc-300',  label: modals.activityLog.labels.checkout },
  result:   { icon: Trophy,        color: 'text-lime-400',  label: modals.activityLog.labels.result },
  payment:  { icon: DollarSign,    color: 'text-amber-400', label: modals.activityLog.labels.payment },
  autoGroup:{ icon: Shuffle,       color: 'text-zinc-400',  label: modals.activityLog.labels.autoGroup },
  // Legacy: nothing writes `noshow` any more, but saved sessions can still
  // carry entries from before the no-show nudge was removed.
  noshow:   { icon: AlertTriangle, color: 'text-rose-400',  label: modals.activityLog.labels.noshow },
};

function ActivityLogModal({ auditLog, onClose }) {
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const c = modals.activityLog;
  const describe = (e) => {
    switch (e.type) {
      case 'checkin':
        return `${e.returning ? c.returning : c.newPlayer} · ${paymentInfo(e.payment).label}`;
      case 'checkout':
        return `${e.courtName ? e.courtName + ' · ' : ''}${c.checkoutHere(
          e.sessionMs == null ? TIME_UNAVAILABLE : formatDuration(e.sessionMs)
        )} · ${paymentInfo(e.payment).label}`;
      case 'result':
        return `${c.resultDefeated(e.loserNames)}${e.courtName ? ' · ' + e.courtName : ''} · ${fmtDuration(e.durationMs ?? 0)}`;
      case 'payment':
        return c.paymentChange(paymentInfo(e.payment).label);
      case 'autoGroup':
        return `${c.autoGroupRun(e.createdCount ?? 0, e.availableBefore ?? 0, e.availableAfter ?? 0)} · ${c.autoGroupLevels(e.levels ?? [])}`;
      case 'noshow':
        return e.courtName ? c.noshowFrom(e.courtName) : '';
      default:
        return '';
    }
  };

  return (
    <ModalShell onClose={onClose} title={c.title} wide>
      {auditLog.length === 0 ? (
        <p className="text-zinc-500 text-center py-10">{c.empty}</p>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {auditLog.map(e => {
            const meta = AUDIT_META[e.type] ?? AUDIT_META.checkin;
            const Icon = meta.icon;
            return (
              <div key={e.id} className="flex items-center gap-3 bg-zinc-950 rounded-lg px-3 py-2">
                <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    <span className={meta.color}>{meta.label}</span>
                    <span className="text-zinc-200"> · {e.playerName}</span>
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{describe(e)}</div>
                </div>
                <span className="text-xs text-zinc-500 shrink-0">{fmtTime(e.at)}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-zinc-600 mt-4 pt-3 border-t border-zinc-800">{c.footer}</p>
    </ModalShell>
  );
}

function RentalModal({ court, players, busyPlayerIds, onBook, onClose }) {
  const [search, setSearch]     = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [duration, setDuration] = useState(60);

  const available = players
    .filter(p => !p.checkedOut && !busyPlayerIds.has(p.id))
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ModalShell onClose={onClose} title={modals.rental.title(court?.name ?? modals.rental.fallbackCourtName)}>
      <p className="text-sm text-zinc-400 mb-3">{modals.rental.hostPrompt}</p>

      {/* Player search */}
      <div className="relative mb-2">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={modals.rental.searchPlaceholder}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
      </div>
      <div className="max-h-44 overflow-y-auto bg-zinc-950 rounded-lg p-1 mb-4">
        {available.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-4">{modals.rental.noneAvailable}</p>
        )}
        {available.map(p => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition ${
              selectedId === p.id ? 'bg-amber-950 border border-amber-700' : 'hover:bg-zinc-800'
            }`}
          >
            <PlayerAvatar player={p} size="sm" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="text-xs text-zinc-500">{p.skill}</div>
            </div>
            {selectedId === p.id && <Check className="w-4 h-4 text-amber-400" />}
          </div>
        ))}
      </div>

      {/* Duration */}
      <p className="text-sm text-zinc-400 mb-2">{modals.rental.durationLabel}</p>
      <div className="grid grid-cols-4 gap-2 mb-5">
        {RENTAL_DURATIONS.map(d => (
          <button
            key={d.value}
            onClick={() => setDuration(d.value)}
            className={`text-sm font-bold py-2 rounded-lg transition ${
              duration === d.value
                ? 'bg-amber-500 text-zinc-950'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Confirm */}
      {selectedId && (
        <div className="text-center text-sm text-zinc-400 mb-3">
          {modals.rental.bookingFor}{' '}
          <span className="text-amber-400 font-semibold">
            {modals.rental.partySuffix(players.find(p => p.id === selectedId)?.name ?? '')}
          </span>
        </div>
      )}
      <button
        onClick={() => selectedId && onBook(selectedId, duration)}
        disabled={!selectedId}
        className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-3 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition"
      >
        {modals.rental.confirm}
      </button>
    </ModalShell>
  );
}

function CameraModal({ playerName, onSave, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [captured, setCaptured] = useState(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 400 }, height: { ideal: 400 } } })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      // No camera, or permission denied → silently skip the photo step rather
      // than blocking check-in with an error modal (spec §5). The parent already
      // pre-checks for a camera, so this is the belt-and-braces fallback.
      .catch(() => { if (!cancelled) onClose(); });
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const capture = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(200, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, 200, 200);
    ctx.restore();
    setCaptured(c.toDataURL('image/jpeg', 0.75));
  };

  const retake = () => {
    setCaptured(null);
    if (streamRef.current && videoRef.current) videoRef.current.srcObject = streamRef.current;
  };

  return (
    <ModalShell onClose={onClose} title={modals.camera.title(playerName)}>
      <canvas ref={canvasRef} className="hidden" />
      {captured ? (
        <div className="text-center">
          <img src={captured} alt={modals.camera.previewAlt} className="w-48 h-48 rounded-full object-cover mx-auto mb-5 border-4 border-lime-500" />
          <div className="flex gap-3 justify-center">
            <button onClick={retake} className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-lg flex items-center gap-2">
              <RotateCcw className="w-4 h-4" /> {modals.camera.retake}
            </button>
            <button onClick={() => onSave(captured)} className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4" /> {modals.camera.save}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <div className="relative w-64 h-64 mx-auto mb-5 rounded-xl overflow-hidden bg-zinc-950">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-52 h-52 rounded-full border-2 border-lime-400 border-dashed opacity-60" />
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={onClose} className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold rounded-lg">
              {buttons.skip}
            </button>
            <button onClick={capture} className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold rounded-lg flex items-center gap-2">
              <Camera className="w-4 h-4" /> {modals.camera.take}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

/* ModalShell now lives in ./components/ModalShell.jsx so the setup wizard can
   import it without pulling App.jsx in with it. */
