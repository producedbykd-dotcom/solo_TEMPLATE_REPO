/**
 * PayPal IPN listener. PayPal POSTs here after a buyer pays.
 *
 * Trust chain: the raw body is echoed back to PayPal for validation, then the
 * payee, currency and amount are checked against the order we priced
 * server-side. Only then is the order fulfilled.
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyIpn } from "@/lib/store/paypal.server";
import { fulfilOrder } from "@/lib/store/fulfil.server";

export const Route = createFileRoute("/api/public/paypal/ipn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const ok = await verifyIpn(raw);
        if (!ok) {
          console.error("[ipn] PayPal did not verify this notification");
          return new Response("invalid", { status: 400 });
        }

        const p = new URLSearchParams(raw);
        const token = (p.get("custom") || p.get("invoice") || "").trim();
        const status = (p.get("payment_status") || "").toLowerCase();
        if (!token) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: order } = await supabaseAdmin
          .from("store_orders").select("id, store_id, total_cents, currency, status")
          .eq("token", token).maybeSingle();
        if (!order) return new Response("ok");
        const o = order as Record<string, any>;

        if (status === "refunded" || status === "reversed") {
          await (supabaseAdmin.from("store_orders") as any).update({ status: "refunded" }).eq("id", o.id);
          return new Response("ok");
        }
        if (status !== "completed") return new Response("ok");

        const { data: store } = await supabaseAdmin
          .from("stores").select("paypal_email").eq("id", o.store_id).maybeSingle();
        const payee = ((store as Record<string, any>)?.paypal_email ?? "").toLowerCase();
        const receiver = (p.get("receiver_email") || p.get("business") || "").toLowerCase();
        if (!payee || receiver !== payee) {
          console.error("[ipn] payee mismatch", { receiver });
          return new Response("ok");
        }

        const gross = Math.round(parseFloat(p.get("mc_gross") || "0") * 100);
        const currency = (p.get("mc_currency") || "USD").toUpperCase();
        if (currency !== (o.currency ?? "USD").toUpperCase() || gross < o.total_cents) {
          console.error("[ipn] amount mismatch", { gross, expected: o.total_cents, currency });
          return new Response("ok");
        }

        await fulfilOrder(o.id, {
          txnId: p.get("txn_id") || "",
          payerEmail: p.get("payer_email") || "",
          raw: Object.fromEntries(p.entries()),
        });
        return new Response("ok");
      },
    },
  },
});