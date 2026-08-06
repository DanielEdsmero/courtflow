import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadPrefs, savePrefs, DEFAULT_PREFS, prefersReducedMotion } from './prefs.js';

/* Preferences are the one bit of state that survives a reload without going
   through Supabase, so the failure modes worth covering are all about a
   localStorage that is empty, corrupt, or refusing to co-operate. */

const KEY = 'courtflow:prefs';

// jsdom has matchMedia missing by default; most tests want "no reduced motion".
function stubMatchMedia(matches) {
  window.matchMedia = vi.fn().mockReturnValue({ matches });
}

describe('prefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults both toggles on', () => {
    expect(DEFAULT_PREFS).toEqual({ animations: true, sound: true });
    expect(loadPrefs()).toEqual({ animations: true, sound: true });
  });

  it('round-trips what was saved', () => {
    savePrefs({ animations: false, sound: true });
    expect(loadPrefs()).toEqual({ animations: false, sound: true });
  });

  it('keeps the two toggles independent', () => {
    savePrefs({ animations: true, sound: false });
    expect(loadPrefs()).toEqual({ animations: true, sound: false });
  });

  it('coerces whatever it is handed to booleans', () => {
    savePrefs({ animations: 1, sound: 0 });
    expect(loadPrefs()).toEqual({ animations: true, sound: false });
  });

  it('falls back to defaults on corrupt JSON rather than throwing', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(() => loadPrefs()).not.toThrow();
    expect(loadPrefs()).toEqual({ animations: true, sound: true });
  });

  it('falls back to defaults when the stored value is not an object', () => {
    window.localStorage.setItem(KEY, '"off"');
    expect(loadPrefs()).toEqual({ animations: true, sound: true });
  });

  it('fills in a missing key from an older saved shape', () => {
    // A blob written before the sound toggle existed.
    window.localStorage.setItem(KEY, JSON.stringify({ animations: false }));
    expect(loadPrefs()).toEqual({ animations: false, sound: true });
  });

  it('starts with animations off when the OS asks for reduced motion', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(loadPrefs()).toEqual({ animations: false, sound: true });
  });

  it('lets an explicit choice override the reduced-motion default', () => {
    stubMatchMedia(true);
    savePrefs({ animations: true, sound: true });
    // Having deliberately switched animations on, the OS hint must not win.
    expect(loadPrefs().animations).toBe(true);
  });

  it('survives a localStorage that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadPrefs()).toEqual({ animations: true, sound: true });
  });

  it('survives a localStorage that throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => savePrefs({ animations: false, sound: false })).not.toThrow();
  });

  it('treats a missing matchMedia as no preference', () => {
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});
