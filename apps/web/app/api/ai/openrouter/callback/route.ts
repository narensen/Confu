import { NextResponse, type NextRequest } from "next/server";
import { connection } from "next/server";
import { listModels } from "@confu/ai/models";
import { OPENROUTER_EXCHANGE, readState, STATE_COOKIE, STATE_PATH } from "@confu/ai/openrouter";
import { pickModels } from "@confu/ai/providers";
import { storeKey } from "@/lib/ai-keys";
import { isEncryptionConfigured } from "@/lib/crypto";
import { getUser } from "@/lib/dal";
import { logError } from "@/lib/log";
import { FLASH_COOKIE } from "@/lib/referrals";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// Back from openrouter.ai: trade the code (and our PKCE verifier) for the
// student's key, store it encrypted, and go back where they started.
export async function GET(request: NextRequest) {
  await connection();
  const state = readState(request.cookies.get(STATE_COOKIE)?.value);
  const back = (flash: string) => {
    const res = NextResponse.redirect(new URL(state ? safeNext(state.n) : "/settings#api-key", request.url));
    res.cookies.set(STATE_COOKIE, "", { path: STATE_PATH, maxAge: 0 });
    res.cookies.set(FLASH_COOKIE, flash, { path: "/", maxAge: 600, sameSite: "lax" });
    return res;
  };

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  // Started by someone else, or too long ago.
  if (!state || state.u !== user.id) return back("openrouter-failed");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back("openrouter-cancelled");
  if (!isEncryptionConfigured()) return back("openrouter-failed");

  let key: string | undefined;
  try {
    const res = await fetch(OPENROUTER_EXCHANGE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: state.v, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) key = ((await res.json()) as { key?: string }).key;
    else logError("openrouter connect", new Error(`exchange answered ${res.status}`));
  } catch (err) {
    logError("openrouter connect", err);
  }
  if (!key) return back("openrouter-failed");

  const list = await listModels("openrouter", key);
  const supabase = await createClient();
  try {
    await storeKey(supabase, user.id, state.s, { provider: "openrouter", key, baseUrl: null, models: pickModels("openrouter", list.ok ? list.models : []), via: "oauth" });
  } catch (err) {
    logError("openrouter connect: store", err);
    return back("openrouter-failed");
  }
  return back("openrouter");
}
