import { supabase } from './supabase';

// The roster is a real table — it outlives the session. Everything here is
// called optimistically: App.jsx updates local state first, then fires these and
// rolls back on error, so the UI never waits on the network.

// The DB column is photo_url; the UI has always called it `player.photo`.
// checked_in_at comes back as an ISO string; the UI does arithmetic on it
// (session duration), so hand it over as an epoch-ms number like the match times.
const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  skill: r.skill,
  wins: r.wins,
  losses: r.losses,
  photo: r.photo_url,
  payment: r.payment ?? 'unpaid',
  checkedInAt: r.checked_in_at ? new Date(r.checked_in_at).getTime() : Date.now(),
  // Checked-out players are kept in the table (for re-check-in) but hidden from
  // the active roster. A truthy checked_out_at means "done for the day".
  checkedOut: !!r.checked_out_at,
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

export async function createPlayer(venueId, { name, skill, payment = 'unpaid' }) {
  const { data, error } = await supabase
    .from('players')
    .insert({ venue_id: venueId, name, skill, payment, checked_in_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

// Re-check-in a returning player (spec §4). Their durable data — skill, W/L,
// photo — is untouched; only the session-scoped fields move: a fresh
// checked_in_at (so session duration measures from now) and the payment picked
// for this visit (defaults to unpaid so they can pay again). Returns the fresh row.
export async function recheckInPlayer(playerId, payment = 'unpaid') {
  const { data, error } = await supabase
    .from('players')
    // Clear checked_out_at so a returning player rejoins the active roster.
    .update({ payment, checked_in_at: new Date().toISOString(), checked_out_at: null })
    .eq('id', playerId)
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

// Check a player out (spec §3): they're done for the day and leave the active
// roster. The row stays put — skill, W/L and photo are kept so the check-in
// autocomplete can bring them back next visit — only checked_out_at is stamped.
export async function checkOutPlayer(playerId) {
  const { error } = await supabase
    .from('players')
    .update({ checked_out_at: new Date().toISOString() })
    .eq('id', playerId);
  if (error) throw error;
}

export async function updatePlayerPayment(playerId, payment) {
  const { error } = await supabase
    .from('players')
    .update({ payment })
    .eq('id', playerId);
  if (error) throw error;
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
