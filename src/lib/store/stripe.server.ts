/**
 * Per-store Stripe (bring-your-own-key). Each producer stores their own
 * secret key in `store_stripe_config`, which is service-role only — it is
 * never selectable by the browser or by anon.
 *
 * Plain REST over fetch so nothing Node-only ends up in the worker bundle.
 */

const API = "https://api.stripe.com/v1";

type AnyRow = Record<string, any>;

export async function getStripeConfig(storeId: string): Promise<{ secretKey: string | null; webhookSecret: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("store_stripe_config").select("secret_key, webhook_secret").eq("store_id", storeId).maybeSingle();
  const row = data as AnyRow | null;
  return { secretKey: row?.secret_key ?? null, webhookSecret: row?.webhook_secret ?? null };
}

function flatten(obj: unknown, prefix = "", out: string[][] = []): string[][] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object") {
    out.push([prefix, String(obj)]);
    return out;
  }
  for (const [k, v] of Object.entries(obj as AnyRow)) {
    flatten(v, prefix ? `${prefix}[${k}]` : k, out);
  }
  return out;
}

export async function stripeRequest(
  secretKey: string,
  path: string,
  body?: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
): Promise<AnyRow> {
  const form = new URLSearchParams();
  for (const [k, v] of flatten(body ?? {})) form.append(k, v);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : form,
  });
  const text = await res.text();
  let json: AnyRow = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json?.error?.message as string) || text.slice(0, 200) || `Stripe error ${res.status}`;
    console.error(`[stripe] ${method} ${path} failed [${res.status}]: ${msg}`);
    throw new Error(msg);
  }
  return json;
}

/** Subscription Checkout Session using inline price_data (no dashboard setup). */
export async function createSubscriptionCheckout(opts: {
  secretKey: string;
  currency: string;
  productName: string;
  amountCents: number;
  interval: "month" | "year";
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<string> {
  const session = await stripeRequest(opts.secretKey, "/checkout/sessions", {
    mode: "subscription",
    customer_email: opts.customerEmail,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    allow_promotion_codes: "true",
    metadata: opts.metadata,
    subscription_data: { metadata: opts.metadata },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: opts.currency.toLowerCase(),
          unit_amount: Math.round(opts.amountCents),
          recurring: { interval: opts.interval },
          product_data: { name: opts.productName },
        },
      },
    ],
  });
  const url = session.url as string | undefined;
  if (!url) throw new Error("Stripe did not return a checkout URL.");
  return url;
}

export async function createBillingPortal(secretKey: string, customerId: string, returnUrl: string): Promise<string> {
  const session = await stripeRequest(secretKey, "/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url as string;
}

/** Constant-time compare of two hex strings. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify the `Stripe-Signature` header against the raw body. */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqualHex(expected, v1.toLowerCase());
}