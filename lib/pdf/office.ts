// PowerPoint isn't uploaded directly: people convert it to PDF first.
export const isPowerPoint = (f: File) => /\.(pptx?|key|odp)$/i.test(f.name) || /presentation|powerpoint/i.test(f.type);

export const PPT_CONVERTER_URL = "https://www.ilovepdf.com/powerpoint_to_pdf";

export const POWERPOINT_HELP =
  "Slides need to be a PDF first. Convert it free online, or export it yourself: PowerPoint → File → Export → PDF; Google Slides → File → Download → PDF.";
