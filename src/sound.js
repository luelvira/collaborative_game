"use strict";

// Web Audio oscillator sounds (spec: sound exists for engagement, boots ON,
// the teacher can turn it off; the preference persists in localStorage).
// No audio files are ever loaded — everything is synthesized on the fly.

const SOUND_KEY = "contestBoard:sound";

// Guarded-once design: every exported method checks enabled() and wraps its
// work so a browser without AudioContext/Web Audio (or with storage blocked)
// can never throw. Callers in app.js stay unconditional one-liners.

function enabled() {
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage) {
      // Anything other than the explicit "off" means on: missing key,
      // empty storage, garbage value — all default to sound on.
      return globalThis.localStorage.getItem(SOUND_KEY) !== "off";
    }
  } catch {
    // Storage can be unavailable (privacy mode, quota, disabled APIs).
  }
  return true;
}

function setEnabled(on) {
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage) {
      globalThis.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    }
  } catch {
    // Lost preference is acceptable; the board still works.
  }
}

// Play a short sequence of fixed-frequency notes on a disposable context.
// `notes` is an array of [frequency, durationSeconds], played back to back.
function play(notes, type, peak) {
  // typeof guard first: sound.js must be import-safe in non-DOM environments
  // (node tests, jsdom/linkedom without Web Audio).
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (typeof Ctx !== "function") return;
    const ctx = new Ctx(); // may throw on some browsers — caught below/here
    try {
      // Autoplay policies can leave the context suspended until a user
      // gesture; resuming is best-effort and must never reject unhandled.
      if (typeof ctx.resume === "function") ctx.resume().catch?.(() => {});
      const floor = 0.0001; // envelope floor for the exponential decay
      let t = ctx.currentTime;
      for (const [freq, dur] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        // Attack in ~10 ms, then decay to near-silence — no clicks, no rings.
        gain.gain.setValueAtTime(floor, t);
        gain.gain.linearRampToValueAtTime(peak, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(floor, t + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
        t += dur;
      }
      const total = notes.reduce((s, [, dur]) => s + dur, 0);
      globalThis.setTimeout(() => {
        try {
          if (typeof ctx.close === "function") ctx.close().catch?.(() => {});
        } catch {
          // Closing early/repeatedly must not surface as an error.
        }
      }, Math.ceil(total * 1000) + 50);
    } catch {
      // Scheduling failed (e.g. degraded audio stack) — drop the context.
      try {
        if (typeof ctx.close === "function") ctx.close().catch?.(() => {});
      } catch {
        // Ignore.
      }
    }
  } catch {
    // No Web Audio at all: silence is the correct fallback.
  }
}

// Expiry chime: falling two-tone (880 → 660 Hz sine), ~0.35 s total — reads
// as "time is over" without startling the classroom.
function timeUp() {
  if (!enabled()) return;
  play([[880, 0.15], [660, 0.2]], "sine", 0.25);
}

// Award blip: rising bright two-note (660 → 990 Hz triangle), ~0.3 s total —
// a little celebration, still short and classroom-appropriate.
function award() {
  if (!enabled()) return;
  play([[660, 0.12], [990, 0.16]], "triangle", 0.2);
}

export const sound = { enabled, setEnabled, timeUp, award };
