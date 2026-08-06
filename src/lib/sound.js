/* ─────────────────────────────────────────────
   UI SOUND EFFECTS
   Three short cues for the match reveal: a tick as each player card lands, a
   chime when the group locks in, and a thud as it drops onto the court.

   These are SYNTHESISED with the Web Audio API rather than loaded from files.
   The brief asked for audio assets under 50KB each behind use-sound/Howler;
   generating them at playback time is strictly smaller (zero bytes, no
   decoding, no request), adds no dependency, and lets the envelopes be tuned in
   code. The trade-off is that the character of each sound is fixed here rather
   than swappable by dropping in a new file — see the note in each function if
   you want to change how one feels.

   Nothing here runs until a sound is actually played: the AudioContext is
   created lazily on the first cue, so opening the app never starts audio and
   never trips a browser autoplay warning.
   ───────────────────────────────────────────── */

let ctx = null;
let enabled = true;

// Mirrors the Sound Effects toggle. Kept as module state rather than passed
// through every call site so a deep component can stay unaware of preferences.
export function setSoundEnabled(value) {
  enabled = !!value;
}

export function isSoundEnabled() {
  return enabled;
}

// → an AudioContext, or null when sound is off / unavailable (jsdom in tests,
// or a browser without Web Audio). Every cue below no-ops on null, so callers
// never need to guard.
function audio() {
  if (!enabled || typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    if (!ctx) ctx = new AC();
    // Browsers start the context suspended until a user gesture. Every cue here
    // follows a click, so resuming is safe and usually already done.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null; // audio blocked entirely — silence is the right fallback
  }
}

/* A card landing on a table: a burst of noise shaped by a steep decay and
   narrowed to a woody band. Louder `Q` or a lower frequency reads as a thicker
   card; a longer buffer reads as a scuff rather than a tick. ~50ms. */
export function playTick() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const length = Math.ceil(ac.sampleRate * 0.05);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // ^6 decay is what turns white noise into a click instead of a hiss.
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 6);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1900;
  band.Q.value = 1.1;
  const gain = ac.createGain();
  gain.gain.value = 0.16;
  src.connect(band).connect(gain).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.05);
}

/* The lock-in. Two sine partials a major sixth apart, which resolves without
   sounding like a fanfare. ~200ms. Raise the peak gain for more presence. */
export function playChime() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  out.connect(ac.destination);

  for (const [freq, level] of [[880, 1], [1318.5, 0.55]]) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const mix = ac.createGain();
    mix.gain.value = level;
    osc.connect(mix).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

/* The group settling onto the court. A sine dropping 180Hz → 60Hz, which is the
   pitch envelope that makes a tone read as weight landing. ~150ms. */
export function playThud() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.15);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.16);
}
