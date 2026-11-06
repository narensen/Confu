import type { ReactNode } from "react";

export type GuideStep = {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  points: { label: string; body: ReactNode }[];
  tip?: ReactNode;
  art: ReactNode;
  onlyForKeyUsers?: boolean;
};

/* ------------------------------------------------------------ mock-up kit */
// Miniature versions of the real UI, drawn with the same styles.

function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-ink bg-panel shadow-hard-sm ${className}`}>{children}</div>;
}

function Line({ w = "100%", dark = false }: { w?: string; dark?: boolean }) {
  return <div className={`h-1.5 rounded-full ${dark ? "bg-ink/70" : "bg-line"}`} style={{ width: w }} />;
}

function Chip({ children, dark = false, dashed = false }: { children: ReactNode; dark?: boolean; dashed?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px font-mono text-[9px] ${
        dark ? "border-ink bg-ink text-white" : dashed ? "border-dashed border-ink/60" : "border-ink/60"
      }`}
    >
      {children}
    </span>
  );
}

function Btn({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span className={`inline-flex rounded-md border border-ink px-2 py-1 text-[10px] font-medium whitespace-nowrap ${dark ? "bg-ink text-white" : "bg-panel"}`}>
      {children}
    </span>
  );
}

function Pointer({ className = "" }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className={`absolute drop-shadow ${className}`} aria-hidden>
      <path d="M4 2l16 9-7 2-3 7z" fill="var(--ink)" stroke="var(--panel)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------- illustrations */

const WelcomeArt = (
  <div className="flex h-full flex-col items-center justify-center gap-5">
    <p className="font-serif text-5xl font-semibold tracking-tight">
      Confu<span className="text-yellow-500">.</span>
    </p>
    <div className="grid w-full max-w-xs grid-cols-3 gap-2 text-center">
      {(
        [
          ["Your goal", <path key="g" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />],
          ["Your files", <path key="p" d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8" />],
          ["Your progress", <path key="m" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />],
        ] as const
      ).map(([label, icon]) => (
        <Frame key={label} className="flex flex-col items-center px-2 py-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            {icon}
          </svg>
          <p className="mt-1.5 text-[10px] font-medium">{label}</p>
        </Frame>
      ))}
    </div>
  </div>
);

const SessionsArt = (
  <div className="flex h-full flex-col justify-center gap-3">
    <div className="flex items-center justify-between">
      <p className="font-serif text-lg">What are you learning?</p>
      <Btn dark>+ New session</Btn>
    </div>
    <Frame className="p-3">
      <p className="font-serif text-sm">PCA for drug discovery ✎</p>
      <p className="mt-0.5 font-mono text-[9px] text-muted">3 PDFs · 214 pages</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Chip>D1 PCA notes</Chip>
        <Chip>D2 Lecture 7</Chip>
        <Chip>D3 Kinase paper</Chip>
      </div>
      <p className="mt-2 text-[10px]">Explain PCA of chemical space at lab meeting</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-ink/40">
        <div className="h-full w-2/5 bg-ink" />
      </div>
      <p className="mt-1 font-mono text-[9px] text-muted">4/11 topics · 9 days left</p>
    </Frame>
  </div>
);

const KeyArt = (
  <div className="flex h-full flex-col justify-center gap-3">
    <p className="font-mono text-[9px] tracking-widest text-muted uppercase">Bring your own AI</p>
    <p className="font-serif text-lg leading-tight">Connect the AI you&apos;ll study with</p>
    <Btn dark>Connect OpenRouter</Btn>
    <div className="flex flex-wrap gap-1 text-[9px]">
      {["Groq", "OpenAI", "Anthropic", "Gemini", "Other"].map((p, i) => (
        <span key={p} className={`rounded-full border px-1.5 py-0.5 ${i === 0 ? "border-ink bg-ink text-white" : "border-line text-muted"}`}>
          {p}
        </span>
      ))}
    </div>
    <Frame className="flex items-center justify-between px-3 py-2">
      <span className="font-mono text-[11px] tracking-widest">gsk_••••••••••••••••</span>
      <span className="text-[9px] text-muted">Show</span>
    </Frame>
    <div className="space-y-1 text-[10px]">
      <p className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border-[3px] border-ink" /> Save to my account
      </p>
      <p className="flex items-center gap-1.5 text-muted">
        <span className="size-2.5 rounded-full border border-ink" /> Only this session
      </p>
    </div>
    <Btn dark>Verify &amp; save</Btn>
    <div className="flex items-center gap-2 text-[10px] text-muted">
      Saved, encrypted:
      <span className="rounded-md border border-line px-1.5 py-0.5 font-mono">gsk_••••a9F2</span>
    </div>
  </div>
);

const GoalArt = (
  <div className="flex h-full flex-col justify-center gap-2.5">
    <div className="rounded-lg border border-dashed border-ink/40 bg-paper p-2.5">
      <p className="text-[10px] font-medium">Tip: draft your goal with any AI</p>
      <span className="mt-1.5 flex gap-1">
        <span className="inline-flex rounded border border-ink bg-ink px-1.5 py-0.5 text-[9px] text-white">Open in ChatGPT ↗</span>
        <span className="inline-flex rounded border border-ink bg-ink px-1.5 py-0.5 text-[9px] text-white">Open in Claude ↗</span>
      </span>
    </div>
    <Frame className="space-y-1 p-2.5">
      <p className="text-[9px] font-medium">Your goal</p>
      <p className="text-[10px] leading-snug">
        <b>### Outcome</b> Explain PCA and apply it to our compound library…
      </p>
      <p className="text-[10px] leading-snug">
        <b>### Materials</b> PCA tutorial, Shlens · DOI 10.48550/arXiv.1404.1100
      </p>
      <Line w="70%" />
    </Frame>
    <div className="rounded-lg border border-dashed border-ink/40 px-2.5 py-1.5 text-[9px]">
      <b className="font-medium">Set my own pace (optional)</b> <span className="text-muted">· or let Confu size it</span>
    </div>
    <Btn dark>Build my plan</Btn>
  </div>
);

const PlanArt = (
  <div className="flex h-full flex-col justify-center gap-2">
    <p className="font-mono text-[9px] tracking-widest text-muted uppercase">Phase 01</p>
    <p className="font-serif text-base leading-tight">Foundations</p>
    {[
      { n: "✓", t: "Linear algebra refresher", tag: <Chip>D1 pp. 3–8</Chip>, done: true },
      { n: "2", t: "Python data handling", tag: <Chip dashed>Beyond your files</Chip>, focus: true },
      { n: "3", t: "Molecular fingerprints", tag: <Chip>D3 pp. 21–26</Chip> },
    ].map((row) => (
      <Frame key={row.t} className={`flex items-center gap-2 px-2.5 py-2 ${row.focus ? "" : "shadow-none border-line"}`}>
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${
            row.done ? "border-ink bg-ink text-white" : "border-ink"
          }`}
        >
          {row.n}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[11px] ${row.done ? "text-muted line-through" : "font-medium"}`}>{row.t}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted">
            {row.tag} Due Nov 12
          </div>
        </div>
        <div className="h-1 w-8 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-ok" style={{ width: row.done ? "90%" : row.focus ? "35%" : "0%" }} />
        </div>
      </Frame>
    ))}
    <div className="rounded-md border border-line px-2.5 py-1.5 text-[9px]">
      <span className="mr-2 font-mono text-muted uppercase">Lecture</span>StatQuest: PCA clearly explained ↗
    </div>
  </div>
);

const ReadingArt = (
  <Frame className="relative flex h-full overflow-hidden text-[9px] shadow-hard">
    <div className="flex w-[27%] shrink-0 flex-col border-r border-ink bg-panel">
      <span className="border-b border-ink px-2 py-1.5 font-medium">Tutor</span>
      <div className="flex-1 space-y-1.5 p-1.5">
        <p className="ml-auto w-4/5 rounded border border-ink px-1 py-0.5">Why the square?</p>
        <Line w="90%" />
        <Line w="70%" />
      </div>
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex border-b border-ink bg-paper">
        <span className="flex items-center gap-1 border-r border-ink/15 bg-panel px-2 py-1.5 font-medium">
          <Chip dark>D1</Chip> PCA notes
        </span>
        <span className="flex items-center gap-1 px-2 py-1.5 text-muted">
          <Chip>D2</Chip> Lecture 7
        </span>
      </div>
      <div className="flex items-center gap-1.5 border-b border-ink px-2 py-1.5">
        <span className="rounded border border-ink/30 px-1 font-mono">12</span>
        <span className="text-muted">Contents · Search</span>
        <span className="rounded border border-ink px-1.5">Capture</span>
      </div>
      <div className="flex flex-1 justify-center bg-viewer p-2.5">
        <div className="w-11/12 space-y-1.5 border border-ink bg-white p-2.5">
          <Line w="50%" dark />
          <Line />
          <Line w="92%" />
          <Line w="85%" />
          <Line w="70%" />
        </div>
      </div>
    </div>
    {/* A tool slid out over the page, from the rail */}
    <div className="absolute inset-y-0 right-[11%] flex w-[30%] flex-col border-l border-ink bg-panel">
      <span className="flex items-center justify-between border-b border-ink px-2 py-1.5 font-medium">
        Plan <span className="rounded border border-ink/40 px-1 font-mono text-[7px] text-muted">Pin</span>
      </span>
      <div className="space-y-1.5 p-1.5">
        <Line w="80%" dark />
        <Line w="95%" />
        <Line w="60%" />
      </div>
    </div>
    <div className="flex w-[11%] shrink-0 flex-col items-center gap-1 border-l border-ink bg-panel py-1.5 text-[7px]">
      <span className="w-[85%] rounded bg-ink py-1 text-center text-white">Plan</span>
      <span className="py-1 text-muted">Highlights</span>
      <span className="py-1 text-muted">Progress</span>
      <span className="py-1 text-muted">Files</span>
    </div>
  </Frame>
);

const HighlightArt = (
  <div className="relative flex h-full items-center justify-center">
    <div className="w-full space-y-2 rounded border border-ink bg-white p-4 text-[10px] leading-relaxed">
      <p>
        The first principal component is the direction of{" "}
        <span className="bg-[rgba(253,216,53,0.55)]">maximal variance; its eigenvalue equals the variance captured</span> along it.
      </p>
      <Line w="90%" />
      <Line w="75%" />
    </div>
    <div className="animate-pop absolute top-[62%] left-1/2 flex -translate-x-1/2 gap-0.5 rounded-lg border border-ink bg-panel p-1 shadow-hard-sm">
      <Btn dark>Ask a doubt</Btn>
      <Btn>Summarize</Btn>
      <Btn>Context</Btn>
      <Btn>Simplify</Btn>
      <span className="flex items-center gap-1 px-1.5 text-[10px]">
        <span className="size-2 rounded-sm bg-yellow-300" />
        Highlight
      </span>
    </div>
    <Pointer className="top-[47%] right-[30%]" />
  </div>
);

const FigureArt = (
  <div className="relative flex h-full items-center justify-center">
    <div className="relative w-full rounded border border-ink bg-white p-4">
      <svg viewBox="0 0 200 110" className="w-full" aria-hidden>
        <line x1="20" y1="95" x2="190" y2="95" stroke="var(--ink)" strokeWidth="1" />
        <line x1="20" y1="95" x2="20" y2="8" stroke="var(--ink)" strokeWidth="1" />
        {[
          [40, 70],
          [55, 62],
          [62, 75],
          [75, 50],
          [90, 55],
          [100, 40],
          [120, 38],
          [135, 30],
          [150, 25],
          [165, 18],
          [110, 60],
          [70, 80],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill={i % 3 ? "var(--ink)" : "#facc15"} />
        ))}
        <line x1="30" y1="85" x2="180" y2="15" stroke="var(--ink)" strokeDasharray="3 3" />
        <text x="150" y="105" fontSize="7" fontFamily="monospace">PC1</text>
      </svg>
      <div className="absolute inset-3 border-[1.5px] border-ink bg-ink/5 shadow-[0_0_0_9999px_rgba(13,13,12,0.12)]" />
    </div>
    <Frame className="animate-pop absolute right-2 -bottom-1 w-44 p-2 text-[9px] leading-snug">
      <p className="font-mono text-muted uppercase">Vision notes</p>
      <p className="mt-1">Scatter of compounds on PC1 vs PC2; yellow = actives cluster along PC1…</p>
    </Frame>
  </div>
);

