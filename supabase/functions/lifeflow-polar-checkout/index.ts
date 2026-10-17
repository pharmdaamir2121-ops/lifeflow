import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://pharmdaamir2121-ops.github.io/lifeflow/app/";
const cors = {
  "Access-Control-Allow-Origin": "https://pharmdaamir2121-ops.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
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

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Please sign in first." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = Deno.env.get("LIFEFLOW_PUBLIC_KEY")
      || Deno.env.get("SUPABASE_ANON_KEY")
      || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const polarToken = Deno.env.get("POLAR_ACCESS_TOKEN");
    const productId = "2bf38fc1-3ad8-489b-aa7b-c2166a2fb372";

    if (!supabaseUrl || !publicKey || !polarToken || !productId) {
      return json({ error: "Polar checkout is not fully configured yet." }, 503);
    }

    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    const user = userResult?.user;
    if (userError || !user?.id) return json({ error: "Your session is not valid. Please sign in again." }, 401);

    const checkoutResponse = await fetch("https://api.polar.sh/v1/checkouts/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${polarToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        products: [productId],
        external_customer_id: user.id,
        customer_email: user.email || undefined,
        success_url: APP_URL + "?billing=success&checkout_id={CHECKOUT_ID}",
        return_url: APP_URL + "?billing=cancelled",
        metadata: { user_id: user.id, app: "lifeflow" }
      })
    });

    const result = await checkoutResponse.json().catch(() => ({}));
    if (!checkoutResponse.ok || !result?.url) {
      console.error("Polar checkout creation failed", checkoutResponse.status, result);
      return json({ error: "Could not start checkout. Please try again later." }, 502);
    }

    return json({ url: result.url });
  } catch (error) {
    console.error("Polar checkout function failed", error);
    return json({ error: "Unexpected checkout error." }, 500);
  }
});
