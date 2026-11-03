import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

// "Export my data": everything Confu stores about the signed-in user, as JSON.
// Row-level security limits every query to their own rows. API keys are
// never exported (only their last four characters).
export async function GET() {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const table = async (name: string, columns = "*") => {
    const { data, error } = await supabase.from(name).select(columns).limit(50_000);
    return error ? { unavailable: error.message } : data;
  };

  const [profile, sessions, documents, plans, topics, memory, highlights, messages, paperReviews, examAttempts, keys, usage, feedback, answerFeedback, events] = await Promise.all([
    table("profiles", "full_name, role, created_at"),
    table("study_sessions"),
    table("documents", "id, session_id, title, page_count, status, source_url, meta, outline, created_at"),
    table("study_plans"),
    table("plan_topics"),
    table("learner_memory"),
    table("highlights", "id, document_id, kind, page_number, selected_text, vlm_description, note, created_at"),
    table("messages", "id, session_id, document_id, role, action, content, page_number, created_at"),
    table("paper_reviews"),
    table("exam_attempts"),
    table("ai_keys", "session_id, provider, last4, via, base_url, chat_model, fast_model, vision_model, created_at"),
    table("ai_usage", "session_id, model, feature, prompt_tokens, completion_tokens, total_tokens, created_at"),
    table("feedback", "kind, message, path, status, created_at"),
    table("answer_feedback", "rating, comment, correction, answer, path, created_at"),
    table("events", "name, path, props, created_at"),
  ]);

  const body = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at, profile },
    sessions,
    documents,
    study_plans: plans,
    plan_topics: topics,
    learner_memory: memory,
    highlights,
    messages,
    paper_reviews: paperReviews,
    exam_attempts: examAttempts,
    api_keys: keys,
    ai_usage: usage,
    feedback,
    answer_feedback: answerFeedback,
    usage_events: events,
    note: "PDF files themselves aren't included; download them from your sessions. API keys are never exported.",
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="confu-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
