import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Social preview images (1200×630) in Confu's style: paper background, black
// frame with a hard shadow, serif title, yellow accent.
export const OG_SIZE = { width: 1200, height: 630 };

const fonts = Promise.all([
  readFile(join(process.cwd(), "public/fonts/NotoSerif-Regular.ttf")),
  readFile(join(process.cwd(), "public/fonts/NotoSerif-Bold.ttf")),
  readFile(join(process.cwd(), "public/fonts/NotoSansMono-Regular.ttf")),
]);

export async function ogCard(o: { eyebrow: string; title: string; sub?: string; footer?: string }) {
  const [serif, serifBold, mono] = await fonts;
  const title = o.title.length > 90 ? `${o.title.slice(0, 88)}…` : o.title;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f4f3ee", padding: 56 }}>
        <div style={{ display: "flex", flex: 1, background: "#0d0d0c", borderRadius: 28, paddingRight: 14, paddingBottom: 14 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              background: "#ffffff",
              border: "3px solid #0d0d0c",
              borderRadius: 26,
              padding: "48px 56px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: "Serif", fontWeight: 700, fontSize: 40, display: "flex" }}>
                Confu<span style={{ color: "#eab308" }}>.</span>
              </div>
              <div style={{ fontFamily: "Mono", fontSize: 22, letterSpacing: 3, color: "#62625d", textTransform: "uppercase" }}>{o.eyebrow}</div>
            </div>
            <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
              <div style={{ fontFamily: "Serif", fontSize: title.length > 50 ? 64 : 80, lineHeight: 1.1, color: "#0d0d0c", display: "flex" }}>{title}</div>
            </div>
            {o.sub && <div style={{ fontFamily: "Serif", fontSize: 30, color: "#62625d", display: "flex", marginBottom: 18 }}>{o.sub}</div>}
            {o.footer && (
              <div style={{ display: "flex" }}>
                <div style={{ fontFamily: "Mono", fontSize: 22, background: "#fde047", border: "2px solid #0d0d0c", borderRadius: 10, padding: "8px 16px" }}>{o.footer}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Serif", data: serif, weight: 400, style: "normal" },
        { name: "Serif", data: serifBold, weight: 700, style: "normal" },
        { name: "Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
