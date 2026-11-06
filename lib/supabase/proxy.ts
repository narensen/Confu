import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/session", "/doc", "/settings", "/reset-password", "/welcome", "/review", "/admin", "/rooms", "/friends", "/threads", "/spaces", "/wrapped", "/map"];
const AUTH_PAGES = ["/login", "/signup"];

// Refreshes the Supabase session cookie on every request and performs an
// optimistic redirect. Real authorization happens in the DAL and RLS.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (path === "/login") url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  // A sign-in code that landed somewhere other than /auth/confirm (Supabase
  // falls back to the Site URL when a redirect isn't allow-listed): finish
  // the sign-in instead of dropping it.
  const code = request.nextUrl.searchParams.get("code");
  if (code && !pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/confirm";
    url.search = "";
    url.searchParams.set("code", code);
    url.searchParams.set("next", "/welcome");
    return NextResponse.redirect(url);
  }

  if (!signedIn && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    return redirectTo("/login");
  }
  if (signedIn && AUTH_PAGES.includes(pathname)) {
    return redirectTo("/dashboard");
  }

  return response;
}
