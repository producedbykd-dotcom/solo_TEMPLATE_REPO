/**
 * Per-store Stripe webhook. Each producer points their own Stripe account at
 * /api/public/stripe/<their store id>. The raw body is verified against that
 * store's own signing secret before anything is written.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getStripeConfig, verifyStripeSignature } from "@/lib/store/stripe.server";

type AnyRow = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (unix: unknown) => (typeof unix === "number" ? new Date(unix * 1000).toISOString() : null);

export const Route = createFileRoute("/api/public/stripe/$storeId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const storeId = params.storeId;
        if (!UUID.test(storeId)) return new Response("not found", { status: 404 });

        const raw = await request.text();
        const { webhookSecret } = await getStripeConfig(storeId);
        if (!webhookSecret) return new Response("not configured", { status: 400 });

        const ok = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), webhookSecret);
        if (!ok) {
          console.error("[stripe] signature verification failed", { storeId });
          return new Response("invalid signature", { status: 401 });
        }

        let event: AnyRow;
        try { event = JSON.parse(raw); } catch { return new Response("bad payload", { status: 400 }); }
        const obj = (event?.data?.object ?? {}) as AnyRow;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const subs = () => supabaseAdmin.from("store_subscribers") as any;

        switch (event.type) {
          case "checkout.session.completed": {
            const subscriberId = obj.metadata?.subscriber_id as string | undefined;
            if (!subscriberId) break;
            await subs()
              .update({
                status: "active",
                stripe_customer_id: obj.customer ?? null,
                stripe_subscription_id: obj.subscription ?? null,
                leases_used: 0,
                downloads_used: 0,
                current_period_start: new Date().toISOString(),
              })
              .eq("id", subscriberId)
              .eq("store_id", storeId);
            break;
          }
          case "customer.subscription.updated":
          case "customer.subscription.created": {
            const status = obj.status === "active" || obj.status === "trialing" ? "active" : String(obj.status ?? "canceled");
            await subs()
              .update({
                status,
                current_period_start: iso(obj.current_period_start),
                current_period_end: iso(obj.current_period_end),
              })
              .eq("stripe_subscription_id", obj.id)
              .eq("store_id", storeId);
            break;
          }
          case "customer.subscription.deleted": {
            await subs().update({ status: "canceled" }).eq("stripe_subscription_id", obj.id).eq("store_id", storeId);
            break;
          }
          case "invoice.paid": {
            // New billing period — the allowance resets.
            const subscriptionId = obj.subscription as string | undefined;
            if (!subscriptionId) break;
            await subs()
              .update({
                status: "active",
                leases_used: 0,
                downloads_used: 0,
                current_period_start: iso(obj.period_start),
                current_period_end: iso(obj.period_end),
              })
              .eq("stripe_subscription_id", subscriptionId)
              .eq("store_id", storeId);
            break;
          }
          case "invoice.payment_failed": {
            const subscriptionId = obj.subscription as string | undefined;
            if (subscriptionId) {
              await subs().update({ status: "past_due" }).eq("stripe_subscription_id", subscriptionId).eq("store_id", storeId);
            }
            break;
          }
          default:
            break;
        }

        return new Response("ok");
      },
    },
  },
});