"use client";

import { setReaderPref, setSingleKeys, useReaderPref, useSingleKeys, type ReaderPref } from "@/lib/prefs";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { Row, Section } from "./Section";

// How Confu looks and responds on this device: the app's theme, the PDF's
// reading theme, and the workspace's one-key shortcuts. Kept in this browser.

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-ink/25 p-0.5 text-sm">
      {options.map(([v, name]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 transition ${value === v ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function AppearanceSection() {
  const theme = useTheme();
  const reader = useReaderPref();
  const singleKeys = useSingleKeys();
  return (
    <Section id="appearance" title="Appearance" description="How Confu looks and responds on this device.">
      <Row label="Theme" hint="Auto follows your system's light or dark setting.">
        <Choice<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            ["system", "Auto"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
        />
      </Row>
      <Row label="Reading theme" hint="How PDF pages are drawn. Match the app shows them in night colours when the app is dark. The Theme button above a PDF changes it too.">
        <Choice<ReaderPref>
          label="Reading theme"
          value={reader}
          onChange={setReaderPref}
          options={[
            ["auto", "Match the app"],
            ["light", "Light"],
            ["sepia", "Sepia"],
            ["night", "Night"],
          ]}
        />
      </Row>
      <Row
        label="One-key shortcuts"
        hint="In a session, single keys like t, p, f, h and z fold the tutor, open tools and go full screen. Turn them off if stray key presses move things around. Ctrl/Cmd shortcuts and Esc keep working."
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={singleKeys} onChange={(e) => setSingleKeys(e.target.checked)} className="size-4" />
          {singleKeys ? "On" : "Off"}
        </label>
      </Row>
    </Section>
  );
}
