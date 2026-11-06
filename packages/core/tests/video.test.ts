import { describe, expect, test } from "bun:test";
import { compileExpression, samplePlot } from "../src/video/expr";
import { videoGuide, videoPrompt } from "../src/video/guide";
import { cleanText, lenient, repairVideo, toNumber } from "../src/video/repair";
import { timeline } from "../src/video/timing";

const say = [{ speaker: "A", text: "Here is the idea." }, { speaker: "B", text: "Why does it matter?" }];

describe("function plots", () => {
  const val = (s: string, x: number) => {
    const c = compileExpression(s);
    if (!c.ok) throw new Error(c.error);
    return c.f(x);
  };
  test("the ways models write a function", () => {
    expect(val("x^2 - 2x + 1", 3)).toBe(4);
    expect(val("y = 2x", 5)).toBe(10);
    expect(val("f(x) = x**3", 2)).toBe(8);
    expect(val("x²+1", 3)).toBe(10);
    expect(val("-x^2", 3)).toBe(-9);
    expect(val("2^x^2", 1)).toBe(2);
    expect(val("sin(pi x / 2)", 1)).toBeCloseTo(1);
    expect(val("e^(-x)", 0)).toBe(1);
    expect(val("(x+1)(x-1)", 3)).toBe(8);
    expect(val("\\frac{1}{x}", 4)).toBe(0.25);
    expect(val("|x - 3|", 1)).toBe(2);
    expect(val("sin^2(x) + cos^2(x)", 0.7)).toBeCloseTo(1);
    expect(val("xsin(x)", Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
  test("refuses what isn't a function of x", () => {
    expect(compileExpression("alert(1)").ok).toBe(false);
    expect(compileExpression("x +* 2").ok).toBe(false);
    expect(compileExpression("constructor").ok).toBe(false);
  });
  test("an asymptote doesn't flatten the curve", () => {
    const c = compileExpression("1/x");
    if (!c.ok) throw new Error();
    const { segments, yMax } = samplePlot(c.f, -5, 5);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(yMax).toBeLessThan(100);
  });
});

describe("almost-JSON", () => {
  test("comments, trailing commas, single quotes, unquoted keys, Python literals", () => {
    const s = `{title: 'PCA', // the topic
      "ok": True, "list": [1, 2, 3,], "none": None,}`;
    expect(JSON.parse(lenient(s))).toEqual({ title: "PCA", ok: true, list: [1, 2, 3], none: null });
  });
  test("a reply cut off midway still parses", () => {
    expect(JSON.parse(lenient('{"scenes":[{"template":"points","points":["a","b'))).toEqual({ scenes: [{ template: "points", points: ["a", "b"] }] });
    expect(JSON.parse(lenient('{"scenes":[{"title":"x","narration":'))).toEqual({ scenes: [{ title: "x" }] });
  });
  test("quotes inside text and missing commas", () => {
    expect(JSON.parse(lenient('{"text": "He said "hi" today" "b": 1}'))).toEqual({ text: 'He said "hi" today', b: 1 });
    expect(JSON.parse(lenient('[{"a":1} {"a":2}]'))).toEqual([{ a: 1 }, { a: 2 }]);
  });
  test("numbers with units become text the repair can read", () => {
    expect(JSON.parse(lenient('{"value": 45%}'))).toEqual({ value: "45%" });
    expect(toNumber("45%")).toBe(45);
    expect(toNumber("$3.5 billion")).toBe(3.5e9);
    expect(toNumber("1,200 people")).toBe(1200);
  });
});

describe("repairing a storyboard", () => {
  test("a good reply passes untouched", () => {
    const raw = JSON.stringify({
      title: "PCA",
      scenes: [
        { template: "title", title: "PCA", subtitle: "Why", narration: say },
        { template: "bars", title: "Variance", unit: "%", bars: [{ label: "PC1", value: 62 }, { label: "PC2", value: 24 }], narration: say.map((l, i) => ({ ...l, text: `${l.text} ${i}` })) },
        { template: "recap", title: "Remember", points: ["Centre", "Eigenvectors", "Top M"], narration: [{ speaker: "A", text: "Three things." }, { speaker: "B", text: "Got it." }] },
      ],
    });
    const { script, issues } = repairVideo(raw, { material: "PC1 explains 62% and PC2 24% of the variance." });
    expect(issues).toEqual([]);
    expect(script?.scenes.map((s) => s.template)).toEqual(["title", "bars", "recap"]);
  });

  test("fixes a small model's habits", () => {
    const raw = `Sure! Here is your video:
\`\`\`json
{"video": {"title": "Supply and demand", "slides": [
  {"type": "Intro", "heading": "Supply and demand", "voiceover": "Host A: Prices come from two forces.\\nHost B: Which two?"},
  {"type": "bar_chart", "data": {"Apples": "40%", "Pears": "25%"}, "dialogue": [{"host": "Alex", "line": "Apples sell most."}, {"host": "Sam", "line": "Why?"}]},
  {"type": "formula", "equation": "$Q_d = a - b \\\\cdot P$", "variables": {"Q_d": "quantity demanded", "P": "price"}, "narration": [{"speaker": "A", "text": "Demand falls as **price** rises. (laughs)"}]},
  {"type": "sparkle", "title": "Equilibrium", "narration": [{"speaker":"A","text":"Where the curves cross, the market clears. Neither side wants to change."},{"speaker":"B","text":"So that's the price we see in shops."}]},
]}}
\`\`\``;
    const { script, issues } = repairVideo(raw, { material: "Apples are 40% of sales and pears 25%." });
    expect(script).not.toBeNull();
    const s = script!.scenes;
    expect(s.map((x) => x.template)).toEqual(["title", "bars", "equation", "points", "recap"]);
    expect(s[0].narration).toEqual([{ speaker: "A", text: "Prices come from two forces." }, { speaker: "B", text: "Which two?" }]);
    expect(s[1]).toMatchObject({ unit: "%", bars: [{ label: "Apples", value: 40 }, { label: "Pears", value: 25 }] });
    expect(s[1].narration.map((l) => l.speaker)).toEqual(["A", "B"]);
    expect((s[2] as { formula: string }).formula).toContain("· P");
    expect(s[2].narration[0].text).toBe("Demand falls as price rises.");
    expect(issues).toEqual(expect.arrayContaining(["json:code-fence", "shape:wrapped", "template:unknown:sparkle", "narration:stage-directions", "text:latex"]));
  });

  test("invented numbers don't reach the screen", () => {
    const raw = JSON.stringify({
      title: "Cells",
      scenes: [
        { template: "number", value: 37.2, unit: " trillion", label: "cells in a human body", narration: say },
        { template: "bars", bars: [{ label: "a", value: 7 }, { label: "b", value: 9 }], narration: [{ speaker: "A", text: "Made up." }] },
      ],
    });
    const { script, issues } = repairVideo(raw, { material: "The body is made of cells." });
    expect(script!.scenes.map((s) => s.template)).toEqual(["quote", "quote"]);
    expect(issues).toEqual(expect.arrayContaining(["number:invented", "bars:invented-numbers"]));
  });

  test("a function that won't parse is shown as an equation", () => {
    const raw = JSON.stringify({ scenes: [{ template: "plot", title: "Growth", expression: "P(t) = P0 e^{rt}", narration: say }] });
    const { script, issues } = repairVideo(raw);
    expect(script!.scenes[0].template).toBe("equation");
    expect(issues).toContain("plot:bad-expression");
  });

  test("lab mistakes: prose, two formulas, invented names, long code", () => {
    const prose = JSON.stringify({ scenes: [{ template: "plot", title: "Bastille", expression: "On July 14, 1789, crowds stormed the Bastille.", narration: say }] });
    const proseOut = repairVideo(prose);
    expect(proseOut.script!.scenes[0].template).toBe("quote");
    expect((proseOut.script!.scenes[0] as { text: string }).text).toContain("Bastille");
    expect(proseOut.issues).toContain("plot:not-a-function");

    const curves = JSON.stringify({ scenes: [{ template: "plot", expression: "D(p) = 1000 - 20p\nS(p) = 50 + 10p", narration: say }] });
    const curvesOut = repairVideo(curves);
    expect(curvesOut.script!.scenes[0].template).toBe("equation");
    expect((curvesOut.script!.scenes[0] as { formula: string }).formula).toContain("20p");
    expect((curvesOut.script!.scenes[0] as { formula: string }).formula).toContain("10p");
    expect(curvesOut.issues).toContain("plot:several-equations");

    const one = JSON.stringify({ scenes: [{ template: "plot", expression: "D(p) = 1000 - 20p", x_min: 0, x_max: 40, narration: say }] });
    const oneOut = repairVideo(one);
    expect(oneOut.script!.scenes[0].template).toBe("plot");
    expect((oneOut.script!.scenes[0] as { expression: string }).expression).toContain("x");
    expect(oneOut.issues).toContain("plot:renamed-variable");

    const rule = JSON.stringify({ scenes: [{ template: "rule", title: "The Rule of 72", rule: "Divide 72 by the percentage rate.", narration: say }] });
    const ruleOut = repairVideo(rule);
    expect(ruleOut.script!.scenes[0].template).toBe("quote");
    expect((ruleOut.script!.scenes[0] as { text: string }).text).toContain("Divide 72");
    expect(ruleOut.issues).toContain("template:alias:rule");

    const compared = JSON.stringify({
      scenes: [{ template: "compare", title: "Two formulas", left: { label: "Annual", formula: "A = P(1 + r)^t" }, right: { label: "Continuous", formula: "A = P e^(rt)" }, narration: say }],
    });
    const comparedOut = repairVideo(compared);
    expect(comparedOut.script!.scenes[0].template).toBe("compare");
    expect((comparedOut.script!.scenes[0] as { left: { points: string[] } }).left.points[0]).toContain("P");

    const series = JSON.stringify({ scenes: [{ template: "example", title: "Growth", years: [10, 20, 30], growth: [1967, 3870, 7612], narration: say }] });
    const seriesOut = repairVideo(series, { material: "The balance is 1967, then 3870, then 7612." });
    expect(seriesOut.script!.scenes[0].template).toBe("line");
    expect(seriesOut.issues).toContain("template:alias:example");

    const invented = JSON.stringify({ scenes: [{ template: "line", title: "Guess", points: [{ x: 1, y: 7 }, { x: 2, y: 9 }, { x: 3, y: 11 }], narration: say }] });
    const inventedOut = repairVideo(invented, { material: "No figures are given." });
    expect(inventedOut.script!.scenes[0].template).not.toBe("line");
    expect(inventedOut.issues).toContain("line:invented-numbers");

    const amount = JSON.stringify({ scenes: [{ template: "example", title: "$1000 at 7% for 10 years", amount: "$1,967", narration: say }] });
    const amountOut = repairVideo(amount, { material: "It grows to 1967." });
    expect(amountOut.script!.scenes[0].template).toBe("number");
    expect((amountOut.script!.scenes[0] as { value: number }).value).toBe(1967);

    const market = "At $2, buyers want 900 cups and cafés offer 300. At $3, demand is 700 and supply 500. At $4, both are 600.";
    const table = JSON.stringify({
      scenes: [{ template: "example", title: "Coffee", data: [{ price: 2, demand: 900, supply: 300 }, { price: 3, demand: 700, supply: 500 }, { price: 4, demand: 600, supply: 600 }], narration: say }],
    });
    const tableOut = repairVideo(table, { material: market });
    expect(tableOut.script!.scenes[0].template).toBe("line");
    expect((tableOut.script!.scenes[0] as { points: { x: number; y: number }[] }).points.map((p) => p.y)).toEqual([900, 700, 600]);

    const pair = JSON.stringify({ scenes: [{ template: "equilibrium", title: "Equilibrium", price: 4, demand: 600, supply: 600, narration: say }] });
    const pairOut = repairVideo(pair, { material: market });
    expect(pairOut.script!.scenes[0].template).toBe("bars");
    expect((pairOut.script!.scenes[0] as { bars: { value: number }[] }).bars.map((b) => b.value)).toEqual([600, 600]);

    const wide = "x".repeat(80);
    const code = JSON.stringify({ scenes: [{ template: "code", language: "python", code: wide, narration: say }] });
    const codeOut = repairVideo(code);
    expect((codeOut.script!.scenes[0] as { code: string }).code.length).toBeLessThanOrEqual(64);
    expect(codeOut.issues).toContain("code:line-too-long");
  });

  test("a storyboard with no title card or recap gets both", () => {
    const raw = JSON.stringify({
      title: "The French Revolution",
      scenes: [
        { template: "points", title: "Causes", points: ["Fiscal crisis", "Bread prices", "New ideas about rights"], narration: say },
        { template: "timeline", title: "1789", events: [{ when: "1789", what: "The Bastille falls" }, { when: "1793", what: "The king is tried" }], narration: [{ speaker: "A", text: "The year 1789 changed France." }, { speaker: "B", text: "What happened that summer?" }] },
        { template: "quote", text: "The Bastille fell on 14 July 1789.", by: "", narration: [{ speaker: "A", text: "The Bastille fell on 14 July 1789." }, { speaker: "B", text: "That was the turning point." }] },
      ],
    });
    const { script, issues } = repairVideo(raw);
    expect(script!.scenes.map((s) => s.template)).toEqual(["title", "points", "timeline", "quote", "recap"]);
    expect(script!.scenes[0]).toMatchObject({ template: "title", title: "The French Revolution" });
    expect(issues).toEqual(expect.arrayContaining(["shape:no-opening", "shape:no-recap"]));
  });

  test("text is cleaned for the screen", () => {
    expect(cleanText("**Eigen** $\\lambda_1 \\geq \\lambda_2$", 90)).toBe("Eigen λ₁ ≥ λ₂");
    expect(cleanText("x^{2} + y^2", 90)).toBe("x² + y²");
    expect(cleanText("a ".repeat(80), 20).length).toBeLessThanOrEqual(20);
  });

  test("nothing usable is reported, not invented", () => {
    expect(repairVideo("I can't help with that.").script).toBeNull();
    expect(repairVideo('{"title":"x","scenes":[]}').script).toBeNull();
  });
});

describe("the prompt and timing", () => {
  test("the guide lists every template, html only when allowed", () => {
    expect(videoGuide({ scenes: 8 })).not.toContain("### html");
    expect(videoGuide({ scenes: 8, allowHtml: true })).toContain("### html");
    const [sys, user] = videoPrompt({ title: "PCA", pages: [{ page: 1, text: "PCA finds directions." }], minutes: 2 });
    expect(sys.content).toContain("### bars");
    expect(sys.content).toContain("code fence");
    expect(sys.content).toContain("12 to 25 words");
    expect(user.content).toContain("7 scenes");
  });
  test("scene times follow the narration", () => {
    const t = timeline([{ template: "quote", text: "x", by: "", narration: [{ speaker: "A", text: "one two three four five six" }, { speaker: "B", text: "ok" }] }], () => 2);
    expect(t.scenes[0].lines).toEqual([{ start: 0.6, duration: 2 }, { start: 2.9, duration: 2 }]);
    expect(t.total).toBeCloseTo(0.6 + 2 + 0.3 + 2 + 0.9);
  });
});
