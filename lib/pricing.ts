// Pro's price, shown by where the visitor is (Vercel tells us the country).
// India pays ₹299 a month, everywhere else $6. Lemon Squeezy charges every
// order in US dollars, so the India price is set there as its dollar
// equivalent and the rupee figure here is what the student sees on our pages.

export type Region = "india" | "intl";

export const PRICES: Record<Region, { amount: string; per: string; note: string }> = {
  india: { amount: "₹299", per: "month", note: "Charged in US dollars at about ₹299; your bank shows the exact rupee amount." },
  intl: { amount: "$6", per: "month", note: "Taxes may be added at checkout, depending on where you live." },
};

export const regionOf = (country: string | null | undefined, indiaAvailable = true): Region =>
  indiaAvailable && country?.trim().toUpperCase() === "IN" ? "india" : "intl";

// College and university email domains (.edu, .ac.in, .edu.au, …), for the student discount.
export const isAcademicEmail = (email: string | null | undefined) =>
  Boolean(email && /@([a-z0-9-]+\.)*(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i.test(email.trim()));
