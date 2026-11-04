import { NextResponse, type NextRequest } from "next/server";
import { INVITE_CODE, INVITE_COOKIE } from "@/lib/referrals";

// An invite link: remember the code for 30 days, then off to sign up.
export async function GET(request: NextRequest, ctx: RouteContext<"/r/[code]">) {
  const code = (await ctx.params).code.toLowerCase();
  const url = new URL("/signup", request.url);
  if (!INVITE_CODE.test(code)) return NextResponse.redirect(url);
  url.searchParams.set("ref", code);
  const res = NextResponse.redirect(url);
  res.cookies.set(INVITE_COOKIE, code, { path: "/", maxAge: 30 * 86400, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  return res;
}
