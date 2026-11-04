// A photo of a board becomes one PDF page. The session upload then reads it
// the same way it reads a scanned page. No second vision path.

import { PDFDocument } from "pdf-lib";

const A4 = { w: 595.28, h: 841.89 };

export async function boardPhotoPdf(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo.");
  if (file.size > 12_000_000) throw new Error("That photo is over 12 MB. Step back a little and take it again.");
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't read that photo.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
  if (!blob) throw new Error("Couldn't read that photo.");
  const pdf = await PDFDocument.create();
  const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const page = pdf.addPage([A4.w, A4.h]);
  const fit = Math.min((A4.w - 48) / img.width, (A4.h - 48) / img.height);
  const dw = img.width * fit;
  const dh = img.height * fit;
  page.drawImage(img, { x: (A4.w - dw) / 2, y: (A4.h - dh) / 2, width: dw, height: dh });
  const out = await pdf.save();
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, " ").trim().slice(0, 60) || "Board";
  return new File([Uint8Array.from(out)], `${base}.pdf`, { type: "application/pdf" });
}
