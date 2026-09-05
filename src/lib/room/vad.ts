/**
 * Voice-activity detection — pure RMS + debounce math. ADR 0005 §5.
 *
 * Two consumers, one primitive:
 *  - Smart mic (AC3.1): "shared-tab audio is playing" → gates auto-mute.
 *  - Whisper (AC4.4): "a participant's mic has voice" → drives audio duck.
 *
 * Design: the number-crunching lives here as a pure function so it's trivially
 * testable. The `AnalyserNode` wiring, the rAF loop, and the `MediaStream`
 * plumbing live in the caller — that's the part that varies across browsers
 * and the part we can't unit-test.
 *
 * Threshold: −40 dBFS ≈ RMS 0.01. Below room-tone; well above silence.
 * Debounce: 80 ms rising / 200 ms falling (Whisper). Smart-mic uses a longer
 * rising debounce (1500 ms) to catch "audio track present but still-frame"
 * per AC3 edge — the caller passes that in.
 */

export const DEFAULT_RMS_THRESHOLD = 0.01;
export const DEFAULT_RISING_MS = 80;
export const DEFAULT_FALLING_MS = 200;

/**
 * A single RMS sample paired with the wall-clock ms at which it was taken.
 * Callers producing this from an `AnalyserNode` compute
 *   rms = sqrt( mean(sample^2) )
 * on `getFloatTimeDomainData` output, ~50 Hz.
 */
export interface RmsSample {
  t: number;
  rms: number;
}

export type Edge = "rising" | "falling";

export interface EdgeAt {
  edge: Edge;
  t: number;
}

export interface VadOptions {
  /** RMS above this counts as "voice present". Default 0.01 (−40 dBFS). */
  threshold?: number;
  /** Continuous ms above threshold before emitting a rising edge. */
  risingMs?: number;
  /** Continuous ms below threshold before emitting a falling edge. */
  fallingMs?: number;
  /**
   * Whether the caller starts in a "voice active" state. Defaults to false.
   * Rising edges are only emitted from an inactive baseline; falling only
   * from active — matches how consumers key duck / mute logic.
   */
  startActive?: boolean;
}

/**
 * Stateful streaming detector — feed one sample at a time via `push`,
 * receive an `EdgeAt` when the debounce fires or `null` otherwise.
 *
 * The rising / falling debounce anchors an edge's `t` at the first sample
 * in the continuous run that crossed threshold — not the sample that
 * finally exceeded the debounce duration. That's what a listener needs to
 * time attack from (e.g. Whisper's duck ramp in §4).
 */
export class VadDetector {
  readonly threshold: number;
  readonly risingMs: number;
  readonly fallingMs: number;
  private active: boolean;
  // "runStart" tracks when the current above/below streak began. `null`
  // between streaks (i.e. after a state flip has already been committed).
  private runStart: number | null = null;
  private runIsAbove: boolean | null = null;

  constructor(opts: VadOptions = {}) {
    this.threshold = opts.threshold ?? DEFAULT_RMS_THRESHOLD;
    this.risingMs = opts.risingMs ?? DEFAULT_RISING_MS;
    this.fallingMs = opts.fallingMs ?? DEFAULT_FALLING_MS;
    this.active = opts.startActive ?? false;
  }

  /** True while the detector considers voice / audio present. */
  isActive(): boolean {
    return this.active;
  }

  /** Feed one sample; get back an edge if one just fired, else null. */
  push({ t, rms }: RmsSample): EdgeAt | null {
    const above = rms > this.threshold;

    if (this.runIsAbove === null || this.runIsAbove !== above) {
      this.runStart = t;
      this.runIsAbove = above;
      return null;
    }

    if (this.runStart === null) return null;
    const dur = t - this.runStart;
    if (!this.active && above && dur >= this.risingMs) {
      const edge: EdgeAt = { edge: "rising", t: this.runStart };
      this.active = true;
      this.runStart = null;
      this.runIsAbove = null;
      return edge;
    }
    if (this.active && !above && dur >= this.fallingMs) {
      const edge: EdgeAt = { edge: "falling", t: this.runStart };
      this.active = false;
      this.runStart = null;
      this.runIsAbove = null;
      return edge;
    }
    return null;
  }
}

/**
 * Pure batch detector: given a series of `{t, rms}` samples in monotonic
 * time order, return the ordered list of `rising` / `falling` edges. Thin
 * wrapper over `VadDetector` — kept as its own function so callers writing
 * unit tests over pure math don't have to instantiate a class.
 */
export function computeVadEdges(
  samples: readonly RmsSample[],
  opts: VadOptions = {},
): EdgeAt[] {
  const d = new VadDetector(opts);
  const edges: EdgeAt[] = [];
  for (const s of samples) {
    const e = d.push(s);
    if (e !== null) edges.push(e);
  }
  return edges;
}

// ---- Convenience: RMS from a Float32Array time-domain block --------------

/**
 * Compute RMS from a block of PCM samples (typically the output of
 * `AnalyserNode.getFloatTimeDomainData`). Values are in [−1, 1].
 *
 * Pulled out as its own tiny helper because it's the exact math the browser
 * caller needs, and it's easier to unit-test the ~2 LOC once than to inline
 * it in the adapter and hope.
 */
export function rmsOfBlock(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / block.length);
}
