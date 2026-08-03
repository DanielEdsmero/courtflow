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
  // All-time counters (spec §F3). Never zeroed by resetAllStats — the wins and
  // losses above are. The ?? 0 keeps the app booting against a database where
  // the schema file hasn't been re-run yet.
  totalWins: r.total_wins ?? 0,
  totalLosses: r.total_losses ?? 0,
  totalGames: r.total_games ?? 0,
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

// Called when a match is finished. One RPC, one transaction: it bumps the
// session counters AND the all-time ones with real "+1" arithmetic, so two staff
// devices finishing different courts at the same moment can't clobber each other
// the way the old client-side read-modify-write could. The session counters were
// survivable that way; the all-time ones aren't recoverable from a lost update.
export async function recordResult(winnerIds, loserIds) {
  const { error } = await supabase.rpc('record_match_result', {
    p_winner_ids: winnerIds,
    p_loser_ids: loserIds,
  });
  if (error) throw error;
}

// Session-scoped only. total_wins / total_losses / total_games are deliberately
// left alone — they're what the all-time rankings page reads (spec §F3).
export async function resetAllStats(venueId) {
  const { error } = await supabase
    .from('players')
    .update({ wins: 0, losses: 0 })
    .eq('venue_id', venueId);
  if (error) throw error;
}

// Every game this venue has ever recorded, straight from the permanent log.
// head:true makes it a count rather than a download of the whole table.
export async function countMatchHistory(venueId) {
  const { count, error } = await supabase
    .from('match_history')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if (error) throw error;
  return count ?? 0;
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
