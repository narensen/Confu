// Who runs on whose AI. Confu is open source and has no paid plan: everyone
// brings their own AI, a Groq key saved in Settings or a tutor that runs on
// their own computer (lib/harnesses.ts).
//   null     a student, on their own key
//   'admin'  whoever runs this deployment; their requests use the server's
//            GROQ_API_KEYS. Set by hand in the database, never by the app.

export type Role = "admin" | null;

export const isOwner = (role: Role) => role === "admin";