const TutorArt = (
  <div className="flex h-full flex-col justify-center gap-2.5">
    <div className="flex items-center gap-2 rounded-md bg-paper px-2.5 py-1.5 text-[9px]">
      <span className="font-mono text-muted uppercase">Focus</span>
      <span className="flex-1 truncate font-medium">PCA and eigen decomposition</span>
      <span className="font-mono">40%</span>
    </div>
    <div className="ml-8 rounded-xl rounded-br-sm border border-ink p-2.5 text-[10px] shadow-hard-sm">
      Why is the eigenvalue the variance?
    </div>
    <div className="space-y-1.5 text-[10px] leading-relaxed">
      <p>
        Project each molecule onto the eigenvector: its spread along that line <b>is</b> the eigenvalue{" "}
        <span className="rounded bg-paper px-1 font-mono underline">D1 p. 12</span>. You already know variance, so…
      </p>
      <p className="font-medium">Check: what variance do you get along the 2nd eigenvector?</p>
    </div>
    <div className="flex gap-1.5">
      <span className="rounded-full border border-ink px-2 py-0.5 text-[9px]">Teach me this topic</span>
      <span className="rounded-full border border-ink px-2 py-0.5 text-[9px]">Check my understanding</span>
    </div>
  </div>
);

const ProgressArt = (
  <div className="flex h-full flex-col justify-center gap-3">
    <p className="border-l-2 border-ink pl-2 text-[10px] leading-relaxed">
      Beginner who learns best from derivations. Solid on variance; still shaky on eigenvectors. Next: scree plots.
    </p>
    {[
      ["Understood", "bg-ok", ["Variance", "Covariance matrix"]],
      ["Still shaky", "bg-warn", ["Eigenvectors"]],
      ["Open questions", "bg-ink", ["Why centre the data?"]],
    ].map(([title, mark, items]) => (
      <div key={title as string}>
        <p className="font-mono text-[9px] tracking-widest text-muted uppercase">{title}</p>
        {(items as string[]).map((i) => (
          <p key={i} className="mt-1 flex items-center gap-1.5 text-[10px]">
            <span className={`size-1.5 ${mark}`} />
            {i}
          </p>
        ))}
      </div>
    ))}
  </div>
);

