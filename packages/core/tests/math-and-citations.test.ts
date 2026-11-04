import { describe, expect, test } from "bun:test";
import { keepCited, NOT_CITED, oneCiteNote, retrievedKeys } from "@confu/core/tutor/keep-cited";
import { repairMath } from "@confu/core/tutor/math-repair";
import { sanitizeSvg } from "@confu/core/tutor/diagram";

describe("repairMath", () => {
  test("escapes # and % inside \\text, which KaTeX otherwise rejects", () => {
    expect(repairMath("$(k \\times k + 1) \\times \\text{#filters}$")).toContain("\\text{\\#filters}");
    expect(repairMath("$x = 95\\% + \\frac{1}{2}$")).toContain("95\\%");
  });
  test("leaves prices and code alone", () => {
    expect(repairMath("It costs $5 for #1 and $6 for #2")).toBe("It costs $5 for #1 and $6 for #2");
    expect(repairMath("`$x # y$`")).toBe("`$x # y$`");
  });
  test("turns a lone $$…$$ line into a display equation", () => {
    expect(repairMath("$$\\sum_i x_i$$")).toBe("$$\n\\sum_i x_i\n$$");
  });
});

describe("keepCited", () => {
  const retrieved = retrievedKeys(false, [{ label: "", page: 3 }]);
  const claim = "Principal components are the eigenvectors of the covariance matrix of the data";
  test("keeps a cited answer as it is", () => {
    expect(keepCited(`${claim} (p. 3).`, retrieved, false)).toBe(`${claim} (p. 3).`);
  });
  test("drops a page the prompt never sent, then notes the answer isn't cited", () => {
    const out = keepCited(`${claim} (p. 9).`, retrieved, false);
    expect(out).not.toContain("p. 9");
    expect(out).toContain(NOT_CITED);
  });
  test("marks only the uncited paragraph when some are cited", () => {
    const out = keepCited(`${claim} (p. 3).\n\n${claim} again, with no page at all here.`, retrieved, false);
    expect(out.match(/†/g)?.length).toBe(2); // the mark, and the footnote
  });
  test("never touches a diagram", () => {
    const fence = "```mermaid\nflowchart LR\n  A --> B\n```";
    expect(keepCited(`${claim} (p. 3).\n\n${fence}`, retrieved, false)).toContain(fence);
  });
  test("oneCiteNote collapses repeated notes", () => {
    const spam = `A (${NOT_CITED})\n\nB (${NOT_CITED})\n\nC (${NOT_CITED})`;
    expect(oneCiteNote(spam).match(/not cited/gi)?.length).toBe(1);
  });
});

describe("sanitizeSvg", () => {
  test("removes scripts, event handlers and javascript: links", () => {
    const svg = sanitizeSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/><a href="javascript:alert(1)"><text>t</text></a></svg>') ?? "";
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/onclick/i);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).toMatch(/<rect/);
  });
  test("rejects something that isn't an SVG", () => {
    expect(sanitizeSvg("<div>hi</div>")).toBeNull();
  });
});

import { applyMemoryUpdate } from "@confu/core/tutor/memory";
import { EMPTY_MEMORY, type PlanTopic } from "@confu/core/types";

describe("applyMemoryUpdate", () => {
  const topic = { id: "t", mastery: 0.4 } as PlanTopic;
  test("merges new notes and resolves old ones", () => {
    const memory = { ...EMPTY_MEMORY, struggling: ["eigenvalues"], open_questions: ["why square deviations"] };
    const { next, mastery } = applyMemoryUpdate(memory, topic, { summary: "Better now.", understood_add: ["Eigenvalues"], resolved: ["why square deviations"], topic_mastery: 0.8 });
    expect(next.summary).toBe("Better now.");
    expect(next.understood).toEqual(["Eigenvalues"]);
    expect(next.struggling).toEqual([]); // understood now
    expect(next.open_questions).toEqual([]);
    expect(mastery).toBe(0.6); // averaged with the old estimate
  });
  test("ignores malformed output", () => {
    const { next, mastery } = applyMemoryUpdate(EMPTY_MEMORY, topic, { summary: 42, understood_add: "not a list", topic_mastery: 7 });
    expect(next).toEqual(EMPTY_MEMORY);
    expect(mastery).toBeNull();
  });
});
