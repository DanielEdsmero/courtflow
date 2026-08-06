/* Three separate boards, easy to mix up:
     · sessionRank — today only, opened from the toolbar's "Session Rank"
     · leaderboardModal — the older in-app pop-up, today's wins and win rate
     · allTime — the full /leaderboard page, every session ever */

// Toolbar → "Session Rank". Never shows the hidden value.
export const sessionRank = {
  title: 'Session Rankings',
  empty: 'No games finished yet this session.',
  colRank: '#',
  colPlayer: 'Player',
  colRecord: 'W — L',
  colStreak: 'Streak',
  streakTitle: 'Most recent game first',
  footer: 'This session only — clears on reset. All-time rankings live on the Rankings page.',
};

export const leaderboardModal = {
  title: 'Leaderboard',
  empty: 'No matches finished yet.',
  totalMatches: (n) => `Total matches played: ${n}`,
};

// The /leaderboard page.
export const allTime = {
  heading: 'ALL-TIME RANKINGS',
  statPlayers: 'Total Players',
  statGames: 'Total Games',

  // Two different "nothing here" cases — worth keeping distinct.
  noneQualified: (minGames) =>
    `No rankings yet — ${minGames} games needed to qualify. Everyone playing is listed below.`,
  noGamesAtAll: 'No games recorded yet. Finish a match to start the rankings.',

  unrankedHeading: 'NOT YET RANKED',
  unrankedFooter: (minGames) => `Play ${minGames}+ games to get ranked`,

  // Shown next to a player who has not played enough games yet.
  readyToRank: 'Ready to rank',
  needsMoreGames: (remaining) =>
    `Needs ${remaining} more game${remaining === 1 ? '' : 's'} to rank`,
};
