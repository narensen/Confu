import { createClient as createAnon } from "@supabase/supabase-js";
import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";

// A short course link. The plan page is public; this only finds which pack.
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[code]">) {
  const code = (await ctx.params).code.toLowerCase();
  const home = new URL("/packs", request.url);
  if (!/^[a-z0-9]{4,10}$/.test(code)) return NextResponse.redirect(home);
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const bump = anon.rpc("bump_course_request", { p_code: code });
  after(async () => {
    await bump.then(
      () => undefined,
      () => undefined,
    );
  });
  const { data } = await anon.rpc("lookup_course", { p_code: code });
  const slug = typeof data === "string" ? data : null;
  if (!slug) return NextResponse.redirect(home);
  return NextResponse.redirect(new URL(`/p/${slug}`, request.url));
}
