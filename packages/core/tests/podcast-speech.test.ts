import { describe, expect, test } from "bun:test";
import { speechChunks } from "../src/podcast";

describe("speechChunks", () => {
  test("short lines stay whole", () => {
    expect(speechChunks("So what is PCA after?")).toEqual(["So what is PCA after?"]);
  });

  test("long lines split at sentence ends, every piece within the limit", () => {
    const text = "The first principal component is the direction of greatest variance. ".repeat(6) + "That's the idea.";
    const parts = speechChunks(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(200);
    expect(parts.join(" ")).toBe(text.replace(/\s+/g, " ").trim());
    expect(parts[0].endsWith(".")).toBe(true);
  });

  test("no sentence end: commas, then spaces, never mid-word", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const parts = speechChunks(text, 50);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(50);
      expect(p.startsWith(" ") || p.endsWith(" ")).toBe(false);
    }
    expect(parts.join(" ")).toBe(text);
  });

  test("one huge word is cut, not dropped", () => {
    const parts = speechChunks("x".repeat(450));
    expect(parts.join("")).toBe("x".repeat(450));
  });
});
