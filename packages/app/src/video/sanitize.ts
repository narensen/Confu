// A custom scene's HTML/SVG, written by a model from the student's material
// (which could say anything): only drawing tags and drawing attributes
// survive. No scripts, links, images, styles that load things, or handlers.

const TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan", "defs", "marker",
  "div", "span", "p", "b", "strong", "i", "em", "sub", "sup", "br", "ul", "ol", "li", "h1", "h2", "h3", "h4", "small", "code", "pre",
  "table", "thead", "tbody", "tr", "td", "th", "figure", "figcaption",
]);

const ATTRS = new Set([
  "class", "data-step", "viewbox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "width", "height", "transform",
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "text-anchor", "dominant-baseline", "font-size", "font-weight",
  "opacity", "fill-opacity", "stroke-opacity", "marker-end", "marker-start", "id", "refx", "refy", "markerwidth", "markerheight", "orient", "colspan", "rowspan", "dx", "dy", "style",
]);

// Inline style: layout and colour only.
const STYLE_PROPS = /^(color|background-color|font-size|font-weight|font-style|text-align|margin(-\w+)?|padding(-\w+)?|border(-\w+)*|border-radius|display|gap|flex(-\w+)?|align-items|justify-content|width|height|max-width|line-height|opacity|fill|stroke|stroke-width|grid-template-columns)$/;

function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((d) => d.trim())
    .filter((d) => {
      const [prop, ...rest] = d.split(":");
      const value = rest.join(":").trim();
      return prop && value && STYLE_PROPS.test(prop.trim().toLowerCase()) && !/url\s*\(|expression|@import|javascript:|position|var\(/i.test(value);
    })
    .join("; ");
}

export type Sanitized = { html: string; steps: number; visible: boolean };

export function sanitizeDrawing(raw: string): Sanitized {
  if (typeof DOMParser === "undefined") return { html: "", steps: 0, visible: false };
  const doc = new DOMParser().parseFromString(`<!doctype html><body><div id="root">${raw}</div></body>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return { html: "", steps: 0, visible: false };
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (!TAGS.has(tag)) {
        child.remove();
        continue;
      }
      for (const a of [...child.attributes]) {
        const name = a.name.toLowerCase();
        const value = a.value;
        if (!ATTRS.has(name) || /javascript:|data:/i.test(value)) child.removeAttribute(a.name);
        else if (name === "style") child.setAttribute("style", cleanStyle(value));
        else if (/url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/.test(value.trim())) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  walk(root);
  const shapes = root.querySelectorAll("path,circle,ellipse,rect,line,polyline,polygon,text").length;
  const words = (root.textContent ?? "").trim().length;
  const steps = new Set([...root.querySelectorAll("[data-step]")].map((e) => e.getAttribute("data-step"))).size;
  return { html: root.innerHTML, steps, visible: shapes > 0 || words > 0 };
}
