import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Trophy, RotateCcw, X, Check, Search, Zap, Monitor,
  Settings, Users, ChevronRight, Clock, Trash2, UserPlus,
  Shuffle, Crown, Activity, Megaphone, BarChart2, Camera,
  Copy, LogOut, RefreshCw, ExternalLink, AlertTriangle, ClipboardList,
  LogIn, DollarSign,
} from 'lucide-react';

import { useAuth } from './lib/AuthProvider';
import { supabase } from './lib/supabase';
import { loadSession, createSessionSync } from './lib/session';
import {
  listPlayers, createPlayer, deletePlayer, updatePlayerPhoto,
  updatePlayerPayment, recordResult, resetAllStats, recordMatchHistory,
} from './lib/players';
import { uploadPhoto } from './lib/photos';

// Pure logic lives in ./lib/logic.js so tests can import it without booting the
// Supabase client. Re-exported here because existing callers import from App.
import {
  SKILL_TIERS, skillRank, fmtElapsed, fmtMinutes, fmtDuration, estimateWait, balancedGroup,
  defaultCourts, hydrateCourts,
  PAYMENT_STATUSES, PAYMENT_ORDER, paymentInfo, isPaid,
} from './lib/logic';
export { SKILL_TIERS, skillRank, fmtElapsed, fmtMinutes, estimateWait, balancedGroup };

// Minutes a called group has to start playing before staff get a no-show nudge.
const NO_SHOW_MINUTES = 5;

// Bounds the in-memory activity log carried in the session blob.
const MAX_AUDIT = 100;

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

/* ─────────────────────────────────────────────
   SKILL STYLES
   ───────────────────────────────────────────── */
const skillStyle = (s) => ({
  Beginner:     'bg-slate-700 text-slate-200 border-slate-600',
  Novice:       'bg-emerald-900 text-emerald-200 border-emerald-700',
  Intermediate: 'bg-sky-900 text-sky-200 border-sky-700',
  Advanced:     'bg-amber-900 text-amber-200 border-amber-700',
  Pro:          'bg-rose-900 text-rose-200 border-rose-700',
}[s] || 'bg-slate-700 text-slate-200');

