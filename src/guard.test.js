import { it, expect } from "vitest";
import { sound } from "./sound.js";

// Final-review Finding 3: the sound module must never let an exception escape
// — not when storage access throws, not when no audio stack exists at all.

it("sound.enabled()/setEnabled() survive a storage whose access throws", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const real = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: broken,
    configurable: true,
    writable: true,
  });
  try {
    expect(() => sound.enabled()).not.toThrow();
    expect(() => sound.setEnabled(false)).not.toThrow();
    // Broken storage falls back to the default judgement: sound on.
    expect(sound.enabled()).toBe(true);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      value: real,
      configurable: true,
      writable: true,
    });
  }
});

it("sound.timeUp()/award() never throw when no AudioContext exists", () => {
  const realWindow = globalThis.window;
  // A window without any audio constructor simulates an audio-less browser;
  // timeUp()/award() call the guarded play() internally.
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
    writable: true,
  });
  try {
    expect(() => sound.timeUp()).not.toThrow();
    expect(() => sound.award()).not.toThrow();
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: realWindow,
      configurable: true,
      writable: true,
    });
  }
});