const PapersArt = (
  <div className="flex h-full flex-col justify-center gap-2.5">
    <p className="font-mono text-[9px] tracking-widest text-muted uppercase">Reading list</p>
    {[
      ["D1", "Proximal Policy Optimization", 3, 1],
      ["D2", "DeepSeekMath: GRPO", 3, 2],
      ["D3", "Let's Verify Step by Step", 2, 2],
      ["D4", "A survey of RLHF", 1, 1],
    ].map(([label, title, target, done]) => (
      <Frame key={label as string} className={`flex items-center gap-2 px-2.5 py-1.5 ${label === "D2" ? "" : "border-line shadow-none"}`}>
        <Chip dark={label === "D2"}>{label}</Chip>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-medium">{title}</p>
          <div className="mt-1 flex gap-0.5">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`h-1 w-4 rounded-full ${n <= (done as number) ? "bg-ink" : n <= (target as number) ? "bg-ink/20" : "border border-dashed border-ink/20"}`}
              />
            ))}
          </div>
        </div>
        <div className="flex rounded border border-ink p-px font-mono text-[8px]">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`px-1 ${n === target ? "rounded-sm bg-ink text-white" : "text-muted"}`}>
              {n}
            </span>
          ))}
        </div>
      </Frame>
    ))}
    <div className="grid grid-cols-3 gap-1 text-[9px]">
      <span className="rounded border border-ink/40 px-1.5 py-1">Pass 1 ✓</span>
      <span className="rounded border border-ink bg-ink px-1.5 py-1 text-white">Pass 2</span>
      <span className="rounded border border-ink/40 px-1.5 py-1">Pass 3</span>
    </div>
  </div>
);

