// Pen haptics spike (TECHNICAL-DESIGN.md 15, "to look into later"): can
// vibration make the pen feel like it's moving over paper? The web only
// offers navigator.vibrate(ms), which drives the device's motor with
// on/off pulses, so this tries two feels:
//
// - grain: a short pulse every `spacingPx` of pen travel on screen, like
//   the tooth of paper. Faster strokes give faster pulses.
// - buzz: one long vibration while the pen moves, stopped when it rests
//   or lifts.
//
// Pure logic: the caller does the vibrating, so it can be unit tested.

export type HapticMode = 'off' | 'grain' | 'buzz';

export interface HapticSettings {
  mode: HapticMode;
  // Length of one grain pulse.
  pulseMs: number;
  // Pen travel between grain pulses, in screen pixels.
  spacingPx: number;
  // Longer pulses for harder pressure (pulseMs at full pressure).
  pressureScales: boolean;
}

export const DEFAULT_HAPTICS: HapticSettings = { mode: 'off', pulseMs: 8, spacingPx: 12, pressureScales: true };

// How long a buzz runs before it needs topping up, and how long the pen
// can rest before the buzz stops.
export const BUZZ_MS = 400;
export const REST_MS = 60;

// What to ask the motor for: a pulse length in ms, 0 to stop, or nothing.
export type HapticCall = number | null;

export class HapticStroke {
  private travelled = 0;
  private nextPulseAt = -Infinity;
  private buzzUntil = -Infinity;
  private lastMoveAt = -Infinity;
  pulses = 0;

  constructor(private readonly settings: HapticSettings) {}

  // The pen moved `distancePx` on screen at `timeMs`.
  move(distancePx: number, pressure: number, timeMs: number): HapticCall {
    const s = this.settings;
    if (s.mode === 'off' || distancePx <= 0) return null;
    this.lastMoveAt = timeMs;
    if (s.mode === 'buzz') {
      // Top up before the running vibration ends.
      if (timeMs < this.buzzUntil - BUZZ_MS / 2) return null;
      this.buzzUntil = timeMs + BUZZ_MS;
      this.pulses++;
      return BUZZ_MS;
    }
    this.travelled += distancePx;
    if (this.travelled < s.spacingPx) return null;
    this.travelled %= s.spacingPx;
    // A new vibrate() call cuts the last one short, so leave each pulse
    // room to finish (and a gap after it, or pulses blur into a buzz).
    if (timeMs < this.nextPulseAt) return null;
    const scale = s.pressureScales ? 0.4 + 0.6 * Math.min(1, Math.max(0, pressure)) : 1;
    const ms = Math.max(1, Math.round(s.pulseMs * scale));
    this.nextPulseAt = timeMs + ms * 2;
    this.pulses++;
    return ms;
  }

  // Called each frame while the stroke is down: stops a buzz once the pen
  // has rested.
  idle(timeMs: number): HapticCall {
    if (this.settings.mode !== 'buzz' || this.buzzUntil < timeMs) return null;
    if (timeMs - this.lastMoveAt < REST_MS) return null;
    this.buzzUntil = -Infinity;
    return 0;
  }

  // The stroke ended: stop anything still running.
  end(): HapticCall {
    return this.settings.mode === 'buzz' ? 0 : null;
  }
}
