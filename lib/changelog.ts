// What's new in Confu, newest first: shown at /changelog and in its RSS feed.
// Written for students, not developers: what changed and why it helps.

export type Release = { date: string; title: string; summary: string; items: string[] };

export const CHANGELOG: Release[] = [
  {
    date: "2026-10-27",
    title: "Lock it in, listen ahead, take it with you",
    summary: "Recall checks, audio overviews, playlists, exports and dark mode.",
    items: [
      "Quick recall check: mark a topic done and answer three questions from memory. What you miss comes back in review.",
      "Listen (2 min): a spoken preview of any topic, what it's about and what to watch for, before you read it.",
      "Import a whole YouTube playlist: pick the lectures and they come in one by one, each with its own progress.",
      "Export a session as Markdown (for Obsidian, Notion or any editor), or your review cards for Anki.",
      "Dark mode: Auto, Light or Dark under Appearance in your account menu.",
      "Behind schedule? Re-pace from today with one tap, and spin the Custom pace dial to fit your week.",
      "Watch your plan take shape: topics appear as they're written.",
      "Files shows what's coming in, with Retry if something fails, and what your goal names that isn't added yet.",
      "Open your goal prompt straight in ChatGPT or Claude. Keyboard shortcuts in the workspace: press ?.",
    ],
  },
  {
    date: "2026-10-26",
    title: "Your whole literature, connected",
    summary: "One map of every paper you've read, and a plan that starts while your PDFs upload.",
    items: [
      "Your literature map: every paper across your sessions, the foundations they share and the newer work citing them. Pick a session to see its part, and spot the papers that connect your projects.",
      "Write your goal while your PDFs upload: the plan waits for them, then builds itself.",
      "Goals now start from a template with a Materials section, and Confu checks it as you paste: paper DOIs, YouTube links, and anything missing.",
      "Your goal draft is saved as you type, so leaving the page doesn't lose it.",
    ],
  },
  {
    date: "2026-10-26",
    title: "Pro, study packs, literature maps and study rooms",
    summary: "The biggest update yet: share what worked, see how papers connect, and study alongside others.",
    items: [
      "Pro: ₹299 a month in India, $6 elsewhere, cancel anytime. Checkout opens soon; until then, request Pro from Settings → Plan.",
      "Invite friends: they get a week of Pro when they join, and you get a week once they've studied.",
      "Study packs: share a session's sources, plan and highlights as a page others can copy. Class mode lets students choose to share their progress with you.",
      "Goal templates: eleven ready-made goals with free lectures, readings and papers, from neural networks to quantum computing.",
      "Literature map: see how a session's papers cite each other, the foundations they share and newer work that builds on them.",
      "New papers citing what you read now appear in your weekly email.",
      "Papers: export BibTeX, send your pass notes to Zotero, draft a related-work section from your notes, and compare papers side by side.",
      "Study rooms: a shared focus timer and a few people quietly working alongside you.",
      "Study time in your calendar: pick a daily time, and your calendar feed blocks it out with the topic that's next.",
      "Wrapped: your month of studying in numbers, with a page you can share.",
    ],
  },
  {
    date: "2026-10-26",
    title: "Papers inside study sessions",
    summary: "Mix textbooks and research papers in one session, and read the papers like a researcher.",
    items: [
      "Confu spots which PDFs are research papers (with Semantic Scholar and OpenAlex) and gives them the three-pass tools.",
      "Name papers in your goal and Confu offers to add them, with their open-access PDFs.",
      "PowerPoint and Word files are turned into PDFs through your Google Drive when you upload them.",
      "Archive sessions you've finished instead of deleting them, so your streak keeps their days.",
    ],
  },
  {
    date: "2026-10-25",
    title: "Import anything, and a better reading room",
    summary: "Bring in the web, lectures and your libraries, and stay focused while you read.",
    items: [
      "Import web pages, YouTube lectures (from their transcripts), Google Drive and Zotero.",
      "Sites that block automated reading can be pasted in instead.",
      "Reader: search, contents, light, sepia and night themes, a reading map, read aloud, a focus timer and white, pink and brown noise.",
      "Streaks and a study heatmap, review reminders, a weekly summary email, notifications and a calendar feed of your plan.",
      "Install Confu as an app on your computer or phone.",
    ],
  },
  {
    date: "2026-10-21",
    title: "Start here, and spaced review",
    summary: "Know what to do first, and remember what you finished.",
    items: [
      "A Start here card for every plan, and goal starters built from your PDFs' chapters.",
      "Spaced review: finished topics, passages you asked about and practice questions you missed come back just before you'd forget them.",
      "In full screen, the tutor sits beside your PDF.",
    ],
  },
  {
    date: "2026-10-20",
    title: "Confu launches",
    summary: "An AI tutor that works from your own material.",
    items: [
      "Study toward a goal with a phased plan, prepare for exams with practice questions from your notes, or read papers with the three-pass method.",
      "Highlight any passage to ask about it; drag over a figure or equation to have it read and explained.",
      "Answers cite the page they came from.",
    ],
  },
];