const ExamArt = (
  <div className="flex h-full flex-col justify-center gap-2.5">
    <div className="flex items-end justify-between">
      <div>
        <p className="font-mono text-[9px] tracking-widest text-muted uppercase">Exam</p>
        <p className="font-serif text-lg leading-tight">12 days to go</p>
      </div>
      <Chip>Mar 14</Chip>
    </div>
    <Frame className="p-3">
      <p className="font-mono text-[9px] text-muted">Question 2 of 5 · short answer</p>
      <p className="mt-1 text-[11px] font-medium leading-snug">Why does PCA centre the data before computing the covariance matrix?</p>
      <div className="mt-2 space-y-1 rounded border border-ink/30 bg-paper p-2">
        <Line w="92%" />
        <Line w="70%" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] text-muted">Answer is in D1 p. 14</span>
        <Btn dark>Mark my answer</Btn>
      </div>
    </Frame>
    <div className="rounded-lg border border-dashed border-ink/40 p-2.5">
      <p className="text-[10px] font-medium">Your weak topics</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip>Eigenvectors · 40%</Chip>
        <Chip>Scree plots · 55%</Chip>
      </div>
    </div>
  </div>
);

const ReadyArt = (
  <div className="flex h-full flex-col justify-center gap-2.5">
    {["Create a study, exam or paper session", "Set your goal, your exam date, or triage your papers", "Start learning, one idea or one question at a time"].map((t, i) => (
      <Frame key={t} className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ink font-mono text-[10px]">
          {i + 1}
        </span>
        <span className="text-[11px] font-medium">{t}</span>
      </Frame>
    ))}
  </div>
);

