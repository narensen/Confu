// gpt-oss always writes a private scratchpad, and Qwen does too when reasoning
// is on. Groq bills those tokens even when they are hidden. If a scratchpad
// leaks into the reply and we store it, the next turn sends it back and the
// model writes another one on top of it. Keep only the words a student should see.

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
const ANALYSIS = "<|channel|>analysis";
const FINAL = "<|channel|>final<|message|>";

function find(hay: string, needle: string): number {
  return hay.toLowerCase().indexOf(needle);
}

// Where a trailing fragment of `marker` starts, or `s.length` when there isn't one.
function cutPartial(s: string, marker: string): number {
  const lower = s.toLowerCase();
  const max = Math.min(lower.length, marker.length - 1);
  for (let len = max; len >= 1; len--) {
    if (marker.startsWith(lower.slice(lower.length - len))) return s.length - len;
  }
  return s.length;
}

function cutAnyPartial(s: string, markers: string[]): number {
  let cut = s.length;
  for (const marker of markers) cut = Math.min(cut, cutPartial(s, marker));
  const open = s.toLowerCase().lastIndexOf("<|");
  if (open >= 0 && !s.slice(open).toLowerCase().includes("|>") && s.length - open < 48) cut = Math.min(cut, open);
  return cut;
}

function stripTags(s: string): string {
  return s.replace(/<\|[^|>]{0,40}\|>/g, "");
}

// Streaming filter. Markers can split across chunks; hold only a possible
// prefix and drop the scratchpad as soon as it is recognized.
export function createReasoningFilter() {
  let buf = "";
  let mode: "text" | "think" | "analysis" = "text";

  function push(delta: string): string {
    if (!delta) return "";
    buf += delta;
    let out = "";
    for (;;) {
      if (mode === "think") {
        const i = find(buf, THINK_CLOSE);
        if (i === -1) {
          buf = buf.slice(cutPartial(buf, THINK_CLOSE));
          break;
        }
        buf = buf.slice(i + THINK_CLOSE.length);
        mode = "text";
        continue;
      }
      if (mode === "analysis") {
        const i = find(buf, FINAL);
        if (i === -1) {
          buf = buf.slice(cutPartial(buf, FINAL));
          break;
        }
        buf = buf.slice(i + FINAL.length);
        mode = "text";
        continue;
      }

      const next = (
        [
          { at: find(buf, THINK_OPEN), kind: "think" as const, len: THINK_OPEN.length },
          { at: find(buf, ANALYSIS), kind: "analysis" as const, len: ANALYSIS.length },
          { at: find(buf, FINAL), kind: "final" as const, len: FINAL.length },
        ] as const
      )
        .filter((x) => x.at >= 0)
        .sort((a, b) => a.at - b.at)[0];

      if (!next) {
        const cut = cutAnyPartial(buf, [THINK_OPEN, ANALYSIS, FINAL]);
        out += stripTags(buf.slice(0, cut));
        buf = buf.slice(cut);
        break;
      }
      out += stripTags(buf.slice(0, next.at));
      buf = buf.slice(next.at + next.len);
      if (next.kind === "think") mode = "think";
      else if (next.kind === "analysis") mode = "analysis";
    }
    return out;
  }

  function finish(): string {
    if (mode !== "text") {
      buf = "";
      mode = "text";
      return "";
    }
    const lower = buf.toLowerCase();
    const partial =
      lower.length >= 2 &&
      (THINK_OPEN.startsWith(lower) || ANALYSIS.startsWith(lower) || FINAL.startsWith(lower) || (lower.startsWith("<|") && !lower.includes("|>")));
    const rest = partial ? "" : stripTags(buf);
    buf = "";
    return rest;
  }

  return { push, finish };
}

export function stripReasoning(text: string): string {
  const filter = createReasoningFilter();
  return (filter.push(text) + filter.finish()).replace(/\u0000/g, "");
}
