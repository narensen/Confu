import { describe, expect, test } from "bun:test";
import { cardsPrompt, grade, interval, newSchedule, parseCards, preview } from "@confu/core/cards";
import { clock, transcriptPages, transcriptionModel } from "@confu/core/lecture";
import { parsePodcast } from "@confu/core/podcast";

describe("flashcards", () => {
  test("parses the model's cards, dropping bad ones, duplicates and unknown pages", () => {
    const raw = 'Sure! {"cards":[{"front":"What is ATP?","back":"The cell\'s energy carrier.","page":2},{"front":"what is atp?","back":"dup","page":2},{"front":"","back":"no front"},{"front":"Krebs cycle?","back":"Makes NADH.","page":99}]}';
    expect(parseCards(raw, new Set([1, 2]))).toEqual([
      { front: "What is ATP?", back: "The cell's energy carrier.", page: 2 },
      { front: "Krebs cycle?", back: "Makes NADH.", page: null },
    ]);
    expect(parseCards("not json", new Set())).toEqual([]);
  });

  test("the prompt carries page numbers and asks for JSON", () => {
    const [sys, user] = cardsPrompt({ pages: [{ page: 4, text: "Mitosis." }], count: 5, title: "Bio" });
    expect(sys.content).toContain('{"cards"');
    expect(user.content).toContain("[p. 4]");
  });

  test("scheduling: Again soon, Easy later, and lapses counted", () => {
    const now = new Date("2026-11-06T09:00:00Z");
    const fresh = newSchedule(now);
    expect(fresh).toMatchObject({ state: 0, reps: 0 });
    const p = preview(fresh, now);
    expect(p[1]).toBe("1 min");
    expect(p[4]).toMatch(/d$/);
    let s = grade(fresh, 4, now);
    expect(new Date(s.due).getTime()).toBeGreaterThan(now.getTime() + 86_400_000);
    s = grade(s, 1, new Date(s.due));
    expect(s.lapses).toBe(1);
    expect(interval(now, new Date(now.getTime() + 3 * 86_400_000))).toBe("3 d");
  });
});

describe("lectures", () => {
  test("a timed transcript becomes five-minute pages that start with their time", () => {
    const { pages, starts } = transcriptPages({
      text: "",
      segments: [
        { start: 0, end: 4, text: "Today, entropy." },
        { start: 30, end: 40, text: "It measures disorder." },
        { start: 610, end: 620, text: "The second law." },
      ],
    });
    expect(pages).toEqual(["[0:00] Today, entropy. It measures disorder.", "[10:00] The second law."]);
    expect(starts).toEqual([0, 600]);
    expect(clock(3725)).toBe("1:02:05");
  });

  test("an untimed transcript is split by length", () => {
    expect(transcriptPages({ text: Array(1500).fill("word").join(" ") }).pages.length).toBe(3);
  });

  test("knows which providers transcribe", () => {
    expect(transcriptionModel("groq")).toBe("whisper-large-v3-turbo");
    expect(transcriptionModel("anthropic")).toBeNull();
    expect(transcriptionModel("custom", ["llama3", "whisper-small"])).toBe("whisper-small");
  });
});

describe("podcasts", () => {
  test("parses a two-voice script", () => {
    expect(parsePodcast('{"title":"Cells","lines":[{"speaker":"A","text":" Hi. "},{"speaker":"Z","text":"Hello"},{"speaker":"B","text":""}]}')).toEqual({
      title: "Cells",
      lines: [
        { speaker: "A", text: "Hi." },
        { speaker: "A", text: "Hello" },
      ],
    });
    expect(parsePodcast("nope")).toBeNull();
  });
});
