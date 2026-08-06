import React, { useState } from 'react';
import { Users, Shuffle, Check, ChevronRight, Plus } from 'lucide-react';
import ModalShell from './ModalShell';
import { SKILL_TIERS, MATCHING_STYLE_ORDER, matchingStyleInfo } from '../lib/logic';
import { buttons, wizard as t } from '../copy';

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
    <ModalShell onClose={onClose} title={t.title} wide>
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
      <p className="text-xs text-zinc-500 font-semibold mb-5">{t.stepCounter(step, TOTAL)}</p>

      {/* ── Step 1 — courts & matching style ── */}
      {step === 1 && (
        <div className="cf-fade-up">
          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">{t.courtsHeading}</h4>
          <p className="text-zinc-500 text-sm mb-3">{t.courtsBody}</p>

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
            <span className="text-zinc-500 text-sm">{t.courtsUnit}</span>
          </div>

          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">{t.matchingHeading}</h4>
          <p className="text-zinc-500 text-sm mb-3">
            {t.matchingBodyBefore}{' '}
            <span className="text-zinc-300 font-semibold">{t.matchingBodyButton}</span>{' '}
            {t.matchingBodyAfter}
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
          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">{t.playersHeading}</h4>
          <p className="text-zinc-500 text-sm mb-3">{t.playersBody}</p>

          <form onSubmit={submitPlayer} className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              autoFocus
              value={newPlayerName}
              onChange={e => setNewPlayerName(e.target.value)}
              placeholder={t.playerPlaceholder}
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
              <Plus className="w-4 h-4" /> {t.addPlayer}
            </button>
          </form>

          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 max-h-56 overflow-y-auto">
            {players.length === 0 ? (
              <p className="text-zinc-600 text-sm italic text-center py-4">{t.noPlayersYet}</p>
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
              {t.checkedInCount(players.length)}
            </span>
            {players.length < 4 && <span className="text-zinc-500">{t.needFour}</span>}
          </p>
        </div>
      )}

      {/* ── Step 3 — summary ── */}
      {step === 3 && (
        <div className="cf-fade-up">
          <h4 className="font-display text-xl text-zinc-200 tracking-wide mb-1">{t.doneHeading}</h4>
          <p className="text-zinc-500 text-sm mb-4">{t.doneBody}</p>

          <div className="grid grid-cols-3 gap-2 mb-5">
            <Stat label={t.statCourts} value={courtCount} />
            <Stat label={t.statPlayers} value={players.length} />
            <Stat label={t.statMatching} value={matchingStyleInfo(matchingStyle).short} small />
          </div>

          <button
            onClick={onFinish}
            className="w-full bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition"
          >
            {t.start} <ChevronRight className="w-4 h-4" strokeWidth={3} />
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
              {buttons.back}
            </button>
          )}
          <button
            onClick={next}
            className="ml-auto bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold px-6 py-2 rounded-lg flex items-center gap-2 transition"
          >
            {buttons.next} <ChevronRight className="w-4 h-4" strokeWidth={3} />
          </button>
        </div>
      )}
      {step === TOTAL && (
        <div className="flex mt-4">
          <button
            onClick={back}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-4 py-2 rounded-lg transition"
          >
            {buttons.back}
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
