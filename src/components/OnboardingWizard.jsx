import React, { useState } from 'react';
import { Users, Shuffle, Check, ChevronRight, Plus } from 'lucide-react';
import ModalShell from './ModalShell';
import { SKILL_TIERS, MATCHING_STYLE_ORDER, matchingStyleInfo } from '../lib/logic';

/* ─────────────────────────────────────────────
   ONBOARDING WIZARD (spec §F5)
   Three steps a new venue — or a staff member on their first shift — can follow
   without training: set the floor up, get some names in, start play.

   It drives App's real state setters rather than keeping its own copy, so
   everything it does is immediately live behind the modal and is persisted by
   the normal session-blob write. In particular `addPlayer` is App's actual
   check-in path, so the photo prompt, duplicate handling and audit log all still
   fire exactly as they do from the roster panel.
   ───────────────────────────────────────────── */
export default function OnboardingWizard({
  courtCount, setCourtCount,
  matchingStyle, setMatchingStyle,
  players,
  newPlayerName, setNewPlayerName,
  newPlayerSkill, setNewPlayerSkill,
  addPlayer,
  onFinish, onClose,
}) {
  const [step, setStep] = useState(1);
  const TOTAL = 3;

  const next = () => setStep(s => Math.min(TOTAL, s + 1));
  const back = () => setStep(s => Math.max(1, s - 1));

  // addPlayer is async and clears the name field itself. Never call it from the
  // Next button or an unmount — that would double-add whatever is in the box.
  const submitPlayer = (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    addPlayer();
  };

  return (
    <ModalShell onClose={onClose} title="Set up open play" wide>
      {/* ── Progress ── */}
      <div className="flex items-center gap-2 mb-1">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i <= step ? 'bg-lime-400' : 'bg-zinc-800'
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-500 font-semibold mb-5">Step {step} of {TOTAL}</p>

      {/* ── Step 1 — courts & matching style ── */}
      {step === 1 && (
        <div className="cf-fade-up">
          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">Your courts</h4>
          <p className="text-zinc-500 text-sm mb-3">
            How many courts are you running today? You can add or rename them later.
          </p>

          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setCourtCount(courtCount - 1)}
              disabled={courtCount <= 1}
              className="w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xl disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              −
            </button>
            <div className="font-display text-4xl text-lime-400 w-16 text-center">{courtCount}</div>
            <button
              onClick={() => setCourtCount(courtCount + 1)}
              disabled={courtCount >= 12}
              className="w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xl disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              +
            </button>
            <span className="text-zinc-500 text-sm">courts</span>
          </div>

          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">Matching style</h4>
          <p className="text-zinc-500 text-sm mb-3">
            How the <span className="text-zinc-300 font-semibold">Auto</span> button builds a group.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MATCHING_STYLE_ORDER.map(s => {
              const info = matchingStyleInfo(s);
              const active = matchingStyle === s;
              return (
                <button
                  key={s}
                  onClick={() => setMatchingStyle(s)}
                  className={`rounded-xl border-2 p-4 text-left transition ${
                    active
                      ? 'border-lime-500 bg-lime-950'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Shuffle className={`w-4 h-4 ${active ? 'text-lime-400' : 'text-zinc-500'}`} />
                    <span className="font-display text-lg">{info.label}</span>
                    {active && <Check className="w-4 h-4 text-lime-400 ml-auto" strokeWidth={3} />}
                  </div>
                  <p className="text-zinc-400 text-xs leading-relaxed">{info.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Step 2 — roster ── */}
      {step === 2 && (
        <div className="cf-fade-up">
          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">Add players</h4>
          <p className="text-zinc-500 text-sm mb-3">
            Get a few names in now — you'll check the rest in at the desk as they arrive.
          </p>

          <form onSubmit={submitPlayer} className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              autoFocus
              value={newPlayerName}
              onChange={e => setNewPlayerName(e.target.value)}
              placeholder="Player name…"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-lime-500"
            />
            <select
              value={newPlayerSkill}
              onChange={e => setNewPlayerSkill(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-lime-500"
            >
              {SKILL_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              type="submit"
              disabled={!newPlayerName.trim()}
              className="bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>

          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 max-h-56 overflow-y-auto">
            {players.length === 0 ? (
              <p className="text-zinc-600 text-sm italic text-center py-4">
                Nobody checked in yet.
              </p>
            ) : (
              <div className="space-y-1">
                {players.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <Check className="w-3.5 h-3.5 text-lime-400 shrink-0" strokeWidth={3} />
                    <span className="font-semibold flex-1 truncate">{p.name}</span>
                    <span className="text-[11px] text-zinc-500">{p.skill}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs mt-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-zinc-600" />
            <span className={players.length >= 4 ? 'text-lime-400' : 'text-zinc-500'}>
              {players.length} checked in
            </span>
            {players.length < 4 && (
              <span className="text-zinc-500">— you need at least 4 to start a game.</span>
            )}
          </p>
        </div>
      )}

      {/* ── Step 3 — summary ── */}
      {step === 3 && (
        <div className="cf-fade-up">
          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">You're all set</h4>
          <p className="text-zinc-500 text-sm mb-4">
            Check-in players at the desk, build a group, and CourtFlow fills the courts
            as they free up.
          </p>

          <div className="grid grid-cols-3 gap-2 mb-5">
            <Stat label="Courts" value={courtCount} />
            <Stat label="Players" value={players.length} />
            <Stat label="Matching" value={matchingStyleInfo(matchingStyle).short} small />
          </div>

          <button
            onClick={onFinish}
            className="w-full bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition"
          >
            Start Open Play <ChevronRight className="w-4 h-4" strokeWidth={3} />
          </button>
        </div>
      )}

      {/* ── Footer ── */}
      {step < TOTAL && (
        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-zinc-800">
          {step > 1 && (
            <button
              onClick={back}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-4 py-2 rounded-lg transition"
            >
              Back
            </button>
          )}
          <button
            onClick={next}
            className="ml-auto bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold px-6 py-2 rounded-lg flex items-center gap-2 transition"
          >
            Next <ChevronRight className="w-4 h-4" strokeWidth={3} />
          </button>
        </div>
      )}
      {step === TOTAL && (
        <div className="flex mt-4">
          <button
            onClick={back}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-4 py-2 rounded-lg transition"
          >
            Back
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function Stat({ label, value, small }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-3 text-center">
      <div className={`font-display text-lime-400 leading-none ${small ? 'text-lg' : 'text-3xl'}`}>
        {value}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1.5 tracking-wide">{label}</div>
    </div>
  );
}
