// Highlight colours carry meaning, like a careful student's set of pens.

export type HighlightColor = "yellow" | "blue" | "red" | "green";

export const HIGHLIGHT_COLORS: Record<HighlightColor, { label: string; hint: string; fill: string; swatch: string }> = {
  yellow: { label: "Important", hint: "Key ideas worth remembering", fill: "rgba(253, 216, 53, 0.42)", swatch: "#fdd835" },
  blue: { label: "Definition", hint: "Terms and what they mean", fill: "rgba(96, 165, 250, 0.32)", swatch: "#60a5fa" },
  red: { label: "Confusing", hint: "Come back to these, or ask about them", fill: "rgba(248, 113, 113, 0.34)", swatch: "#f87171" },
  green: { label: "Example", hint: "Worked examples and illustrations", fill: "rgba(74, 222, 128, 0.3)", swatch: "#4ade80" },
};

export const COLOR_ORDER: HighlightColor[] = ["yellow", "blue", "red", "green"];

export const colorOf = (c: string | null | undefined): HighlightColor => (c && c in HIGHLIGHT_COLORS ? (c as HighlightColor) : "yellow");
