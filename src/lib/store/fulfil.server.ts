/**
 * Order fulfilment: runs once a PayPal IPN is verified.
 * Generates personalised licence PDFs, retires exclusives, marks order paid.
 * Safe to call twice — it no-ops on an already-paid order.
 */
import { buildLicensePdf } from "./licenses.server";
import type { TierKind } from "./pricing";
import { money } from "./pricing";

type AnyRow = Record<string, any>;

export async function fulfilOrder(orderId: string, payment: { txnId: string; payerEmail: string; raw: unknown }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: order } = await supabaseAdmin.from("store_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("order not found");
  const o = order as AnyRow;
  if (o.status === "paid") return { alreadyPaid: true };

  const { data: store } = await supabaseAdmin
    .from("stores").select("id, user_id, display_name").eq("id", o.store_id).maybeSingle();
  const s = store as AnyRow;

  const { data: items } = await supabaseAdmin.from("store_order_items").select("*").eq("order_id", orderId);
  const purchasedAt = new Date();

  for (const item of (items ?? []) as AnyRow[]) {
    const kind = item.tier_kind as TierKind;
    if (kind !== "non_exclusive" && kind !== "exclusive") continue;
    try {
      const terms = (item.terms_snapshot ?? {}) as AnyRow;
      const pdf = await buildLicensePdf({
        tierKind: kind,
        trackTitle: item.title,
        buyerName: o.buyer_name,
        buyerEmail: o.buyer_email,
        producerName: s?.display_name ?? "Producer",
        orderId,
        pricePaid: money(item.price_cents, o.currency ?? "USD"),
        purchasedAt,
        terms: {
          streamLimit: terms.stream_limit ?? null,
          distributionLimit: terms.distribution_limit ?? null,
          videoLimit: terms.video_limit ?? null,
          termMonths: terms.term_months ?? null,
          extraTerms: terms.extra_terms ?? null,
        },
      });
      const path = `${s.user_id}/licenses/${orderId}/${item.id}.pdf`;
      await supabaseAdmin.storage.from("store").upload(path, pdf, {
        upsert: true, contentType: "application/pdf",
      });
      await (supabaseAdmin.from("store_order_items") as any).update({ license_pdf_path: path }).eq("id", item.id);
    } catch (e) {
      console.error("[store] licence generation failed", item.id, e);
    }

    if (kind === "exclusive") {
      // Exclusive sold: retire the tier and pull the product from sale.
      await (supabaseAdmin.from("product_tiers") as any)
        .update({ sold_out: true, active: false }).eq("id", item.tier_id);
      await (supabaseAdmin.from("store_products") as any)
        .update({ active: false }).eq("id", item.product_id);
    }
  }

  await (supabaseAdmin.from("store_orders") as any)
    .update({
      status: "paid",
      paid_at: purchasedAt.toISOString(),
      paypal_txn_id: payment.txnId,
      paypal_payer_email: payment.payerEmail,
      ipn_raw: payment.raw as any,
    })
    .eq("id", orderId);

  // Commit any membership allowance this order consumed.
  const snap = (o.promo_snapshot ?? {}) as AnyRow;
  if (snap.member_id && ((snap.member_leases_used ?? 0) > 0 || (snap.member_downloads_used ?? 0) > 0)) {
    const { data: member } = await supabaseAdmin
      .from("store_subscribers").select("leases_used, downloads_used").eq("id", snap.member_id).maybeSingle();
    if (member) {
      await (supabaseAdmin.from("store_subscribers") as any)
        .update({
          leases_used: ((member as AnyRow).leases_used ?? 0) + (snap.member_leases_used ?? 0),
          downloads_used: ((member as AnyRow).downloads_used ?? 0) + (snap.member_downloads_used ?? 0),
        })
        .eq("id", snap.member_id);
    }
  }

  return { alreadyPaid: false };
}