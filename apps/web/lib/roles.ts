// Roles, shared by the server and the UI. There are no plans: everyone
// brings their own AI (a key or a connected account; see lib/ai/providers.ts).
//   NULL     everyone
//   'admin'  the owner: the admin dashboard, and the server's own keys
//            (GROQ_API_KEYS). A personal key is used first; the server keys
//            still answer when that provider can't.

export type Role = "admin" | null;

export const isOwner = (role: Role) => role === "admin";
