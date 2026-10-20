import { createClient } from "npm:@supabase/supabase-js@2";

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

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyPolarWebhook(rawBody: string, req: Request, secretValue: string) {
  const messageId = req.headers.get("webhook-id") || "";
  const timestampHeader = req.headers.get("webhook-timestamp") || "";
  const signatureHeader = req.headers.get("webhook-signature") || "";

  if (!messageId || !timestampHeader || !signatureHeader) {
    throw new Error("Missing required Polar webhook signature headers.");
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid Polar webhook timestamp.");

  // Standard Webhooks signatures are only accepted for a short window to prevent replay.
  const now = Math.floor(Date.now() / 1000);
  const seconds = Math.floor(timestamp);
  if (Math.abs(now - seconds) > 300) {
    throw new Error("Polar webhook timestamp is outside the allowed five-minute window.");
  }

  let secret = secretValue.trim();
  if (secret.startsWith("whsec_")) secret = secret.slice("whsec_".length);
  const secretBytes = decodeBase64(secret);
  if (!secretBytes.length) throw new Error("Polar webhook signing secret is empty.");

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedContent = new TextEncoder().encode(`${messageId}.${seconds}.${rawBody}`);
  const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedContent));
  let binary = "";
  for (const byte of signatureBytes) binary += String.fromCharCode(byte);
  const expected = btoa(binary);

  const valid = signatureHeader.split(" ").some((part) => {
    const comma = part.indexOf(",");
    if (comma < 0) return false;
    const version = part.slice(0, comma);
    const signature = part.slice(comma + 1);
    return version === "v1" && constantTimeEqual(signature, expected);
  });

  if (!valid) throw new Error("Polar webhook signature did not match.");
  return JSON.parse(rawBody);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const webhookSecret = Deno.env.get("POLAR_WEBHOOK_SECRET");
  const serviceKey = Deno.env.get("LIFEFLOW_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const expectedProductId = "2bf38fc1-3ad8-489b-aa7b-c2166a2fb372";

  if (!webhookSecret || !serviceKey || !supabaseUrl) {
    console.error("Polar webhook configuration is missing a required secret or Supabase URL.");
    return json({ error: "Polar webhook is not fully configured." }, 503);
  }

  try {
    const rawBody = await req.text();
    const event = await verifyPolarWebhook(rawBody, req, webhookSecret) as {
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
      "subscription.revoked",
      "subscription.paused",
      "subscription.resumed"
    ]);

    // Checkout events are acknowledged, but do not grant Pro. Only subscription events update entitlement.
    if (!subscriptionEvents.has(event.type)) {
      return json({ received: true, ignored: true, event: event.type });
    }

    const data = event.data || {};
    if (!data.id || String(data.product_id || "") !== expectedProductId) {
      console.warn("Ignoring Polar subscription event for an unexpected product or missing ID.");
      return json({ received: true, ignored: true });
    }

    const customer = data.customer || {};
    const userId = String(data.metadata?.user_id || customer.external_id || data.external_customer_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      console.warn("Ignoring Polar subscription event without a valid LifeFlow user ID.");
      return json({ received: true, ignored: true });
    }

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    let status = String(data.status || "inactive").toLowerCase();
    const currentPeriodEnd = data.current_period_end || data.current_billing_period_end || null;
    const endsAt = data.ends_at || data.ended_at || null;

    if (event.type === "subscription.active") status = "active";
    if (event.type === "subscription.canceled") {
      const scheduledEnd = data.cancel_at_period_end === true
        && currentPeriodEnd
        && new Date(currentPeriodEnd).getTime() > Date.now();
      status = scheduledEnd ? "active" : "canceled";
    }
    if (event.type === "subscription.uncanceled" || event.type === "subscription.resumed") status = "active";
    if (event.type === "subscription.revoked") status = "revoked";
    if (event.type === "subscription.past_due") status = "past_due";
    if (event.type === "subscription.paused") status = "paused";

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
    return json({ error: "Invalid Polar webhook signature or payload" }, 403);
  }
});
