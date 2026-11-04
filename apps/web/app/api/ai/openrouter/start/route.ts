import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { connection } from "next/server";
import { OPENROUTER_AUTH, STATE_COOKIE, STATE_PATH, type ConnectState } from "@confu/ai/openrouter";
import { getUser } from "@/lib/dal";
import { safeNext } from "@/lib/safe-next";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Off to openrouter.ai to approve Confu. ?session= saves the connection for
// one session only; ?next= is where to come back to.
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next") ?? "/settings#api-key");
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url));

  const session = params.get("session");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state: ConnectState = { v: verifier, u: user.id, s: session && UUID.test(session) ? session : null, n: next };

  const auth = new URL(OPENROUTER_AUTH);
  auth.searchParams.set("callback_url", new URL(`${STATE_PATH}/callback`, request.nextUrl.origin).toString());
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(auth);
  res.cookies.set(STATE_COOKIE, JSON.stringify(state), {
    path: STATE_PATH,
    maxAge: 15 * 60,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
