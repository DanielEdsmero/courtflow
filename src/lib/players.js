import { supabase } from './supabase';

// The roster is a real table — it outlives the session. Everything here is
// called optimistically: App.jsx updates local state first, then fires these and
// rolls back on error, so the UI never waits on the network.

// The DB column is photo_url; the UI has always called it `player.photo`.
const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  skill: r.skill,
  wins: r.wins,
  losses: r.losses,
  photo: r.photo_url,
});

export async function listPlayers(venueId) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(fromRow);
}

export async function createPlayer(venueId, { name, skill }) {
  const { data, error } = await supabase
    .from('players')
    .insert({ venue_id: venueId, name, skill })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function deletePlayer(playerId) {
  const { error } = await supabase.from('players').delete().eq('id', playerId);
  if (error) throw error;
}

export async function updatePlayerPhoto(playerId, photoUrl) {
  const { error } = await supabase
    .from('players')
    .update({ photo_url: photoUrl })
    .eq('id', playerId);
  if (error) throw error;
}

// Called when a match is finished. Two ids win, two lose — increments have to be
// read-modify-write since PostgREST has no atomic "+1", but only one staff device
// writes at a time so a lost update isn't a practical concern.
export async function recordResult(players, winnerIds, loserIds) {
  const updates = [];
  for (const p of players) {
    if (winnerIds.includes(p.id)) updates.push({ id: p.id, wins: p.wins + 1 });
    else if (loserIds.includes(p.id)) updates.push({ id: p.id, losses: p.losses + 1 });
  }
  await Promise.all(
    updates.map(({ id, ...fields }) => supabase.from('players').update(fields).eq('id', id))
  );
}

export async function resetAllStats(venueId) {
  const { error } = await supabase
    .from('players')
    .update({ wins: 0, losses: 0 })
    .eq('venue_id', venueId);
  if (error) throw error;
}

export async function recordMatchHistory(venueId, entry) {
  const { error } = await supabase.from('match_history').insert({
    venue_id: venueId,
    court_name: entry.courtName ?? null,
    player_ids: entry.players ?? [],
    winner_ids: entry.winners ?? [],
    type: entry.type ?? 'casual',
    duration_ms: Math.round(entry.duration ?? 0),
  });
  // Non-fatal: history is for later analytics, the session already has its own copy.
  if (error) console.error('Failed to record match history:', error);
}