const skillStyleSolid = (s) => ({
  Beginner:     'bg-slate-500',
  Novice:       'bg-emerald-500',
  Intermediate: 'bg-sky-500',
  Advanced:     'bg-amber-500',
  Pro:          'bg-rose-500',
}[s] || 'bg-slate-500');

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
  if (dot) {
    return (
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${info.dot}`}
        title={title ?? info.label}
        aria-label={info.label}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${info.badge}`}
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
  const [autoAssign, setAutoAssign]   = useState(true);
  // null = no timer; number = minutes. Applies to auto-assign for open-play courts.
  const [defaultOpenDuration, setDefaultOpenDuration] = useState(null);

  const [showDisplayLink, setShowDisplayLink] = useState(false);
  const [displayToken, setDisplayToken] = useState(venue.display_token);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerSkill, setNewPlayerSkill] = useState('Intermediate');
  const [newPlayerPayment, setNewPlayerPayment] = useState('unpaid');
  const [search, setSearch]           = useState('');
  const [draftGroup, setDraftGroup]   = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [finishingCourt, setFinishingCourt]   = useState(null);
  // Snapshot of a just-ended court session awaiting the checkout screen (spec §3).
  const [checkoutData, setCheckoutData]       = useState(null);
  const [showAssign, setShowAssign]           = useState(null);
  const [showRental, setShowRental]           = useState(null);
  const [showAnnouncementBar, setShowAnnouncementBar] = useState(false);
  const [pendingPhotoPlayerId, setPendingPhotoPlayerId] = useState(null);
  const [draggingPlayerId, setDraggingPlayerId]         = useState(null);

  const [tick, setTick] = useState(0);
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
          setAutoAssign(saved.autoAssign ?? true);
          setDefaultOpenDuration(saved.defaultOpenDuration ?? null);
        }
        if (!cancelled) setBooting(false);
      } catch (err) {
        console.error('Failed to load venue data:', err);
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, reloadNonce]);

  // ── Session sync: debounced write to Postgres + instant broadcast to the TV ──
  const syncRef = useRef(null);
  useEffect(() => {
    const sync = createSessionSync(venueId, displayToken);
    syncRef.current = sync;
    return () => {
      sync.destroy();
      syncRef.current = null;
    };
  }, [venueId, displayToken]);

  // Replaces the old localStorage write. Players are excluded — they live in
  // their own table now, and the display fetches them separately.
  useEffect(() => {
    if (booting) return;
    syncRef.current?.push({
      courts, queue, history, auditLog, competitiveMode, autoAssign, announcement, defaultOpenDuration,
    });
  }, [booting, courts, queue, history, auditLog, competitiveMode, autoAssign, announcement, defaultOpenDuration]);

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
      // Timer-expiry is an automatic checkout — log it (no modal, staff may be
      // away), but unpaid players stay flagged red in the roster regardless.
      c.match.players.forEach(id => {
        const p = players.find(pl => pl.id === id);
        if (!p) return;
        logEvent({
          type: 'checkout', playerName: p.name, courtName: c.name,
          checkedInAt: p.checkedInAt, checkoutAt: now,
          sessionMs: now - p.checkedInAt, payment: p.payment, autoEnded: true,
        });
      });
    });
    setCourts(prev => prev.map(c =>
      expired.find(e => e.id === c.id) ? { ...c, match: null } : c
    ));
  }, [tick, competitiveMode]);

  // Auto-assign: feed the first complete queued group onto a free open-play court.
  // The ref guard matters now that setCourts/setQueue can be interleaved with
  // network work — without it the same group can be assigned twice.
  const lastAutoAssigned = useRef(null);
  useEffect(() => {
    if (!autoAssign) return;
    const freeCourt = courts.find(c => !c.match && c.type === 'open');
    if (!freeCourt) return;
    const nextGroup = queue[0];
    if (!nextGroup || nextGroup.players.length < 4) return;
    if (lastAutoAssigned.current === nextGroup.id) return;
    lastAutoAssigned.current = nextGroup.id;

    const now = Date.now();
    const dur = competitiveMode ? null : defaultOpenDuration;
    const match = {
      players: nextGroup.players,
      startedAt: now,
      endsAt: dur ? now + dur * 60 * 1000 : null,
      durationMin: dur,
      autoAssigned: true,
      calledAt: now,
      arrived: false,
    };
    setCourts(prev => prev.map(c => c.id === freeCourt.id ? { ...c, match } : c));
    setQueue(prev => prev.filter(g => g.id !== nextGroup.id));
  }, [courts, queue, autoAssign, competitiveMode, defaultOpenDuration]);

  const busyPlayerIds = useMemo(() => {
    const ids = new Set();
    courts.forEach(c => c.match?.players.forEach(p => ids.add(p)));
    queue.forEach(g => g.players.forEach(p => ids.add(p)));
    return ids;
  }, [courts, queue]);

  const avgGameDurationMs = useMemo(() => {
    const completed = history.filter(h => h.duration > 0);
    if (completed.length === 0) return 15 * 60 * 1000;
    return completed.reduce((sum, h) => sum + h.duration, 0) / completed.length;
  }, [history]);

  const openPlayCourtCount = useMemo(
    () => courts.filter(c => c.type === 'open').length,
    [courts]
  );

  const playerById = (id) => players.find(p => p.id === id);

  // Append to the audit trail (spec §9). Newest first, capped so the session blob
  // stays well under the Realtime broadcast limit.
  const logEvent = (entry) =>
    setAuditLog(prev => [{ id: `${Date.now()}-${Math.random()}`, at: Date.now(), ...entry }, ...prev].slice(0, MAX_AUDIT));

  // Players live in Postgres now, so the id comes back from the insert rather
  // than from Date.now(). The camera prompt waits for that id.
  const addPlayer = async () => {
    const n = newPlayerName.trim();
    if (!n) return;
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
      alert(`Couldn't add ${n}. Check your connection and try again.`);
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
    setDraftGroup(prev => prev.filter(x => x !== id));
    try {
      await deletePlayer(id);
    } catch (err) {
      console.error('Failed to remove player:', err);
      setPlayers(previous); // put them back rather than silently diverging from the DB
    }
  };

  const togglePlayerInDraft = (id) => {
    if (busyPlayerIds.has(id)) return;
    setDraftGroup(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  const saveDraftGroup = () => {
    if (draftGroup.length === 0) return;
    setQueue(prev => [...prev, { id: Date.now(), players: [...draftGroup], type: 'manual' }]);
    setDraftGroup([]);
  };

  const autoGroup = () => {
    const available = players
      .filter(p => !busyPlayerIds.has(p.id) && !draftGroup.includes(p.id))
      .sort((a, b) => skillRank(b.skill) - skillRank(a.skill));
    if (available.length < 4) {
      alert('Need at least 4 available players to auto-group.');
      return;
    }
    const balanced = balancedGroup(available.slice(0, 4));
    setQueue(prev => [...prev, { id: Date.now(), players: balanced.map(p => p.id), type: 'auto' }]);
  };

  const assignToCourt = (groupId, courtId, durationMin) => {
    const group = queue.find(g => g.id === groupId);
    const court = courts.find(c => c.id === courtId);
    if (!group || !court || court.match) return;
    const now = Date.now();
    const match = {
      players: group.players,
      startedAt: now,
      endsAt: durationMin ? now + durationMin * 60 * 1000 : null,
      durationMin: durationMin || null,
      // Called-to-court but not yet confirmed present — drives the no-show nudge.
      calledAt: now,
      arrived: false,
    };
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, match } : c));
    setQueue(prev => prev.filter(g => g.id !== groupId));
    setShowAssign(null);
  };

  const assignRental = (courtId, hostId, durationMin) => {
    const now = Date.now();
    setCourts(prev => prev.map(c => c.id === courtId ? {
      ...c,
      match: {
        players: [hostId],
        host: hostId,
        startedAt: now,
        endsAt: durationMin ? now + durationMin * 60 * 1000 : null,
        durationMin,
      },
    } : c));
    setShowRental(null);
  };

  // ── No-show handling (spec §7) ────────────────────────────────────────────
  // Staff confirm the called group actually showed up; that dismisses the nudge.
  const markArrived = (courtId) => {
    setCourts(prev => prev.map(c =>
      c.id === courtId && c.match ? { ...c, match: { ...c.match, arrived: true } } : c
    ));
  };

  // The group never turned up: free the court (they're dropped, not requeued) so
  // auto-assign — or staff — can put the next group on. Logged for the audit trail.
  const removeNoShow = (courtId) => {
    const court = courts.find(c => c.id === courtId);
    if (!court?.match) return;
    const names = court.match.players.map(id => playerById(id)?.name).filter(Boolean).join(', ');
    logEvent({ type: 'noshow', playerName: names || '(unknown)', courtName: court.name });
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, match: null } : c));
  };

  // ── Checkout (spec §3) ────────────────────────────────────────────────────
  // Snapshot a court's session before it's cleared so the checkout screen can
  // show durations and payment status even after the court is freed.
  const beginCheckout = (court, { winners } = {}) => {
    if (!court?.match) return;
    setCheckoutData({
      courtName: court.name,
      courtType: court.type,
      playerIds: court.match.players,
      startedAt: court.match.startedAt,
      endedAt: Date.now(),
      winners: winners ?? null,
    });
  };

  // Confirm the checkout: write a checkout event per player to the audit log.
  // Payment collection happens live via setPlayerPayment while the modal is open,
  // so by here each player already carries their final status.
  const completeCheckout = () => {
    if (!checkoutData) return;
    const { playerIds, endedAt, courtName } = checkoutData;
    playerIds.forEach(id => {
      const p = playerById(id);
      if (!p) return;
      logEvent({
        type: 'checkout', playerName: p.name, courtName,
        checkedInAt: p.checkedInAt, checkoutAt: endedAt,
        sessionMs: endedAt - p.checkedInAt, payment: p.payment,
      });
    });
    setCheckoutData(null);
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
    beginCheckout(court); // snapshot while the match is still on the court
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, match: null } : c));
    recordMatchHistory(venueId, { ...entry, courtName: court.name });
  };

  const finishMatch = (courtId, winningPair) => {
    const court = courts.find(c => c.id === courtId);
    if (!court?.match) return;
    const [p1, p2, p3, p4] = court.match.players;
    const winners = winningPair === 1 ? [p1, p2] : [p3, p4];
    const losers  = winningPair === 1 ? [p3, p4] : [p1, p2];
    setPlayers(prev => prev.map(p => {
      if (winners.includes(p.id)) return { ...p, wins: p.wins + 1 };
      if (losers.includes(p.id))  return { ...p, losses: p.losses + 1 };
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
    beginCheckout(court, { winners }); // snapshot before the court is cleared
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, match: null } : c));
    setFinishingCourt(null);

    // Fire-and-forget: the UI has already moved on, and both of these are
    // recoverable (stats can be corrected, history is for later analysis).
    recordResult(players, winners, losers).catch(err =>
      console.error('Failed to save win/loss:', err));
    recordMatchHistory(venueId, { ...entry, courtName: court.name });
  };

  const addCourt = () => {
    setCourts(prev => [...prev, { id: Date.now(), name: `Court ${prev.length + 1}`, type: 'open', match: null }]);
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

  const addPlayerToQueueGroup = (groupId, playerId) => {
    setQueue(prev => prev.map(g => {
      if (g.id !== groupId || g.players.includes(playerId) || g.players.length >= 4) return g;
      return { ...g, players: [...g.players, playerId] };
    }));
  };

  const resetSession = async () => {
    if (!confirm('Reset session? Clears courts, queue, stats, and announcements.')) return;
    const clearedCourts = courts.map(c => ({ ...c, match: null }));
    setCourts(clearedCourts);
    setQueue([]);
    setDraftGroup([]);
    setHistory([]);
    setAuditLog([]);
    setAnnouncement('');
    setShowAnnouncementBar(false);
    setCheckoutData(null);
    setPlayers(prev => prev.map(p => ({ ...p, wins: 0, losses: 0 })));
    setFinishingCourt(null);
    lastAutoAssigned.current = null;

    // One statement for the whole roster rather than a round-trip per player.
    resetAllStats(venueId).catch(err => console.error('Failed to reset stats:', err));

    // Push the cleared state immediately — the debounced write would be dropped
    // if staff closed the tab straight after resetting, resurrecting the session.
    syncRef.current?.push({
      courts: clearedCourts, queue: [], history: [], auditLog: [],
      competitiveMode, autoAssign, announcement: '', defaultOpenDuration,
    });
    await syncRef.current?.flush();
  };

  const regenerateDisplayLink = async () => {
    if (!confirm('Generate a new display link? The old one stops working immediately.')) return;
    const { data, error } = await supabase.rpc('rotate_display_token');
    if (error) {
      alert('Could not regenerate the link. Check your connection and try again.');
      return;
    }
    setDisplayToken(data);
  };

  const filteredPlayers = useMemo(() => {
    const q = search.toLowerCase().trim();
    return players
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => skillRank(b.skill) - skillRank(a.skill) || a.name.localeCompare(b.name));
  }, [players, search]);

  const leaderboard = useMemo(() =>
    [...players]
      .map(p => ({ ...p, total: p.wins + p.losses, rate: (p.wins + p.losses) ? p.wins / (p.wins + p.losses) : 0 }))
      .filter(p => p.total > 0)
      .sort((a, b) => b.wins - a.wins || b.rate - a.rate),
    [players]
  );

  if (loadFailed) {
    return (
      <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 text-center">
        <div>
          <div className="font-display text-4xl text-lime-400 mb-3">COURTFLOW</div>
          <p className="text-zinc-300 mb-1">Couldn’t load your session.</p>
          <p className="text-zinc-500 text-sm mb-6 max-w-xs">
            Check this device’s internet connection. Nothing has been lost.
          </p>
          <button
            onClick={() => setReloadNonce(n => n + 1)}
            className="bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold px-6 py-2.5 rounded-lg transition"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="font-display text-4xl text-lime-400 animate-pulse">COURTFLOW</div>
      </div>
    );
  }

  return (
    <div className="font-body min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── HEADER ─────────────────────────────── */}
      <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-lime-400 rounded-md flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-zinc-950" strokeWidth={3} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl text-lime-400 leading-none">COURTFLOW</h1>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{venue.name}</p>
            </div>
          </div>

          {/* Toolbar — three logical groups (left toggle · centre session controls ·
              right actions) separated by subtle dividers (spec §4A). */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* LEFT — view toggle */}
                <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                  <button
                    onClick={() => setView('staff')}
                    className={`px-3 sm:px-4 py-1.5 rounded-md text-sm font-semibold flex items-center gap-2 transition ${
                      view === 'staff' ? 'bg-lime-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Settings className="w-4 h-4" /> Staff
                  </button>
                  <button
                    onClick={() => setView('display')}
                    className={`px-3 sm:px-4 py-1.5 rounded-md text-sm font-semibold flex items-center gap-2 transition ${
                      view === 'display' ? 'bg-lime-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Monitor className="w-4 h-4" /> Preview
                  </button>
                </div>

                {view === 'staff' && (
                  <>
                    <Divider />

                    {/* CENTRE — session controls: Auto, timer, mode */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setAutoAssign(v => !v)}
                        className={`px-3 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 transition ${
                          autoAssign
                            ? 'bg-cyan-500 text-zinc-950 border-cyan-400 hover:bg-cyan-400'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={autoAssign
                          ? 'Auto-assign ON — queue groups feed open-play courts automatically'
                          : 'Auto-assign OFF — staff manually assigns every group'}
                      >
                        <Zap className="w-4 h-4" />
                        Auto {autoAssign ? 'ON' : 'OFF'}
                      </button>

                      {/* Default open-play session time */}
                      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5">
                        <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <select
                          value={defaultOpenDuration === null ? 'none' : String(defaultOpenDuration)}
                          onChange={e => setDefaultOpenDuration(e.target.value === 'none' ? null : Number(e.target.value))}
                          className="bg-transparent text-sm font-semibold text-zinc-300 focus:outline-none cursor-pointer"
                          title="Default open-play session time — applied when auto-assigning"
                        >
                          <option value="none">No timer</option>
                          <option value="10">10 min</option>
                          <option value="15">15 min</option>
                          <option value="20">20 min</option>
                          <option value="30">30 min</option>
                          <option value="45">45 min</option>
                          <option value="60">60 min</option>
                        </select>
                      </div>

                      {/* Competitive mode */}
                      <button
                        onClick={() => setCompetitiveMode(v => !v)}
                        className={`px-3 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 transition ${
                          competitiveMode
                            ? 'bg-rose-500 text-zinc-950 border-rose-400 hover:bg-rose-400'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={competitiveMode
                          ? 'Competitive mode ON — winners tracked, leaderboard active'
                          : 'Casual mode — no winner tracking, courts auto-clear when timer ends'}
                      >
                        <Trophy className="w-4 h-4" />
                        {competitiveMode ? 'Competitive' : 'Casual'}
                      </button>

                      {competitiveMode && (
                        <button
                          onClick={() => setShowLeaderboard(true)}
                          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        >
                          <Crown className="w-4 h-4" /> Leaderboard
                        </button>
                      )}
                    </div>

                    <Divider />

                    {/* RIGHT — display link, announce, log, reset, sign out */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setShowDisplayLink(true)}
                        className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title="Get the link to open on your TV"
                      >
                        <Monitor className="w-4 h-4" /> Display Link
                      </button>

                      <button
                        onClick={() => setShowAnnouncementBar(v => !v)}
                        className={`px-3 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2 transition ${
                          announcement
                            ? 'bg-lime-400 text-zinc-950 border-lime-300 hover:bg-lime-300'
                            : showAnnouncementBar
                            ? 'bg-zinc-800 border-zinc-600 text-zinc-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="Broadcast announcement to the customer display screen"
                      >
                        <Megaphone className="w-4 h-4" />
                        {announcement ? 'Announcement' : 'Announce'}
                      </button>

                      <button
                        onClick={() => setShowActivityLog(true)}
                        className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2"
                        title="Check-in, checkout and payment history"
                      >
                        <ClipboardList className="w-4 h-4" /> Log
                      </button>

                      <button
                        onClick={resetSession}
                        className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-rose-950 hover:text-rose-300 hover:border-rose-900 text-sm font-semibold flex items-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" /> Reset
                      </button>

                      <button
                        onClick={signOut}
                        className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-200 text-sm font-semibold flex items-center gap-2"
                        title="Sign out"
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
          <div className="border-t border-zinc-800 bg-zinc-900 px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3">
              <Megaphone className="w-4 h-4 text-lime-400 shrink-0" />
              <input
                value={announcement}
                onChange={e => setAnnouncement(e.target.value)}
                placeholder="Type a message for the customer display..."
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-lime-500"
                autoFocus
              />
              {announcement && (
                <button
                  onClick={() => setAnnouncement('')}
                  className="text-zinc-500 hover:text-rose-400 shrink-0"
                  title="Clear announcement"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setShowAnnouncementBar(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 font-semibold px-3 py-1.5 rounded border border-zinc-700 hover:border-zinc-500 shrink-0"
              >
                Done
              </button>
            </div>
            {announcement && (
              <p className="text-xs text-lime-500 mt-1.5 ml-7">Live on customer display</p>
            )}
          </div>
        )}
      </header>

      {/* ── VIEWS ─────────────────────────────── */}
      {view === 'staff' ? (
        <StaffView
          competitiveMode={competitiveMode}
          autoAssign={autoAssign}
          players={players}
          filteredPlayers={filteredPlayers}
          courts={courts}
          queue={queue}
          draftGroup={draftGroup}
          busyPlayerIds={busyPlayerIds}
          search={search}
          newPlayerName={newPlayerName}
          newPlayerSkill={newPlayerSkill}
          newPlayerPayment={newPlayerPayment}
          avgGameDurationMs={avgGameDurationMs}
          openPlayCourtCount={openPlayCourtCount}
          setSearch={setSearch}
          setNewPlayerName={setNewPlayerName}
          setNewPlayerSkill={setNewPlayerSkill}
          setNewPlayerPayment={setNewPlayerPayment}
          addPlayer={addPlayer}
          removePlayer={removePlayer}
          setPlayerPayment={setPlayerPayment}
          togglePlayerInDraft={togglePlayerInDraft}
          saveDraftGroup={saveDraftGroup}
          autoGroup={autoGroup}
          setShowAssign={setShowAssign}
          setShowRental={setShowRental}
          removeFromQueue={removeFromQueue}
          addPlayerToQueueGroup={addPlayerToQueueGroup}
          draggingPlayerId={draggingPlayerId}
          setDraggingPlayerId={setDraggingPlayerId}
          setFinishingCourt={setFinishingCourt}
          clearCourtCasual={clearCourtCasual}
          markArrived={markArrived}
          removeNoShow={removeNoShow}
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
          avgGameDurationMs={avgGameDurationMs}
          openPlayCourtCount={openPlayCourtCount}
          playerById={playerById}
        />
      )}

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
      {checkoutData && (
        <CheckoutModal
          data={checkoutData}
          playerById={playerById}
          onSetPayment={setPlayerPayment}
          onComplete={completeCheckout}
          onClose={() => setCheckoutData(null)}
        />
      )}
      {showActivityLog && (
        <ActivityLogModal
          auditLog={auditLog}
          onClose={() => setShowActivityLog(false)}
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
          onRegenerate={regenerateDisplayLink}
          onClose={() => setShowDisplayLink(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   DISPLAY LINK
   ───────────────────────────────────────────── */
function DisplayLinkModal({ token, onRegenerate, onClose }) {
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
    <ModalShell onClose={onClose} title="Customer Display">
      <p className="text-zinc-400 text-sm mb-4">
        Open this link in the browser on your TV, then put it full screen. It updates
        live and is read-only — nobody can change anything from it.
      </p>

      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 mb-3">
        <code className="text-lime-400 text-xs break-all leading-relaxed">{url}</code>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <button
          onClick={copy}
          className="flex-1 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition"
        >
          {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy link</>}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition"
        >
          <ExternalLink className="w-4 h-4" /> Open
        </a>
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <button
          onClick={onRegenerate}
          className="text-zinc-500 hover:text-rose-400 text-xs font-semibold flex items-center gap-2 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Generate a new link
        </button>
        <p className="text-zinc-600 text-xs mt-1.5">
          Use this if the link was shared somewhere it shouldn’t have been. The old
          one stops working straight away.
        </p>
      </div>
    </ModalShell>
  );
}

// Module-level: set synchronously in onDragStart so dragover handlers can read it
// without waiting for a React state update (which would be deferred and stale).
let _dragId = null;

/* ─────────────────────────────────────────────
   STAFF VIEW
   ───────────────────────────────────────────── */
function StaffView(props) {
  const {
    competitiveMode, autoAssign,
    players, filteredPlayers, courts, queue, draftGroup, busyPlayerIds,
    search, newPlayerName, newPlayerSkill, newPlayerPayment,
    avgGameDurationMs, openPlayCourtCount,
    setSearch, setNewPlayerName, setNewPlayerSkill, setNewPlayerPayment,
    addPlayer, removePlayer, setPlayerPayment, togglePlayerInDraft, saveDraftGroup, autoGroup,
    setShowAssign, setShowRental, removeFromQueue, addPlayerToQueueGroup,
    draggingPlayerId, setDraggingPlayerId,
    setFinishingCourt, clearCourtCasual, markArrived, removeNoShow,
    addCourt, removeCourt, toggleCourtType, renameCourt, playerById,
  } = props;

  const [dragOverZone, setDragOverZone] = useState(null);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* COURTS */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl text-zinc-300 tracking-wide">COURTS</h2>
            {autoAssign && (
              <span className="text-xs font-bold text-cyan-400 bg-cyan-950 border border-cyan-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Zap className="w-3 h-3" /> AUTO-FILLING
              </span>
            )}
          </div>
          <button
            onClick={addCourt}
            className="text-sm font-semibold text-lime-400 hover:text-lime-300 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add court
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {courts.map(court => (
            <CourtCardStaff
              key={court.id}
              competitiveMode={competitiveMode}
              court={court}
              playerById={playerById}
              onFinish={() => setFinishingCourt(court.id)}
              onClear={() => clearCourtCasual(court.id)}
              onRemove={() => removeCourt(court.id)}
              onToggleType={() => toggleCourtType(court.id)}
              onRename={(name) => renameCourt(court.id, name)}
              onBookRental={() => setShowRental(court.id)}
              onArrived={() => markArrived(court.id)}
              onNoShow={() => removeNoShow(court.id)}
            />
          ))}
        </div>
      </section>

      {/* ROSTER + GROUP BUILDER + QUEUE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ROSTER */}
        <section className="lg:col-span-4">
          <h2 className="font-display text-xl text-zinc-300 tracking-wide mb-3">ROSTER</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="p-3.5 border-b border-zinc-800 space-y-2.5">
              <div className="flex gap-2">
                <input
                  value={newPlayerName}
                  onChange={e => setNewPlayerName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPlayer()}
                  placeholder="New player name..."
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-lime-500"
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
                  title="Add player"
                >
                  <UserPlus className="w-4 h-4" />
                </button>
              </div>
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
                        className={`flex-1 text-[11px] font-bold py-1.5 rounded-md border transition flex items-center justify-center gap-1 ${
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
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search players..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-lime-500"
                />
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredPlayers.length === 0 && (
                <p className="p-4 text-sm text-zinc-500 text-center">No players match.</p>
              )}
              {filteredPlayers.map(p => {
                const busy = busyPlayerIds.has(p.id);
                const inDraft = draftGroup.includes(p.id);
                const canDrag = !busy && !inDraft;
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
                    onDragEnd={() => { _dragId = null; setDraggingPlayerId(null); setDragOverZone(null); }}
                    className={`px-3.5 py-2.5 flex items-center gap-2.5 border-b border-zinc-800 last:border-0 transition ${
                      busy ? 'opacity-40' : 'hover:bg-zinc-800'
                    } ${inDraft ? 'bg-lime-950' : ''} ${
                      draggingPlayerId === p.id ? 'opacity-40' : ''
                    } ${canDrag ? 'cursor-grab' : 'cursor-pointer'}`}
                    onClick={() => !busy && togglePlayerInDraft(p.id)}
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-zinc-500">
                        {p.skill} • {p.wins}W {p.losses}L
                      </div>
                    </div>
                    {/* Payment badge doubles as the editor (spec §2, §8) */}
                    <PaymentEditor payment={p.payment} onChange={(status) => setPlayerPayment(p.id, status)} />
                    {inDraft && <Check className="w-4 h-4 text-lime-400 shrink-0" />}
                    {busy && (
                      <span className="text-xs text-zinc-500 shrink-0">
                        {courts.some(c => c.match?.players.includes(p.id)) ? 'Playing' : 'Queued'}
                      </span>
                    )}
                    {!busy && (
                      <button
                        onClick={e => { e.stopPropagation(); removePlayer(p.id); }}
                        className="text-zinc-600 hover:text-rose-400 p-2 -m-1 shrink-0"
                        title={`Remove ${p.name}`}
                        aria-label={`Remove ${p.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-800">
              {players.length} total · {players.length - busyPlayerIds.size} available
            </div>
          </div>
        </section>

        {/* GROUP BUILDER */}
        <section className="lg:col-span-4">
          <h2 className="font-display text-xl text-zinc-300 tracking-wide mb-3">GROUP BUILDER</h2>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
            <p className="text-sm text-zinc-400">
              Click roster names to add. <span className="text-zinc-500">{draftGroup.length}/4 selected.</span>
            </p>
            <div
              className={`space-y-2 min-h-[8rem] rounded-lg p-1 transition ${
                dragOverZone === 'builder' ? 'bg-lime-950/30 ring-2 ring-lime-600' : ''
              }`}
              onDragOver={e => {
                if (!_dragId || draftGroup.length >= 4 || draftGroup.includes(_dragId)) return;
                e.preventDefault();
                setDragOverZone('builder');
              }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverZone(null); }}
              onDrop={e => {
                e.preventDefault();
                setDragOverZone(null);
                const id = _dragId || Number(e.dataTransfer.getData('text/plain'));
                if (id && !draftGroup.includes(id) && draftGroup.length < 4)
                  togglePlayerInDraft(id);
              }}
            >
              {draftGroup.length === 0 && (
                <div className={`text-sm text-center py-8 border border-dashed rounded-lg transition ${
                  draggingPlayerId
                    ? 'text-lime-400 border-lime-600 bg-lime-950/20'
                    : 'text-zinc-600 italic border-zinc-800'
                }`}>
                  {draggingPlayerId ? 'Drop player here' : 'No players selected'}
                </div>
              )}
              {draftGroup.map(id => {
                const p = playerById(id);
                if (!p) return null;
                return (
                  <div key={id} className="flex items-center gap-2 bg-zinc-950 rounded-lg p-2 border border-zinc-800">
                    <span className={`text-xs px-2 py-0.5 rounded border ${skillStyle(p.skill)}`}>{p.skill}</span>
                    <span className="flex-1 text-sm font-semibold truncate">{p.name}</span>
                    <PaymentBadge payment={p.payment} />
                    <button onClick={() => togglePlayerInDraft(id)} className="text-zinc-500 hover:text-rose-400 shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveDraftGroup}
                disabled={draftGroup.length === 0}
                className="flex-1 bg-lime-400 text-zinc-950 font-bold py-2.5 rounded-lg hover:bg-lime-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Users className="w-4 h-4" /> Save group
              </button>
              <button
                onClick={autoGroup}
                className="bg-zinc-800 text-zinc-200 font-semibold py-2.5 px-4 rounded-lg hover:bg-zinc-700 flex items-center gap-2"
                title="Auto-group 4 available players with balanced teams"
              >
                <Shuffle className="w-4 h-4" /> Auto
              </button>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              <strong className="text-zinc-500">Auto</strong> picks 4 players and balances teams (best+worst vs 2nd+3rd).
              Save groups with fewer than 4 to hold spots for arriving players.
            </p>
          </div>
        </section>

        {/* QUEUE */}
        <section className="lg:col-span-4">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="font-display text-xl text-zinc-300 tracking-wide">
              QUEUE <span className="text-zinc-600 text-base">({queue.length})</span>
            </h2>
            {openPlayCourtCount > 0 && (
              <span className="text-xs text-zinc-500 flex items-center gap-1">
                <Clock className="w-3 h-3" /> avg {fmtMinutes(avgGameDurationMs)}/game
              </span>
            )}
          </div>
          <div className="space-y-3">
            {queue.length === 0 && (
              <div className="text-sm text-zinc-500 italic flex items-center gap-2 px-4 py-2.5 border border-dashed border-zinc-800 rounded-lg">
                <Users className="w-4 h-4 text-zinc-600 shrink-0" /> No groups in queue
              </div>
            )}
            {queue.map((g, idx) => {
              const groupPlayers = g.players.map(playerById).filter(Boolean);
              const avgSkill = groupPlayers.length
                ? Math.round(groupPlayers.reduce((s, p) => s + skillRank(p.skill), 0) / groupPlayers.length)
                : 0;
              const estWaitMs = estimateWait(idx, openPlayCourtCount, avgGameDurationMs);
              const hasFreeCourt = courts.some(c => c.type === 'open' && !c.match);
              const isImmediateNext = idx === 0 && hasFreeCourt && groupPlayers.length >= 4;
              const unpaidCount = groupPlayers.filter(p => !isPaid(p.payment)).length;

              const canDrop = !!_dragId && groupPlayers.length < 4 && !g.players.includes(_dragId);
              return (
                <div
                  key={g.id}
                  className={`bg-zinc-900 rounded-xl border p-3 transition ${
                    dragOverZone === g.id
                      ? 'border-lime-500 ring-1 ring-lime-600 bg-lime-950/10'
                      : canDrop ? 'border-lime-800'
                      : 'border-zinc-800'
                  }`}
                  onDragOver={e => { if (!_dragId || !canDrop) return; e.preventDefault(); setDragOverZone(g.id); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverZone(null); }}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOverZone(null);
                    const id = _dragId || Number(e.dataTransfer.getData('text/plain'));
                    if (id && groupPlayers.length < 4 && !g.players.includes(id))
                      addPlayerToQueueGroup(g.id, id);
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-2xl text-lime-400">#{idx + 1}</span>
                      <span className="text-xs uppercase tracking-wider text-zinc-500">
                        {g.type === 'auto' ? 'Auto-grouped' : 'Manual'}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${skillStyleSolid(SKILL_TIERS[avgSkill])} bg-opacity-20 text-zinc-300`}>
                        avg {SKILL_TIERS[avgSkill]}
                      </span>
                      {unpaidCount > 0 && (
                        <span className="text-xs font-bold text-rose-300 bg-rose-950 border border-rose-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {unpaidCount} unpaid
                        </span>
                      )}
                      {isImmediateNext ? (
                        <span className="text-xs font-bold text-lime-400 bg-lime-950 border border-lime-800 px-2 py-0.5 rounded-full">
                          Now
                        </span>
                      ) : estWaitMs ? (
                        <span className="text-xs text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {fmtMinutes(estWaitMs)}
                        </span>
                      ) : null}
                    </div>
                    <button onClick={() => removeFromQueue(g.id)} className="text-zinc-600 hover:text-rose-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1 mb-3">
                    {groupPlayers.map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-sm">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${skillStyleSolid(p.skill)}`} />
                        <span className="flex-1 truncate">{p.name}</span>
                        <PaymentBadge payment={p.payment} dot title={`${p.name} — ${paymentInfo(p.payment).label}`} />
                      </div>
                    ))}
                    {groupPlayers.length < 4 && (
                      <div className={`text-xs italic ${canDrop ? 'text-lime-400' : 'text-amber-500'}`}>
                        {canDrop
                          ? `Drop to add here · ${4 - groupPlayers.length} spot${4 - groupPlayers.length > 1 ? 's' : ''} left`
                          : `Incomplete — ${4 - groupPlayers.length} more needed`}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAssign(g.id)}
                    disabled={groupPlayers.length < 4}
                    className="w-full bg-zinc-800 hover:bg-lime-400 hover:text-zinc-950 text-sm font-semibold py-2 rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-current"
                  >
                    Assign to court <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   PLAYER AVATAR
   ───────────────────────────────────────────── */
function PlayerAvatar({ player, size }) {
  const sizeClass =
    size === 'sm' ? 'w-7 h-7 text-[10px]' :
    size === 'lg' ? 'w-14 h-14 text-sm' :
    size === 'xl' ? 'w-24 h-24 text-xl' :
    'w-10 h-10 text-xs';
  const initials = player.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (player.photo) {
    return <img src={player.photo} alt={player.name} className={`${sizeClass} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${sizeClass} rounded-full flex items-center justify-center shrink-0 font-bold ${skillStyleSolid(player.skill)}`}>
      <span className="text-zinc-950">{initials}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   COURT CARD (STAFF) — double-click name to rename
   ───────────────────────────────────────────── */
function CourtCardStaff({ competitiveMode, court, playerById, onFinish, onClear, onRemove, onToggleType, onRename, onBookRental, onArrived, onNoShow }) {
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

  // No-show tracking (spec §7): a called group that hasn't been confirmed present.
  const awaitingArrival = isPlaying && !isRental && court.match.arrived === false;
  const calledAgoMs = awaitingArrival ? now - (court.match.calledAt ?? court.match.startedAt) : 0;
  const possibleNoShow = awaitingArrival && calledAgoMs >= NO_SHOW_MINUTES * 60_000;

  const borderClass = showTimeUp
    ? 'bg-rose-950 border-rose-600'
    : isPlaying && isRental ? 'bg-amber-950 border-amber-600'
    : isPlaying ? 'bg-lime-950 border-lime-700'
    : isRental ? 'bg-zinc-900 border-amber-800 border-dashed'
    : 'bg-zinc-900 border-zinc-800';

  return (
    <div className={`rounded-xl border-2 p-5 transition ${borderClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
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
              className="font-display text-2xl bg-transparent border-b-2 border-lime-400 outline-none w-28 text-zinc-100"
            />
          ) : (
            <h3
              className="font-display text-2xl cursor-pointer hover:text-lime-400 transition"
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

      {/* Type toggle + remove */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onToggleType}
          className={`text-[10px] font-bold tracking-wider px-2 py-1 rounded border transition flex-1 ${
            isRental
              ? 'bg-amber-950 border-amber-700 text-amber-300 hover:bg-amber-900'
              : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {isRental ? '◀ SWITCH TO OPEN PLAY' : 'SWITCH TO RENTAL ▶'}
        </button>
        {!isPlaying && (
          <button
            onClick={onRemove}
            className="text-zinc-600 hover:text-rose-400 p-2 -m-1 shrink-0"
            title="Remove court"
            aria-label={`Remove ${court.name}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {isPlaying ? (
        <>
          {/* No-show nudge (spec §7): staff confirm arrival or drop the group. */}
          {awaitingArrival && (
            <div className={`mb-3 rounded-lg border p-2.5 ${
              possibleNoShow ? 'bg-rose-950 border-rose-700' : 'bg-amber-950/40 border-amber-800'
            }`}>
              <div className={`flex items-center gap-1.5 text-xs font-bold mb-2 ${
                possibleNoShow ? 'text-rose-300' : 'text-amber-300'
              }`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {possibleNoShow
                  ? `Possible no-show — called ${fmtElapsed(calledAgoMs)} ago`
                  : 'Called — waiting for players'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onArrived}
                  className="flex-1 bg-lime-400 hover:bg-lime-300 text-zinc-950 text-xs font-bold py-1.5 rounded-md flex items-center justify-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> They're here
                </button>
                <button
                  onClick={onNoShow}
                  className={`flex-1 text-xs font-bold py-1.5 rounded-md flex items-center justify-center gap-1 transition ${
                    possibleNoShow
                      ? 'bg-rose-500 hover:bg-rose-400 text-zinc-950'
                      : 'bg-zinc-800 hover:bg-rose-900 text-zinc-300 hover:text-rose-200'
                  }`}
                >
                  <X className="w-3.5 h-3.5" /> No-show
                </button>
              </div>
            </div>
          )}
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
            /* Open play — 4-player grid */
            <div className="grid grid-cols-1 gap-1.5 mb-3">
              {court.match.players.map((id, i) => {
                const p = playerById(id);
                if (!p) return null;
                const teamLabel = i < 2 ? 'T1' : 'T2';
                return (
                  <div key={id} className="flex items-center gap-2 bg-zinc-950 bg-opacity-50 rounded px-2 py-1.5">
                    <span className="text-xs text-zinc-500 font-mono w-6">{teamLabel}</span>
                    <PlayerAvatar player={p} size="sm" />
                    <span className="text-sm font-semibold flex-1 truncate">{p.name}</span>
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
              className="w-full bg-zinc-950 hover:bg-zinc-100 hover:text-zinc-950 border border-zinc-700 text-sm font-bold py-2 rounded-lg transition"
            >
              FINISH MATCH
            </button>
          ) : (
            <button
              onClick={onClear}
              className="w-full bg-zinc-950 hover:bg-zinc-100 hover:text-zinc-950 border border-zinc-700 text-sm font-bold py-2 rounded-lg transition"
            >
              {isRental ? 'END RENTAL' : 'CLEAR COURT'}
            </button>
          )}
        </>
      ) : isRental ? (
        <button
          onClick={onBookRental}
          className="w-full mt-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Book Rental
        </button>
      ) : (
        <div className="text-center py-7 text-zinc-400 text-base italic">
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
export function DisplayView({ competitiveMode, courts, queue, history, announcement, avgGameDurationMs, openPlayCourtCount, playerById }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const activeCourts  = courts.filter(c => c.match).length;
  const playersOnCourt = courts.reduce((n, c) => n + (c.match ? c.match.players.length : 0), 0);
  const gamesServed   = history.length;
  const openCourts    = courts.filter(c => c.type === 'open' && !c.match).length;
  // Front-desk call-to-action: only worth shouting about when a court is free
  // AND nobody is already waiting for it (spec §6).
  const showCta       = openCourts > 0 && queue.length === 0;

  return (
    <div className="min-h-screen">
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

            return (
              <div key={court.id} className={`rounded-2xl border-2 overflow-hidden ${cardClass}`}>
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
                              <div className="font-display text-xl leading-tight">{p.name}</div>
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
                              <div className="font-display text-xl leading-tight">{p.name}</div>
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
                const estWaitMs = estimateWait(idx, openPlayCourtCount, avgGameDurationMs);
                const hasFreeCourt = courts.some(c => c.type === 'open' && !c.match);
                const isImmediateNext = idx === 0 && hasFreeCourt && groupPlayers.length >= 4;
                const isAutoBalanced = g.type === 'auto' && groupPlayers.length === 4;

                return (
                  <div
                    key={g.id}
                    className={`rounded-2xl p-5 border-2 transition ${
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
                      ) : estWaitMs ? (
                        <span className="text-sm text-zinc-300 bg-zinc-800 px-3 py-1.5 rounded-full flex items-center gap-1.5 mt-1">
                          <Clock className="w-3.5 h-3.5 text-zinc-500" />
                          {fmtMinutes(estWaitMs)}
                        </span>
                      ) : null}
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
                                <PaymentBadge payment={p.payment} dot title={paymentInfo(p.payment).label} />
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
                            <PaymentBadge payment={p.payment} dot title={paymentInfo(p.payment).label} />
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
  const openCourts = courts.filter(c => !c.match);

  return (
    <ModalShell onClose={onClose} title="Assign to court" wide>
      <div className="mb-4">
        <p className="text-sm text-zinc-400 mb-2">Group:</p>
        <div className="bg-zinc-950 rounded-lg p-2 space-y-1">
          {group.players.map(id => {
            const p = playerById(id);
            return p ? (
              <div key={id} className="text-sm">{p.name} <span className="text-zinc-500">· {p.skill}</span></div>
            ) : null;
          })}
        </div>
      </div>

      {openCourts.length === 0 ? (
        <p className="text-amber-400 text-sm py-4 text-center">No open courts. Finish a match first.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400 mb-2">Pick a court and duration:</p>
          {openCourts.map(c => {
            const isRental = c.type === 'rental';
            const durations = isRental ? RENTAL_DURATIONS : OPEN_DURATIONS;
            return (
              <div key={c.id} className={`rounded-lg p-3 border-2 ${
                isRental ? 'bg-amber-950 bg-opacity-30 border-amber-800 border-dashed' : 'bg-zinc-950 border-zinc-800'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg">{c.name}</span>
                    {isRental ? (
                      <span className="text-[10px] font-bold tracking-widest bg-amber-500 text-zinc-950 px-1.5 py-0.5 rounded">RENTAL</span>
                    ) : (
                      <span className="text-[10px] font-bold tracking-widest text-zinc-500">OPEN PLAY</span>
                    )}
                  </div>
                  {!isRental && !competitiveMode && defaultOpenDuration && (
                    <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" /> auto will use {defaultOpenDuration}m
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
                        title={isDefault ? 'This is your default session time' : undefined}
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
    <ModalShell onClose={onClose} title={`Finish ${court.name} — who won?`}>
      {/* Stacked on phones: these are big tap targets and player names wrap badly
          in two narrow columns. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => onFinish(1)}
          className="bg-zinc-900 border-2 border-zinc-800 hover:border-lime-500 hover:bg-lime-950 rounded-xl p-4 text-left transition"
        >
          <div className="text-xs text-zinc-500 font-bold mb-2">TEAM 1</div>
          <div className="font-display text-xl">{t1a?.name}</div>
          <div className="font-display text-xl">{t1b?.name}</div>
          <div className="mt-3 text-lime-400 text-xs font-bold">↳ MARK AS WINNER</div>
        </button>
        <button
          onClick={() => onFinish(2)}
          className="bg-zinc-900 border-2 border-zinc-800 hover:border-lime-500 hover:bg-lime-950 rounded-xl p-4 text-left transition"
        >
          <div className="text-xs text-zinc-500 font-bold mb-2">TEAM 2</div>
          <div className="font-display text-xl">{t2a?.name}</div>
          <div className="font-display text-xl">{t2b?.name}</div>
          <div className="mt-3 text-lime-400 text-xs font-bold">↳ MARK AS WINNER</div>
        </button>
      </div>
    </ModalShell>
  );
}

function LeaderboardModal({ leaderboard, history, onClose }) {
  return (
    <ModalShell onClose={onClose} title="Leaderboard" wide>
      {leaderboard.length === 0 ? (
        <p className="text-zinc-500 text-center py-8">No matches finished yet.</p>
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
        Total matches played: {history.length}
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   CHECKOUT (spec §3)
   Shown when a court session ends. Records each player's session length, flags
   anyone still unpaid, and lets staff take payment on the spot. It never blocks
   the checkout — the "Complete" button always works; the warning is just a nudge.
   ───────────────────────────────────────────── */
function CheckoutModal({ data, playerById, onSetPayment, onComplete, onClose }) {
  const { courtName, playerIds, startedAt, endedAt, winners } = data;
  const roster = playerIds.map(playerById).filter(Boolean);
  const unpaid = roster.filter(p => !isPaid(p.payment));
  const sessionMs = endedAt - startedAt;
  const winnerSet = new Set(winners ?? []);

  return (
    <ModalShell onClose={onClose} title={`Checkout — ${courtName}`} wide>
      <div className="flex items-center gap-3 mb-4 text-sm">
        <span className="flex items-center gap-1.5 text-zinc-300">
          <Clock className="w-4 h-4 text-zinc-500" />
          Session length: <span className="font-semibold text-lime-400">{fmtDuration(sessionMs)}</span>
        </span>
      </div>

      {unpaid.length > 0 && (
        <div className="bg-rose-950 border border-rose-700 rounded-lg p-3 mb-4 flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-200">
            <p className="font-bold mb-0.5">
              {unpaid.length === 1
                ? `${unpaid[0].name} hasn't paid yet.`
                : `${unpaid.length} players haven't paid yet.`}
            </p>
            <p className="text-rose-300/90 text-xs">Collect payment below before closing the session.</p>
          </div>
        </div>
      )}

      <div className="space-y-2 mb-5">
        {roster.map(p => {
          const info = paymentInfo(p.payment);
          const paid = isPaid(p.payment);
          const checkedIn = new Date(p.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-3 ${paid ? 'bg-zinc-950 border-zinc-800' : 'bg-rose-950/40 border-rose-900'}`}
            >
              <div className="flex items-center gap-2.5">
                <PlayerAvatar player={p} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <span className="truncate">{p.name}</span>
                    {winnerSet.has(p.id) && (
                      <span className="text-[10px] font-bold text-amber-300 flex items-center gap-0.5 shrink-0">
                        <Crown className="w-3 h-3" /> WON
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    In {checkedIn} · here {fmtDuration(endedAt - p.checkedInAt)}
                  </div>
                </div>
                <PaymentBadge payment={p.payment} title={info.label} />
              </div>
              {!paid && (
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => onSetPayment(p.id, 'online')}
                    className="flex-1 text-xs font-bold py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Paid — Online
                  </button>
                  <button
                    onClick={() => onSetPayment(p.id, 'cash')}
                    className="flex-1 text-xs font-bold py-1.5 rounded-md bg-amber-400 hover:bg-amber-300 text-zinc-950 flex items-center justify-center gap-1"
                  >
                    <DollarSign className="w-3.5 h-3.5" /> Paid — Cash
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={onComplete}
        className="w-full bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition"
      >
        <Check className="w-4 h-4" />
        {unpaid.length > 0 ? 'Complete checkout anyway' : 'Complete checkout'}
      </button>
    </ModalShell>
  );
}

/* ─────────────────────────────────────────────
   ACTIVITY LOG (spec §9)
   A simple reverse-chronological list of check-ins, checkouts, payment changes
   and no-shows. Kept lightweight — a review list, not an analytics surface.
   ───────────────────────────────────────────── */
const AUDIT_META = {
  checkin:  { icon: LogIn,         color: 'text-cyan-400',    label: 'Checked in' },
  checkout: { icon: LogOut,        color: 'text-zinc-300',    label: 'Checked out' },
  payment:  { icon: DollarSign,    color: 'text-amber-400',   label: 'Payment updated' },
  noshow:   { icon: AlertTriangle, color: 'text-rose-400',    label: 'No-show removed' },
};

function ActivityLogModal({ auditLog, onClose }) {
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const describe = (e) => {
    switch (e.type) {
      case 'checkin':
        return `${e.payment ? paymentInfo(e.payment).label : 'Unpaid'}`;
      case 'checkout':
        return `${e.courtName ? e.courtName + ' · ' : ''}here ${fmtDuration(e.sessionMs ?? 0)} · ${paymentInfo(e.payment).label}`;
      case 'payment':
        return `→ ${paymentInfo(e.payment).label}`;
      case 'noshow':
        return e.courtName ? `from ${e.courtName}` : '';
      default:
        return '';
    }
  };

  return (
    <ModalShell onClose={onClose} title="Activity Log" wide>
      {auditLog.length === 0 ? (
        <p className="text-zinc-500 text-center py-10">No activity yet today.</p>
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
      <p className="text-xs text-zinc-600 mt-4 pt-3 border-t border-zinc-800">
        Showing this session's events (most recent first). Cleared on session reset.
      </p>
    </ModalShell>
  );
}

function RentalModal({ court, players, busyPlayerIds, onBook, onClose }) {
  const [search, setSearch]     = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [duration, setDuration] = useState(60);

  const available = players
    .filter(p => !busyPlayerIds.has(p.id))
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ModalShell onClose={onClose} title={`Book ${court?.name ?? 'Rental'}`}>
      <p className="text-sm text-zinc-400 mb-3">Pick one person as the host for this rental:</p>

      {/* Player search */}
      <div className="relative mb-2">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search players..."
          className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
      </div>
      <div className="max-h-44 overflow-y-auto bg-zinc-950 rounded-lg p-1 mb-4">
        {available.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-4">No available players.</p>
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
      <p className="text-sm text-zinc-400 mb-2">Duration:</p>
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
          Booking for <span className="text-amber-400 font-semibold">{players.find(p => p.id === selectedId)?.name}'s Party</span>
        </div>
      )}
      <button
        onClick={() => selectedId && onBook(selectedId, duration)}
        disabled={!selectedId}
        className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-3 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition"
      >
        Confirm Booking
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
    <ModalShell onClose={onClose} title={`Photo for ${playerName}`}>
      <canvas ref={canvasRef} className="hidden" />
      {captured ? (
        <div className="text-center">
          <img src={captured} alt="Preview" className="w-48 h-48 rounded-full object-cover mx-auto mb-5 border-4 border-lime-500" />
          <div className="flex gap-3 justify-center">
            <button onClick={retake} className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-lg flex items-center gap-2">
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            <button onClick={() => onSave(captured)} className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4" /> Save Photo
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
              Skip
            </button>
            <button onClick={capture} className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold rounded-lg flex items-center gap-2">
              <Camera className="w-4 h-4" /> Take Photo
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function ModalShell({ children, onClose, title, wide }) {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto overscroll-contain`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-2xl">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
