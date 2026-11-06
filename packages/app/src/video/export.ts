import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { LocalVideo } from "@confu/client/video";
import type { Line } from "@confu/core/video/script";
import { timeline } from "@confu/core/video/timing";
import type { VoicedLine } from "./narration";
import { Caption, H, SceneHost, Stage, STAGE_CSS, W } from "./stage";

// A video file, made on the device: each frame of the stage is drawn into a
// canvas (the stage's HTML wrapped in an SVG image), the voiced narration is
// mixed offline, and both are encoded with WebCodecs. MP4 (H.264 + AAC) when
// the device can encode it, WebM (VP9/VP8 + Opus) otherwise. Nothing leaves
// the device.

export type ExportProgress = { done: number; label: string };
export type Exported = { blob: Blob; ext: string };

export const canExport = () => typeof VideoEncoder !== "undefined" && typeof XMLSerializer !== "undefined";

/* --------------------------------------------------------------- fonts */

// The stage's fonts, embedded: an SVG image can't see the page's fonts.
const fontCache = new Map<string, Promise<string>>();
async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function embeddedFonts(families: string[]): Promise<string> {
  const key = families.join("|");
  const hit = fontCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const wanted = new Set(families.map((f) => f.replace(/["']/g, "").trim().toLowerCase()));
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // another origin's stylesheet
      }
      for (const rule of [...rules]) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim().toLowerCase();
        if (!wanted.has(family)) continue;
        // Latin only: other scripts' subsets would only add weight.
        const range = rule.style.getPropertyValue("unicode-range");
        if (range && !/U\+0000|U\+0100|U\+0?0?20/i.test(range)) continue;
        let css = rule.cssText;
        const base = sheet.href ?? location.href;
        for (const m of [...css.matchAll(/url\((["']?)([^"')]+)\1\)/g)]) {
          if (m[2].startsWith("data:")) continue;
          try {
            css = css.replace(m[0], `url("${await dataUrl(new URL(m[2], base).href)}")`);
          } catch {}
        }
        out.push(css);
      }
    }
    return out.join("\n");
  })();
  fontCache.set(key, job);
  return job;
}

const familiesOf = (stack: string) =>
  stack
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f && !/^(system-ui|sans-serif|serif|monospace|ui-monospace|Georgia)$/i.test(f) && !f.startsWith("var("));

/* --------------------------------------------------------------- frames */

function frameDrawer(ctx: CanvasRenderingContext2D, css: string) {
  const serializer = new XMLSerializer();
  let last = "";
  let useData = false;
  return async (stage: HTMLElement): Promise<void> => {
    const markup = serializer.serializeToString(stage);
    if (markup === last) return; // nothing moved: the canvas already shows it
    last = markup;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px"><style>${css}</style>${markup}</div></foreignObject></svg>`;
    const img = new Image();
    let url = "";
    if (useData) img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    else img.src = url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      await img.decode();
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      ctx.getImageData(0, 0, 1, 1); // throws if the browser marked the canvas unreadable
    } catch (e) {
      if (!useData && e instanceof DOMException && e.name === "SecurityError") {
        useData = true;
        last = "";
        return frameDrawer(ctx, css)(stage);
      }
      throw e;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };
}

/* ---------------------------------------------------------------- audio */

// Decode on a normal AudioContext. Doing it on the OfflineAudioContext has
// crashed the tab while a download was still mixing the narration.
async function decodeClip(bytes: ArrayBuffer, decodeCtx: AudioContext | null, offline: OfflineAudioContext): Promise<AudioBuffer> {
  const copy = () => bytes.slice(0);
  if (decodeCtx) {
    try {
      return await decodeCtx.decodeAudioData(copy());
    } catch {
      // The offline context gets the same bytes. A failure there is reported to the student.
    }
  }
  return offline.decodeAudioData(copy());
}

async function mixNarration(voiced: VoicedLine[][], starts: number[][], total: number): Promise<AudioBuffer> {
  if (!Number.isFinite(total) || total <= 0) throw new Error("This video has no duration to export.");
  const rate = 48000;
  // A storyboard asks for at most a few minutes. A bad duration must not allocate a buffer big enough to kill the tab.
  const seconds = Math.min(total, 6 * 60);
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil((seconds + 0.5) * rate)), rate);
  let decodeCtx: AudioContext | null = null;
  try {
    if (typeof AudioContext !== "undefined") decodeCtx = new AudioContext();
  } catch {
    decodeCtx = null;
  }
  try {
    for (const [s, lines] of voiced.entries()) {
      for (const [l, line] of lines.entries()) {
        let t = starts[s]?.[l] ?? 0;
        if (!Number.isFinite(t) || t < 0) t = 0;
        for (const blob of line.blobs) {
          if (t >= seconds) break;
          const buf = await decodeClip(await blob.arrayBuffer(), decodeCtx, offline);
          const src = offline.createBufferSource();
          src.buffer = buf;
          src.connect(offline.destination);
          src.start(Math.min(t, Math.max(0, seconds - 0.05)));
          t += buf.duration;
        }
      }
    }
    return await offline.startRendering();
  } finally {
    await decodeCtx?.close().catch(() => {});
  }
}

/* ---------------------------------------------------------------- whole */

export async function exportVideo(
  video: Pick<LocalVideo, "script" | "title">,
  opts: { voiced: VoicedLine[][] | null; captions: boolean; fps?: number; onProgress?: (p: ExportProgress) => void; signal?: AbortSignal },
): Promise<Exported> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio, getFirstEncodableVideoCodec } = await import("mediabunny");
  const fps = opts.fps ?? 30;
  const scenes = video.script.scenes;
  const timing = timeline(scenes, opts.voiced ? (s, l) => opts.voiced![s][l].seconds : undefined);
  const report = (done: number, label: string) => opts.onProgress?.({ done, label });

  // Where frames are drawn: off screen, at full size.
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-${W * 3}px;top:0;width:${W}px;height:${H}px;pointer-events:none;contain:strict`;
  document.body.appendChild(host);
  const root = createRoot(host);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;

  const mp4 = (await canEncodeVideo("avc", { width: W, height: H })) && (!opts.voiced || (await canEncodeAudio("aac")));
  const vcodec = mp4 ? "avc" : ((await getFirstEncodableVideoCodec(["vp9", "vp8"], { width: W, height: H })) ?? "vp8");
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: vcodec, bitrate: 3_000_000, keyFrameInterval: 4 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = opts.voiced ? new AudioBufferSource({ codec: mp4 ? "aac" : "opus", bitrate: 128_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  try {
    if (opts.voiced && audioSource) {
      report(0, "Mixing the narration");
      const mixed = await mixNarration(
        opts.voiced,
        timing.scenes.map((s) => s.lines.map((l) => s.start + l.start)),
        timing.total,
      );
      await audioSource.add(mixed);
      audioSource.close();
    }

    // The stage's fonts by their real names (the app's are CSS variables),
    // embedded once for every frame.
    flushSync(() => root.render(createElement(Stage, { scale: 1 }, null)));
    const probe = getComputedStyle(host.querySelector<HTMLElement>(".cv-stage")!);
    const fonts = Object.fromEntries(["--cv-sans", "--cv-serif", "--cv-mono"].map((v) => [v, probe.getPropertyValue(v).trim()])) as React.CSSProperties;
    await document.fonts.ready;
    const draw = frameDrawer(ctx, `${await embeddedFonts(Object.values(fonts).flatMap((v) => familiesOf(String(v))))}\n${STAGE_CSS}`);

    const frames = Math.ceil(timing.total * fps);
    let frame = 0;
    for (const [s, scene] of scenes.entries()) {
      const time = timing.scenes[s];
      let tl: gsap.core.Timeline | null = null;
      let shown: Line | null | undefined;
      const paint = (caption: Line | null) =>
        flushSync(() =>
          root.render(
            createElement(
              Stage,
              { scale: 1, fonts },
              createElement(SceneHost, { key: `s${s}`, scene, time, exit: s < scenes.length - 1, onTimeline: (t) => (tl = t) }),
              opts.captions ? createElement(Caption, { line: caption }) : null,
              createElement("div", { className: "cv-progress", "data-progress": true, style: { width: "100%", transform: "scaleX(0)" } }),
            ),
          ),
        );
      paint(null);
      shown = null;
      const stage = host.querySelector<HTMLElement>(".cv-stage")!;
      const bar = host.querySelector<HTMLElement>("[data-progress]")!;
      const n = Math.round(time.duration * fps);
      for (let f = 0; f < n; f++, frame++) {
        if (opts.signal?.aborted) throw new DOMException("Stopped", "AbortError");
        const t = f / fps;
        (tl as gsap.core.Timeline | null)?.seek(t, false);
        if (opts.captions) {
          const k = time.lines.findIndex((l, i) => t >= l.start - 0.05 && t < (time.lines[i + 1]?.start ?? Infinity) - 0.05);
          const line = k >= 0 ? scene.narration[k] : null;
          if (line !== shown) {
            paint(line);
            shown = line;
          }
        }
        bar.style.transform = `scaleX(${((time.start + t) / timing.total).toFixed(4)})`;
        await draw(stage);
        await videoSource.add((time.start * fps + f) / fps, 1 / fps);
        if (frame % 15 === 0) report(frame / frames, `Drawing scene ${s + 1} of ${scenes.length}`);
      }
    }
    videoSource.close();
    report(1, "Finishing the file");
    await output.finalize();
    const buffer = output.target.buffer!;
    return { blob: new Blob([buffer], { type: mp4 ? "video/mp4" : "video/webm" }), ext: mp4 ? "mp4" : "webm" };
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    root.unmount();
    host.remove();
  }
}
