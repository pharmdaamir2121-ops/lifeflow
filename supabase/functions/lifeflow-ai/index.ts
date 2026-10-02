import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required." }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: "Supabase auth is not configured." }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: auth } }
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session." }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const context = body?.context && typeof body.context === "object" ? body.context : {};

    if (!message) {
      return new Response(JSON.stringify({ error: "Message required." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (message.length > 2000) {
      return new Response(JSON.stringify({ error: "Message is too long." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "AI service is not configured yet." }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [
          { role: "system", content: "You are LifeFlow Coach. Give concise, practical personal productivity guidance. Use the user's supplied LifeFlow context. Do not provide medical, legal, or financial advice as professional advice." },
          { role: "user", content: "LifeFlow context:\n" + JSON.stringify(context).slice(0, 12000) + "\n\nUser: " + message }
        ],
        max_output_tokens: 500
      })
    });

    const j = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: j.error?.message || "AI request failed" }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const answer = j.output_text || j.output?.flatMap(x => x.content || []).map(x => x.text || "").join("") || "";
    return new Response(JSON.stringify({ answer, user_id: user.id }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});