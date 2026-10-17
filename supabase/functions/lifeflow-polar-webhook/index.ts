import { createClient } from "npm:@supabase/supabase-js@2";
import { validateEvent } from "npm:@polar-sh/sdk/webhooks";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, webhook-id, webhook-timestamp, webhook-signature"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const webhookSecret = Deno.env.get("POLAR_WEBHOOK_SECRET");
  const serviceKey = Deno.env.get("LIFEFLOW_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const expectedProductId = "2bf38fc1-3ad8-489b-aa7b-c2166a2fb372";

  if (!webhookSecret || !serviceKey || !supabaseUrl) {
    return json({ error: "Polar webhook is not fully configured." }, 503);
  }

  try {
    const rawBody = await req.text();
    const headers = {
      "webhook-id": req.headers.get("webhook-id") || "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
      "webhook-signature": req.headers.get("webhook-signature") || ""
    };

    const event = validateEvent(rawBody, headers, webhookSecret) as {
      type: string;
      data: Record<string, any>;
    };
    const subscriptionEvents = new Set([
      "subscription.created",
      "subscription.active",
      "subscription.updated",
      "subscription.canceled",
      "subscription.uncanceled",
      "subscription.past_due",
      "subscription.revoked"
    ]);

    if (!subscriptionEvents.has(event.type)) return json({ received: true, ignored: true });

    const data = event.data || {};
    if (!data.id || String(data.product_id || "") !== expectedProductId) {
      console.warn("Ignoring Polar subscription event for an unexpected product or missing ID.");
      return json({ received: true, ignored: true });
    }

    const customer = data.customer || {};
    const userId = String(data.metadata?.user_id || customer.external_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      console.warn("Ignoring Polar subscription event without a valid LifeFlow user ID.");
      return json({ received: true, ignored: true });
    }

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    let status = String(data.status || "inactive").toLowerCase();
    const currentPeriodEnd = data.current_period_end || null;
    const endsAt = data.ends_at || data.ended_at || null;

    if (event.type === "subscription.active") status = "active";
    if (event.type === "subscription.canceled") {
      const scheduledEnd = data.cancel_at_period_end === true
        && currentPeriodEnd
        && new Date(currentPeriodEnd).getTime() > Date.now();
      status = scheduledEnd ? "active" : "canceled";
    }
    if (event.type === "subscription.revoked") status = "revoked";
    if (event.type === "subscription.past_due") status = "past_due";

    const row = {
      user_id: userId,
      provider: "polar",
      provider_subscription_id: String(data.id),
      provider_customer_id: data.customer_id ? String(data.customer_id) : (customer.id ? String(customer.id) : null),
      provider_order_id: null,
      product_id: String(data.product_id),
      variant_id: null,
      status,
      renews_at: currentPeriodEnd,
      ends_at: event.type === "subscription.canceled" && status === "active"
        ? currentPeriodEnd
        : endsAt,
      updated_at: new Date().toISOString()
    };

    const { error } = await service
      .from("subscriptions")
      .upsert(row, { onConflict: "provider,provider_subscription_id" });

    if (error) {
      console.error("Polar subscription upsert failed", error);
      return json({ error: "Database update failed" }, 500);
    }

    return json({ received: true, event: event.type, status });
  } catch (error) {
    console.error("Polar webhook verification or processing failed", error);
    return json({ error: "Invalid webhook signature or payload" }, 403);
  }
});
