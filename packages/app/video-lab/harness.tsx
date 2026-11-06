// Browser side of the test lab: draws one scene at a time on the real stage,
// jumps to its finished picture, and reports what looks wrong.

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Line, Scene } from "@confu/core/video/script";
import type { SceneTime } from "@confu/core/video/timing";
import { Caption, fitText, SceneHost, Stage, W, H } from "../src/video/stage";

const root = createRoot(document.getElementById("root")!);
const CAPTION_TOP = H - 104;

type Report = { issues: string[]; notes: string[] };

function check(stage: HTMLElement, scene: Scene): Report {
  const issues: string[] = [];
  const notes: string[] = [];
  const s = stage.getBoundingClientRect();
  const t = scene.template;

  // Text that still doesn't fit after shrinking.
  for (const el of fitText(stage)) {
    if (el.matches("[data-caption]")) continue;
    issues.push(`layout:overflow:${t}`);
    notes.push(`overflow: "${(el.textContent ?? "").slice(0, 60)}"`);
  }
  // Anything drawn outside the frame or under the captions.
  const scene0 = stage.querySelector("[data-scene]")!;
  for (const el of scene0.querySelectorAll<HTMLElement>("*")) {
    // Only what's visible itself: text-holding elements and shapes (not containers).
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
    if (!ownText && !(el instanceof SVGGeometryElement)) continue;
    if (el.closest("marker")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left < s.left - 2 || r.right > s.right + 2 || r.top < s.top - 2 || r.bottom > s.top + CAPTION_TOP + 2) {
      issues.push(`layout:off-frame:${t}`);
      notes.push(`off-frame <${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(r.left - s.left)},${Math.round(r.top - s.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      break;
    }
  }
  // Boxes laid out around a centre must not collide.
  const nodes = [...scene0.querySelectorAll<HTMLElement>(".cv-node, [data-a='item'] > div:last-child")].map((n) => n.getBoundingClientRect());
  outer: for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.left < b.right - 4 && b.left < a.right - 4 && a.top < b.bottom - 4 && b.top < a.bottom - 4) {
        issues.push(`layout:overlap:${t}`);
        break outer;
      }
    }
  // Text squeezed too small to read.
  for (const el of scene0.querySelectorAll<HTMLElement>("p, span, li, h1, h2, div")) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 17) {
      issues.push(`layout:tiny-text:${t}`);
      break;
    }
  }
  if (t === "html" && scene0.querySelector("[data-visible='0']")) issues.push("layout:empty-drawing");
  if (t === "plot" && !scene0.querySelector("[data-a='curve']")) issues.push("layout:empty-plot");
  return { issues: [...new Set(issues)], notes };
}

declare global {
  interface Window {
    labRender: (scene: Scene, time: SceneTime, caption: Line | null) => Report;
  }
}

window.labRender = (scene, time, caption) => {
  let tl: gsap.core.Timeline | null = null;
  flushSync(() =>
    root.render(
      <Stage scale={1}>
        <SceneHost key={Math.random()} scene={scene} time={time} onTimeline={(t) => (tl = t)} />
        <Caption line={caption} />
      </Stage>,
    ),
  );
  (tl as gsap.core.Timeline | null)?.progress(1);
  const stage = document.querySelector<HTMLElement>(".cv-stage")!;
  const report = check(stage, scene);
  const cap = stage.querySelector<HTMLElement>("[data-caption]")!;
  if (cap.scrollHeight > cap.clientHeight + 2) report.issues.push("layout:caption-overflow");
  return report;
};

document.body.dataset.ready = "1";
void W;

// Export check: a real file from a storyboard, with tones standing in for voices.
import { exportVideo } from "../src/video/export";
import { estimateSeconds } from "@confu/core/video/timing";
import type { VideoScript } from "@confu/core/video/script";

function tone(seconds: number, hz: number): Blob {
  const rate = 24000;
  const n = Math.round(seconds * rate);
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  b.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, rate, true);
  b.setUint32(28, rate * 2, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  w(36, "data");
  b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.sin((i / rate) * hz * 2 * Math.PI) * 6000, true);
  return new Blob([b.buffer], { type: "audio/wav" });
}

declare global {
  interface Window {
    labExport: (script: VideoScript, voiced: boolean) => Promise<{ size: number; ext: string; ms: number; b64: string }>;
  }
}

window.labExport = async (script, voiced) => {
  const t0 = performance.now();
  const lines = voiced ? script.scenes.map((s) => s.narration.map((l) => ({ blobs: [tone(estimateSeconds(l.text), l.speaker === "A" ? 330 : 440)], seconds: estimateSeconds(l.text) }))) : null;
  let shown = -1;
  const { blob, ext } = await exportVideo({ script, title: script.title }, {
    voiced: lines,
    captions: true,
    onProgress: (p) => {
      const pct = Math.floor(p.done * 20) * 5;
      if (pct !== shown) console.log(`progress ${pct}% ${p.label} ${Math.round(performance.now() - t0)}ms`);
      shown = pct;
    },
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { size: blob.size, ext, ms: performance.now() - t0, b64: btoa(bin) };
};
