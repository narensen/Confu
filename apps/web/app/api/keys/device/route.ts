import { loadConnection } from "@/lib/ai-keys";
import { createClient } from "@/lib/supabase/server";

// The account's own AI (an OpenRouter connection or a saved key), handed to
// the on-device app (/app) in this person's own browser, so it works there
// without connecting again. The device keeps it encrypted and calls the
// provider directly. Only Confu's own pages can ask (a POST other sites can't
// make with these cookies, and their browsers refuse them the answer anyway).

export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ error: "Not allowed." }, { status: 403 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });

  const conn = await loadConnection(supabase, userId, null);
  const headers = { "Cache-Control": "no-store" };
  if (!conn) return Response.json({ ai: null }, { headers });
  return Response.json(
    {
      ai: {
        provider: conn.provider,
        key: conn.key,
        baseUrl: conn.provider === "custom" ? conn.baseUrl : null,
        via: conn.via,
        models: conn.models,
      },
    },
    { headers },
  );
}
