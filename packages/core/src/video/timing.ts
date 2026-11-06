import type { Scene } from "./script";

// When each scene and each narration line starts. Durations come from the
// voiced audio when there is some, else from a speaking-rate estimate.

export const LEAD_IN = 0.6; // the picture settles before anyone speaks
export const GAP = 0.3; // between two lines
export const HOLD = 0.9; // the finished picture stays a moment after the last line

const WORDS_PER_SECOND = 2.6;
export const estimateSeconds = (text: string) => Math.max(1.2, text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND + 0.25);

export type LineTime = { start: number; duration: number }; // within the scene
export type SceneTime = { start: number; duration: number; lines: LineTime[] };
export type Timing = { total: number; scenes: SceneTime[] };

export function timeline(scenes: Scene[], lineSeconds: (scene: number, line: number) => number = (s, l) => estimateSeconds(scenes[s].narration[l].text)): Timing {
  let t = 0;
  const out: SceneTime[] = scenes.map((s, si) => {
    let local = LEAD_IN;
    const lines = s.narration.map((_, li) => {
      const duration = lineSeconds(si, li);
      const lt = { start: local, duration };
      local += duration + GAP;
      return lt;
    });
    const duration = local - GAP + HOLD;
    const st = { start: t, duration, lines };
    t += duration;
    return st;
  });
  return { total: t, scenes: out };
}

// When the k-th of n things on screen should appear: spread over the
// narration, so items arrive roughly as the hosts reach them.
export function beat(k: number, n: number, scene: SceneTime): number {
  if (n <= 1) return LEAD_IN * 0.5;
  const speaking = scene.lines.length ? scene.lines[scene.lines.length - 1].start + scene.lines[scene.lines.length - 1].duration - LEAD_IN : scene.duration;
  const first = Math.min(LEAD_IN, scene.duration * 0.15);
  return first + (k / n) * Math.max(0.8, speaking * 0.8);
}
