// Plans, shared by the server and the UI.
//   Free  brings their own Groq key (role NULL)
//   Pro   runs on Confu's keys with a daily fair-use allowance (role 'pro')
//   Owner is Pro without the allowance (role 'admin')

export type Role = "admin" | "pro" | null;
export type Plan = "free" | "pro";

export const planOf = (role: Role): Plan => (role === "pro" || role === "admin" ? "pro" : "free");
export const isOwner = (role: Role) => role === "admin";

export const PLANS: Record<Plan, { name: string; tagline: string; features: string[] }> = {
  free: {
    name: "Free",
    tagline: "Everything Confu does, on your own Groq key.",
    features: [
      "Study, exam prep and paper sessions",
      "Highlight-to-ask, figure reading, practice questions",
      "Bring your own Groq key (Groq has a free tier)",
      "Usage meter for your key",
    ],
  },
  pro: {
    name: "Pro",
    tagline: "No API key, no setup. Just learn.",
    features: [
      "Everything in Free",
      "No Groq key needed: runs on Confu's keys",
      "A daily fair-use allowance, shown in your account menu",
    ],
  },
};
