import { supabase } from './supabase';

const BUCKET = 'player-photos';

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/jpeg';
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

// CameraModal still produces a data URL from canvas.toDataURL; we upload it and
// keep only the public URL. Storing base64 in the session blob would add tens of
// KB to every broadcast and quickly exceed the Realtime message limit.
export async function uploadPhoto(venueId, playerId, dataUrl) {
  const path = `${venueId}/${playerId}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, dataUrlToBlob(dataUrl), { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust: the path is stable, so a retaken photo would otherwise show the
  // old image until the CDN entry expires.
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function deletePhoto(venueId, playerId) {
  await supabase.storage.from(BUCKET).remove([`${venueId}/${playerId}.jpg`]);
}
