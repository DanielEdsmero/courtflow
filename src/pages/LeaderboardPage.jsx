import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Crown, Medal, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthProvider';
import { listPlayers, countMatchHistory } from '../lib/players';
import { allTimeLeaderboard, gamesToRank, RANKED_MIN_GAMES } from '../lib/logic';
import { brand, buttons, screens, allTime } from '../copy';

/* ─────────────────────────────────────────────
   ALL-TIME RANKINGS (spec §F3)
   Its own route rather than a modal like the session Leaderboard, because this
   reads the durable players.total_* columns and the permanent match_history —
   nothing here belongs to the session blob, so it doesn't need the staff app's
   state to render.
   ───────────────────────────────────────────── */
export default function LeaderboardPage() {
  const { venue } = useAuth();
  const [rows, setRows] = useState(null);
  const [venueGames, setVenueGames] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);

    // Both reads are independent, so pay for one round-trip rather than two.
    Promise.all([listPlayers(venue.id), countMatchHistory(venue.id)])
      .then(([players, count]) => {
        if (cancelled) return;
        setRows(players);
        setVenueGames(count);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load rankings:', err);
        setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [venue.id, reloadNonce]);

  const board = useMemo(() => allTimeLeaderboard(rows ?? []), [rows]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  if (loadFailed) {
    return (
      <div className="font-body min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 text-center">
        <div>
          <div className="font-display text-4xl text-lime-400 mb-3">{brand.name}</div>
          <p className="text-zinc-300 mb-1">{screens.rankingsLoadFailed.title}</p>
          <p className="text-zinc-500 text-sm mb-6 max-w-xs">
            {screens.rankingsLoadFailed.body}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={retry}
              className="bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold px-6 py-2.5 rounded-lg transition"
            >
              {buttons.tryAgain}
            </button>
            <Link
              to="/"
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-6 py-2.5 rounded-lg transition"
            >
              {buttons.back}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="font-body min-h-screen bg-zinc-950 text-zinc-100">
      {/* Same header shape as the staff app, so moving between them doesn't
          feel like leaving the product. */}
      <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-30">
        <div className="px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-lime-400 rounded-md flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-zinc-950" strokeWidth={3} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl text-lime-400 leading-none">{brand.name}</h1>
              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{venue.name}</p>
            </div>
          </div>

          <Link
            to="/"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 text-sm font-semibold flex items-center gap-2 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" /> {buttons.back}
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-2 mb-4">
          <Medal className="w-5 h-5 text-lime-400 shrink-0" />
          <h2 className="font-display text-xl text-zinc-200 tracking-wide">{allTime.heading}</h2>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard
            icon={<Users className="w-4 h-4" />}
            label={allTime.statPlayers}
            value={board.totalPlayers}
          />
          {/* Venue games, from match_history — NOT board.totalGames, which counts
              player-games and so reads about four times higher for doubles. */}
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label={allTime.statGames}
            value={venueGames}
          />
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3 sm:p-4">
          {rows === null ? (
            <p className="text-zinc-500 text-center py-8 cf-breathe">{screens.loading}</p>
          ) : board.ranked.length === 0 ? (
            /* Two different empty states, and conflating them produced the
               contradiction this page used to show ("nobody qualifies yet" sat
               directly above "everyone who has played is ranked"). Nobody
               qualifying is only worth explaining when somebody is actually
               working towards it — otherwise the roster is simply empty. */
            <p className="text-zinc-500 text-center py-8">
              {board.unranked.length > 0
                ? allTime.noneQualified(RANKED_MIN_GAMES)
                : allTime.noGamesAtAll}
            </p>
          ) : (
            <div className="space-y-1">
              {board.ranked.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 bg-zinc-950 rounded-lg px-3 py-2 cf-slide-in"
                  style={{ '--cf-delay': `${Math.min(i, 12) * 25}ms` }}
                >
                  <span
                    className={`font-display text-2xl w-10 ${
                      i === 0
                        ? 'text-amber-400'
                        : i === 1
                        ? 'text-zinc-300'
                        : i === 2
                        ? 'text-amber-700'
                        : 'text-zinc-600'
                    }`}
                  >
                    {i === 0 ? <Crown className="w-6 h-6" /> : `#${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-zinc-500">{p.skill}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-2xl text-lime-400">
                      {Math.round(p.rate * 100)}%
                    </div>
                    <div className="text-xs text-zinc-500">
                      {p.wins}W {p.defeats}L · {p.games} games
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Only rendered when there is something to put in it — an empty
              section under an empty ranking is what created the contradiction. */}
          {rows !== null && board.unranked.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold tracking-widest mb-2">
                {allTime.unrankedHeading}
              </div>
              {(
                <>
                  <div className="space-y-1">
                    {board.unranked.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-1.5 text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-zinc-300 truncate">{p.name}</span>
                          <span className="text-zinc-600"> · {p.skill}</span>
                        </div>
                        {/* Their record matters to them even before it counts for
                            ranking — showing only "3/10 games" hid it. */}
                        <span className="text-zinc-400 shrink-0 tabular-nums">
                          {p.wins}W {p.defeats}L
                        </span>
                        <span className="text-zinc-500 shrink-0 text-xs w-36 text-right">
                          {gamesToRank(p.games)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-2">
                    {allTime.unrankedFooter(RANKED_MIN_GAMES)}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 cf-fade-up">
      <div className="flex items-center gap-2 text-zinc-500 text-xs font-bold tracking-widest mb-1">
        {icon} {label.toUpperCase()}
      </div>
      <div className="font-display text-3xl text-zinc-100">{value}</div>
    </div>
  );
}