/* ------------------------------------------------------------------ steps */

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "welcome",
    eyebrow: "Welcome",
    title: "Learn anything deeply, not just skim it",
    intro:
      "Confu is a tutor built around one thing: the goal you're working toward. You bring your material, it plans the path, teaches you one idea at a time, and remembers what you've understood.",
    points: [
      { label: "Goal first", body: "Everything (the plan, the answers, the questions it asks you) serves your goal and deadline." },
      { label: "Grounded", body: "Answers come from your files with page citations, and go beyond them when your goal needs it." },
      { label: "It remembers", body: "It tracks what you know and where you struggle, so it builds on that instead of repeating itself." },
    ],
    tip: "This guide takes about two minutes. Use ← → on your keyboard to move between steps.",
    art: WelcomeArt,
  },
  {
    id: "sessions",
    eyebrow: "Sessions",
    title: "One session per thing you're learning",
    intro:
      "A session holds your material, chat and memory. Pick a type: a study session (goal and plan), exam prep (practice questions and weak topics), or a paper session (research papers). Your library lists them all.",
    points: [
      { label: "Start one", body: <>Press <b>+ New session</b>, pick a type and give it a title. Add files (PDFs, slides or Word docs: chapters, lecture notes, past papers) now or later; they upload while you write your goal.</> },
      { label: "Rename it", body: "Click the session title at the top of the workspace to edit it. Enter saves, Esc cancels." },
      { label: "Your library", body: "Each card shows that session's progress. Filter by type, search titles and files, and archive or delete a session from its card. The Literature map button shows every paper you've read, connected." },
    ],
    art: SessionsArt,
  },
  {
    id: "key",
    eyebrow: "Your AI",
    title: "Bring your own AI",
    intro: "Confu is free and open source; the AI runs on an account you bring. Your account may start with a few free prompts. After that, connect your AI once in Settings and every session uses it.",
    points: [
      { label: "One click", body: <>Press <b>Connect OpenRouter</b> and approve Confu on openrouter.ai. It runs on your OpenRouter credits, with hundreds of models to choose from.</> },
      { label: "Or a key", body: <>Paste an API key from Groq (free tier at <b>console.groq.com/keys</b>), OpenAI, Anthropic, Google Gemini or any OpenAI-compatible server in <b>Settings → Your AI</b>, or in the panel that appears in a session. We check it with the provider first.</> },
      { label: "Security", body: "It's encrypted before it's stored and never shown again; you'll only see its last four characters. Pick models, replace it or remove it any time in Settings. A session can also have its own." },
    ],
    tip: <>You can read your files without connecting anything; you only need it for the AI features.</>,
    art: KeyArt,
    onlyForKeyUsers: true,
  },
  {
    id: "goal",
    eyebrow: "Your goal",
    title: "Tell it exactly what you want to be able to do",
    intro: "In a new session, Plan slides out and asks for your goal. This is the most important step: the more specific it is, the better everything else gets.",
    points: [
      {
        label: "Be specific",
        body: "Say what you want to be able to do or explain, why, and what you already know. “Understand PCA” is weak; “explain PCA to my lab and apply it to our assay data” is strong.",
      },
      { label: "Use any AI", body: <>Press <b>Open in ChatGPT</b> or <b>Open in Claude</b> (or copy the prompt for any other AI) to draft your goal. It asks for each paper&apos;s title, authors and DOI and each lecture&apos;s YouTube link; paste the result back.</> },
      { label: "Papers and lectures", body: "Papers and YouTube lectures your goal names are added for you. Anything Confu can't pin down waits in Files, under “From your goal”." },
      { label: "Pace is optional", body: "Leave it and the plan is sized to your goal; or set hours a day or a deadline (the other follows). You can change it later with Custom pace." },
    ],
    tip: "Plans are AI-generated and can contain mistakes. You can edit your goal and rebuild the plan any time.",
    art: GoalArt,
  },
  {
    id: "plan",
    eyebrow: "Your plan",
    title: "A path built from your goal, across your files and beyond",
    intro: "Confu maps your files and builds a plan in phases, from foundations to application, at a pace you can tune.",
    points: [
      { label: "Topic tags", body: <><Chip>D1 pp. 3–8</Chip> means read those pages of that file. <Chip dashed>Beyond your files</Chip> means your files don&apos;t cover it, so the tutor teaches it and suggests resources.</> },
      { label: "Open a topic", body: "See what you should be able to do and the key concepts. “Listen (2 min)” gives a spoken preview before you read. In “Go deeper”, papers open Confu's paper search." },
      { label: "Stay on track", body: "Mark a topic done, then lock it in with three quick recall questions. Behind? Press Re-pace, or Custom pace, and spin the dial: the rest of the plan reschedules from today." },
    ],
    art: PlanArt,
  },
  {
    id: "reading",
    eyebrow: "Reading",
    title: "The tutor beside you, your tools a click away",
    intro: "The tutor sits on the left, what you're reading is in the middle, and your tools (Plan, Highlights, Progress, Files) are in the rail on the right. Each one slides out over the page when you need it.",
    points: [
      { label: "Tools", body: <>Press a tool in the right rail (or its key: <b>p</b>, <b>h</b>, <b>f</b>) to slide it out. Click back into the page, or press Esc, to put it away. <b>Pin</b> keeps it open beside the page instead.</> },
      { label: "Files and tabs", body: <>Everything you add lands in <b>Files</b>; open one and it becomes a tab (D1, D2, …). ✕ on a tab only closes it; delete files from Files. PDFs, slides and Word docs all work.</> },
      { label: "Make room", body: "Drag any edge to resize, or fold the tutor away (t) to read wider; it comes back when it answers. Full screen (⛶ or the . key) keeps the same layout without the header. Press ? for every shortcut." },
    ],
    art: ReadingArt,
  },
  {
    id: "highlight",
    eyebrow: "Text highlight",
    title: "Select any text to ask about it",
    intro: "Highlight a sentence or paragraph with your cursor and a menu appears.",
    points: [
      { label: "Ask a doubt", body: "Type what confuses you about that exact passage." },
      { label: "Summarize · Context · Simplify", body: "Get the core claim, see how it fits with what comes before and after, or have it explained in plain words with an example." },
      { label: "Highlight", body: "Save it in a colour. Saved passages are listed in Highlights, where you can jump back, ask about them later, or export the whole session (Markdown, or Anki cards)." },
    ],
    art: HighlightArt,
  },
  {
    id: "figure",
    eyebrow: "Figure capture",
    title: "Drag over a figure, table or equation",
    intro: "Text selection can't read images. For those, use the general highlight.",
    points: [
      { label: "Capture", body: "Press it in the toolbar, then drag a box over the figure. Add a question if you like, then press Explain." },
      { label: "Vision model", body: "A vision model reads it: labels, axes, values, equations. The tutor then explains how to read it and why it matters." },
      { label: "Remembered", body: "The figure's description is saved and used as context whenever you're on that page again." },
    ],
    tip: "Scanned PDFs have no selectable text. Capture regions to let the tutor read them.",
    art: FigureArt,
  },
  {
    id: "tutor",
    eyebrow: "The tutor",
    title: "Learn one idea at a time",
    intro: "The tutor, on the left, is where the learning happens. It always knows your goal, the current topic and what you already understand.",
    points: [
      { label: "Teach me / Check my understanding", body: "Teach covers the next idea in your current topic. Check asks one question that tests understanding, not memory, and grades your answer honestly." },
      { label: "Citations", body: <>Page references like <span className="rounded bg-paper px-1 font-mono text-xs underline">D1 p. 12</span> are clickable and jump straight to that page.</> },
      { label: "Stays on track", body: "It won't re-explain what you've got, changes approach when you're stuck, and steers off-topic questions back to your goal." },
    ],
    art: TutorArt,
  },
  {
    id: "progress",
    eyebrow: "Progress",
    title: "See what the tutor knows about you",
    intro: "After every exchange, Confu updates its notes on you. Progress, in the tools on the right, shows them.",
    points: [
      { label: "Your profile", body: "A short summary of where you are and how you learn best." },
      { label: "Understood · shaky · misconceptions · open questions", body: "What you've shown you understand, what needs work, and what's still unresolved." },
      { label: "Mastery by topic", body: "Estimated from your answers, not from what you've read. When a topic reaches ~75%, it suggests marking it understood." },
    ],
    art: ProgressArt,
  },
  {
    id: "papers",
    eyebrow: "Paper sessions",
    title: "Read research papers in three passes",
    intro:
      "Choose “Paper session” when you start a session, then add papers by arXiv ID, DOI, link or title. No PDF needed. It follows S. Keshav's three-pass method: each pass goes deeper, and you stop once you have what you need.",
    points: [
      { label: "Pass 1, bird's-eye view (5–10 min)", body: "Abstract, introduction, headings, conclusion, then the five Cs: category, context, correctness, contributions, clarity. Most papers stop here." },
      { label: "Pass 2, the content (~1 hour)", body: "Read it properly, skip the proofs, scrutinise the figures, and explain the main idea and evidence. The tutor grades your explanation." },
      { label: "Pass 3, re-implementation (hours)", body: "Rebuild it from its assumptions with the tutor; list hidden assumptions, missing experiments and weaknesses. That's where research ideas come from." },
    ],
    tip: "Write your research goal in Passes and press “Suggest a pass for each paper”. The tutor can also search the literature and find who cites a paper.",
    art: PapersArt,
  },
  {
    id: "exam",
    eyebrow: "Exam prep",
    title: "Revise for an exam with your own notes",
    intro: "Choose “Exam prep” when you start a session, add your course files (notes, slides, past papers) and set the exam date. It keeps things simple: a countdown, practice, and your weak spots.",
    points: [
      { label: "Practise", body: "Five exam-style questions at a time, written from your own material, from one file or all of them." },
      { label: "Get marked", body: "Write your answer as you would in the exam. It's marked strictly, with what you missed and where in your notes the answer is." },
      { label: "Weak topics", body: "Your results find the topics you keep getting wrong. Press “Practise these” to drill them before the day." },
    ],
    tip: "The tutor is there too: ask about any question, or highlight a passage in your notes.",
    art: ExamArt,
  },
  {
    id: "ready",
    eyebrow: "You're ready",
    title: "Start your first session",
    intro: "That's everything. The fastest way to learn the app is to use it.",
    points: [
      { label: "1", body: <>Press <b>+ New session</b>, choose Study, Exam prep or Papers, and name it.</> },
      { label: "2", body: "Write your goal in Plan (Open in ChatGPT helps) and build your plan." },
      { label: "3", body: <>Open the first topic&apos;s pages, or press <b>Teach me</b>. Highlight anything you don&apos;t get.</> },
    ],
    tip: <>Reopen this guide any time from <b>Settings → Help &amp; legal</b>.</>,
    art: ReadyArt,
  },
];
