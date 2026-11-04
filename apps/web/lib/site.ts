// Public site details: the contact address appears on the legal pages and in Settings.
export const SITE = {
  name: "Confu",
  contactEmail: "confuedu.ai@gmail.com",
  policyDate: "November 1, 2026",
  // Where links in emails and calendar feeds point.
  // An empty value in .env counts as unset.
  url: (process.env.NEXT_PUBLIC_SITE_URL || "https://confu.lol").replace(/\/$/, ""),
};
