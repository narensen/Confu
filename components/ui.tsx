import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, HTMLAttributes, InputHTMLAttributes } from "react";

// Confu's basic pieces. Use the components; the class strings stay exported
// for the few places that style something that isn't one of these (a
// <select>, a <label> that wraps a file input…).

export const inputClass =
  "w-full rounded-lg border border-ink/25 bg-panel px-3 py-2 text-sm outline-none transition duration-200 placeholder:text-muted/70 hover:border-ink/50 focus:border-ink focus:shadow-hard-sm";

export const labelClass = "mb-1.5 block text-sm font-medium";

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-on-ink transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm active:translate-y-0 active:shadow-none disabled:pointer-events-none disabled:opacity-40";

export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-ink bg-panel px-3 py-2 text-sm font-medium transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm active:translate-y-0 active:shadow-none disabled:pointer-events-none disabled:opacity-40";

export const cardClass = "rounded-xl border border-ink bg-panel";

export const eyebrowClass = "font-mono text-xs font-medium uppercase tracking-[0.12em] text-muted";

export type ButtonVariant = "primary" | "ghost";

const join = (base: string, extra?: string) => (extra ? `${base} ${extra}` : base);
const variantClass = (v: ButtonVariant) => (v === "ghost" ? ghostButtonClass : buttonClass);

type Variant = { variant?: ButtonVariant };

// A button. Defaults to type="button", so it never submits a form by accident.
export function Button({ variant = "primary", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & Variant) {
  return <button type={type} className={join(variantClass(variant), className)} {...props} />;
}

// A link that looks like a button, for pages inside Confu.
export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & Variant) {
  return <Link className={join(variantClass(variant), className)} {...props} />;
}

// The same, for downloads, mailto: and other sites.
export function ButtonAnchor({ variant = "primary", className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & Variant) {
  return <a className={join(variantClass(variant), className)} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={join(inputClass, className)} {...props} />;
});

// The small label above a heading.
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={join(eyebrowClass, className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={join(cardClass, className)} {...props} />;
}
