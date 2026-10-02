import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-signature, x-event-name"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const secret = Deno.env.get("LEMON_SQUEEZY_SIGNING_SECRET");
    const serviceKey = Deno.env.get("LIFEFLOW_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!secret || !serviceKey || !supabaseUrl) {
      return json({ error: "Billing webhook is not configured." }, 503);
    }

    const rawBody = await req.text();
    const signature = req.headers.get("X-Signature") || "";
    const expected = await hmacSha256(secret, rawBody);

    if (!safeEqual(signature, expected)) {
      return json({ error: "Invalid signature" }, 401);
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.meta?.event_name || req.headers.get("X-Event-Name") || "";
    const customData = payload?.meta?.custom_data || {};
    const userId = String(customData.user_id || "");
    const data = payload?.data || {};
    const attrs = data?.attributes || {};

    if (!userId) return json({ error: "Missing custom_data.user_id" }, 400);
    if (!data?.id) return json({ error: "Missing subscription id" }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const status = String(attrs.status || "inactive");
    const row = {
      user_id: userId,
      provider: "lemonsqueezy",
      provider_subscription_id: String(data.id),
      provider_customer_id: attrs.customer_id ? String(attrs.customer_id) : null,
      provider_order_id: attrs.order_id ? String(attrs.order_id) : null,
      product_id: attrs.product_id ? String(attrs.product_id) : null,
      variant_id: attrs.variant_id ? String(attrs.variant_id) : null,
      status,
      renews_at: attrs.renews_at || null,
      ends_at: attrs.ends_at || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await admin
      .from("subscriptions")
      .upsert(row, { onConflict: "provider,provider_subscription_id" });

    if (error) {
      console.error("subscription upsert failed", error);
      return json({ error: "Database update failed" }, 500);
    }

    return json({ ok: true, event, status });
  } catch (e) {
    console.error(e);
    return json({ error: "Invalid webhook request" }, 400);
  }
});
