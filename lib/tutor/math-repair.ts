// KaTeX reserves a few characters that models write as plain text inside
// math: \text{#filters}, 95%, \text{input_channels}, \text{weights & biases}.
// One of them fails the whole formula (a red "ParseError"), and % is worse:
// it silently drops everything after it. Escape them inside math.
//
// Only in math that is clearly LaTeX (a command, a sub/superscript or a
// brace), so a price line like "$5 for #1 and $6" is left as it was.

const TEXT_COMMAND = /\\(?:text(?:bf|it|rm|sf|tt|normal|up)?|mbox)\s*\{([^{}]*)\}/g;
const LATEX = /\\[A-Za-z]|[_^{}]/;

function repairSpan(math: string): string {
  if (!LATEX.test(math)) return math;
  // Words inside \text{}: _ and & are text there, not subscripts or columns.
  let out = math.replace(TEXT_COMMAND, (whole: string, body: string) => whole.replace(body, body.replace(/(?<!\\)([_&#%])/g, "\\$1")));
  out = out.replace(/(?<!\\)([#%])/g, "\\$1");
  // & lines up columns, but only inside an environment.
  if (!/\\begin\s*\{/.test(out)) out = out.replace(/(?<!\\)&/g, "\\&");
  return out;
}

/** Markdown with the math in it made safe for KaTeX. Code is left alone. */
export function repairMath(md: string): string {
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => `$$${repairSpan(m)}$$`)
            .replace(/(?<![\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, m: string) => `$${repairSpan(m)}$`)
            // A formula alone on its line is a display equation. remark-math
            // only draws one when the $$ sit on their own lines; on one line
            // it came out inline, small and cramped. (In a table it stays inline.)
            .replace(/^([ \t]*)\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, indent: string, m: string) => `${indent}$$\n${indent}${m.trim()}\n${indent}$$`),
    )
    .join("");
}
