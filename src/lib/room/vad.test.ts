import { describe, it, expect } from "vitest";
import { VadDetector, computeVadEdges, rmsOfBlock, type RmsSample } from "./vad";

/**
 * Build a series of samples at a fixed cadence.
 * `pattern` is an array of RMS values, one per sample; `stepMs` is the
 * spacing (default 20ms → ~50Hz, matches the ADR's runtime loop).
 */
function stream(pattern: number[], stepMs = 20): RmsSample[] {
  return pattern.map((rms, i) => ({ t: i * stepMs, rms }));
}

describe("computeVadEdges — rising", () => {
  it("emits a rising edge after the debounce is met", () => {
    // 20ms apart; 5 samples above threshold = 80ms → hits default 80ms rising.
    const samples = stream([0, 0.02, 0.02, 0.02, 0.02, 0.02]);
    const edges = computeVadEdges(samples);
    expect(edges).toEqual([{ edge: "rising", t: 20 }]);
  });

  it("does not emit if the streak is shorter than the debounce", () => {
    // 4 above-samples spanning only 60 ms (t=20..80).
    const samples = stream([0, 0.02, 0.02, 0.02, 0.02, 0]);
    const edges = computeVadEdges(samples);
    expect(edges).toEqual([]);
  });

  it("respects a custom rising debounce", () => {
    // 6 samples above @ 20ms cadence spans 100ms.
    const samples = stream([0, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02]);
    const edges = computeVadEdges(samples, { risingMs: 100 });
    expect(edges).toEqual([{ edge: "rising", t: 20 }]);
    // If we tighten the debounce, edge lands earlier.
    const strict = computeVadEdges(samples, { risingMs: 40 });
    expect(strict).toEqual([{ edge: "rising", t: 20 }]);
  });

  it("edge.t is the start of the streak, not the sample that broke the debounce", () => {
    const samples = stream([0, 0, 0.02, 0.02, 0.02, 0.02, 0.02]);
    const edges = computeVadEdges(samples);
    expect(edges[0]?.t).toBe(40); // first above-threshold sample
  });
});

describe("computeVadEdges — falling", () => {
  it("emits a falling edge after the falling debounce is met", () => {
    // Start active, then 200ms of below-threshold @ 20ms cadence = 11 samples.
    const samples = stream([
      0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const edges = computeVadEdges(samples, { startActive: true });
    expect(edges).toEqual([{ edge: "falling", t: 20 }]);
  });

  it("noise below threshold before an edge doesn't retrigger from inactive", () => {
    // startActive:false; all samples silent → no edges at all.
    const samples = stream([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(computeVadEdges(samples)).toEqual([]);
  });
});

describe("computeVadEdges — rising + falling sequence", () => {
  it("full talk beat: silence → voice → silence yields exactly one rising then one falling", () => {
    const samples = stream([
      // silence baseline
      0, 0,
      // voice: 5 samples at 20ms = 80ms → rising fires at t=40
      0.02, 0.02, 0.02, 0.02, 0.02,
      // continued voice
      0.02, 0.02,
      // fall: need 200ms of below-threshold = 11 samples
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const edges = computeVadEdges(samples);
    // Rising anchors to first above-sample (t=40); falling anchors to
    // first below-sample after the last voice sample (t=180).
    expect(edges).toEqual([
      { edge: "rising", t: 40 },
      { edge: "falling", t: 180 },
    ]);
  });

  it("brief dip inside a talk streak does not emit a falling edge", () => {
    // Rising, then a 40ms dip (< falling debounce of 200ms), then back up,
    // then long silence.
    const samples = stream([
      0, 0,
      0.02, 0.02, 0.02, 0.02, 0.02, // rising fires at t=40
      0, 0, // 40ms dip — under falling debounce, no falling edge
      0.02, 0.02, 0.02, 0.02,
      // 220ms of silence
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const edges = computeVadEdges(samples);
    expect(edges.filter((e) => e.edge === "rising")).toHaveLength(1);
    expect(edges.filter((e) => e.edge === "falling")).toHaveLength(1);
  });

  it("threshold override", () => {
    // With threshold 0.5, 0.02 samples are 'silence' and no rising fires.
    const samples = stream([0, 0.02, 0.02, 0.02, 0.02, 0.02]);
    expect(computeVadEdges(samples, { threshold: 0.5 })).toEqual([]);
  });
});

describe("VadDetector (streaming)", () => {
  it("emits a rising edge from streamed samples", () => {
    const d = new VadDetector();
    const emitted: string[] = [];
    // 20ms cadence; 5 samples above threshold spans 80ms → default rising.
    for (const s of [
      { t: 0, rms: 0 },
      { t: 20, rms: 0.02 },
      { t: 40, rms: 0.02 },
      { t: 60, rms: 0.02 },
      { t: 80, rms: 0.02 },
      { t: 100, rms: 0.02 },
    ]) {
      const e = d.push(s);
      if (e !== null) emitted.push(`${e.edge}@${e.t}`);
    }
    expect(emitted).toEqual(["rising@20"]);
    expect(d.isActive()).toBe(true);
  });

  it("carries state across pushes so a rising followed by falling both fire", () => {
    const d = new VadDetector();
    const edges: string[] = [];
    const feed = (t: number, rms: number) => {
      const e = d.push({ t, rms });
      if (e !== null) edges.push(`${e.edge}@${e.t}`);
    };
    // Rising (80ms of voice)
    feed(0, 0);
    for (let t = 20; t <= 100; t += 20) feed(t, 0.02);
    // Falling (220ms of silence — over the 200ms default falling debounce)
    for (let t = 120; t <= 340; t += 20) feed(t, 0);
    expect(edges).toEqual(["rising@20", "falling@120"]);
    expect(d.isActive()).toBe(false);
  });
});

describe("rmsOfBlock", () => {
  it("returns 0 for an empty block", () => {
    expect(rmsOfBlock(new Float32Array(0))).toBe(0);
  });

  it("computes RMS of a constant-valued block", () => {
    const block = new Float32Array(4);
    block.fill(0.5);
    expect(rmsOfBlock(block)).toBeCloseTo(0.5, 6);
  });

  it("computes RMS of a signed block (sign cancels via square)", () => {
    const block = Float32Array.of(0.5, -0.5, 0.5, -0.5);
    expect(rmsOfBlock(block)).toBeCloseTo(0.5, 6);
  });

  it("silence → 0", () => {
    const block = new Float32Array(64);
    expect(rmsOfBlock(block)).toBe(0);
  });
});
