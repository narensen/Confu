import { describe, expect, test } from "bun:test";
import { TEMPLATES } from "@confu/core/templates";
import { addCoursePaper, sessionPlan, setTopicStatus, startCourse } from "@confu/client/courses";
import { listDocuments } from "@confu/client/library";
import { bunDriver } from "@confu/storage/drivers/bun";
import { memoryFiles } from "@confu/storage/files";
import { Store } from "@confu/storage/store";

describe("courses", () => {
  test("starting a course makes a session with its goal and every topic, spread over its weeks", async () => {
    const store = await Store.open(bunDriver(), { device: "dev-a" });
    const t = TEMPLATES[0];
    const now = new Date("2026-11-06T00:00:00Z");
    const s = await startCourse(store, t, now);
    expect(s.title).toBe(t.title);
    const plan = (await sessionPlan(store, s.id))!;
    expect(plan.goal).toBe(t.goal);
    expect(plan.template?.slug).toBe(t.slug);
    const all = t.outline.flatMap((p) => p.topics);
    expect(plan.topics.map((x) => x.title)).toEqual(all);
    expect(plan.topics.at(-1)!.due_date).toBe(plan.deadline);
    expect(plan.topics[0].due_date > "2026-11-06").toBe(true);
    await setTopicStatus(store, plan.topics[0].id, "completed");
    expect((await sessionPlan(store, s.id))!.topics[0]).toMatchObject({ status: "completed" });
  });

  test("an open paper from a course is added as a PDF", async () => {
    const store = await Store.open(bunDriver(), { device: "dev-a" });
    const files = memoryFiles();
    const t = TEMPLATES.find((x) => x.sources.some((s) => s.pdf_url))!;
    const s = await startCourse(store, t);
    const source = t.sources.find((x) => x.pdf_url)!;
    let asked = "";
    await addCoursePaper(store, files, {
      sessionId: s.id,
      source,
      extract: async () => ({ pageCount: 1, pages: ["Attention is all you need."], outline: [] }),
      fetchPdf: async (url) => ((asked = url), new Blob(["%PDF"])),
    });
    expect(asked).toBe(source.pdf_url!);
    expect((await listDocuments(store, s.id)).map((d) => d.title)).toEqual([source.title]);
  });
});
