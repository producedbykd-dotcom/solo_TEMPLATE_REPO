/**
 * PUBLIC storefront server functions — no auth, callable by buyers.
 * Reads go through the publishable-key client so RLS only exposes published
 * stores and active products. The service-role client is used solely to sign
 * short-lived URLs for private files the buyer is entitled to.
 */
import { createServerFn } from "@tanstack/react-start";
import { publicSupabase } from "@/lib/store/public-client.server";
import {
  priceCart, promoIsLive, type CartLine, type PromoConfig, type TierKind,
} from "@/lib/store/pricing";
import { buildCheckoutUrl } from "@/lib/store/paypal.server";
import { getPublicOrigin } from "@/lib/public-origin";
import { applyMembership, type MemberState, type MembershipPlan } from "@/lib/store/membership";

type AnyRow = Record<string, any>;

async function sign(bucket: string, path: string | null, secs = 3600): Promise<string | null> {
  if (!path) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, secs);
  return data?.signedUrl ?? null;
}

export const getStorefront = createServerFn({ method: "GET" })
  .validator((d: { handle: string }) => ({ handle: (d?.handle ?? "").trim().toLowerCase() }))
  .handler(async ({ data }) => {
    const sb = publicSupabase();
    const { data: store } = await sb
      .from("stores")
      .select("id, handle, display_name, bio, accent, logo_path, currency, published, theme")
      .eq("handle", data.handle)
      .eq("published", true)
      .maybeSingle();
    if (!store) return { store: null, products: [], promo: null, membership: null };

    const s = store as AnyRow;
    const { data: products } = await sb
      .from("store_products")
      .select("id, title, description, kind, artwork_path, free_download_enabled, position, audio_path")
      .eq("store_id", s.id).eq("active", true).order("position");

    const ids = (products ?? []).map((p: AnyRow) => p.id);
    const { data: tiers } = ids.length
      ? await sb.from("product_tiers")
          .select("id, product_id, kind, price_cents, stream_limit, distribution_limit, video_limit, term_months")
          .in("product_id", ids).eq("active", true)
      : { data: [] as AnyRow[] };

    const { data: promoRow } = await sb
      .from("store_promotions").select("*").eq("store_id", s.id).eq("active", true).maybeSingle();
    const promo = promoIsLive(promoRow as PromoConfig | null) ? (promoRow as PromoConfig) : null;

    const { data: planRow } = await sb
      .from("store_membership_plans").select("*").eq("store_id", s.id).eq("active", true).maybeSingle();

    const enriched = await Promise.all((products ?? []).map(async (p: AnyRow) => ({
      id: p.id as string,
      title: p.title as string,
      description: (p.description ?? null) as string | null,
      kind: p.kind as string,
      freeDownload: !!p.free_download_enabled,
      previewUrl: p.audio_path ? `/api/public/store/preview?p=${p.id}` : null,
      artworkUrl: await sign("store", p.artwork_path, 7200),
      tiers: (tiers ?? [])
        .filter((t: AnyRow) => t.product_id === p.id)
        .sort((a: AnyRow, b: AnyRow) => a.price_cents - b.price_cents),
    })));

    return {
      store: {
        id: s.id as string,
        handle: s.handle as string,
        name: s.display_name as string,
        bio: (s.bio ?? null) as string | null,
        accent: (s.accent ?? "#7c3aed") as string,
        currency: (s.currency ?? "USD") as string,
        theme: ((s.theme ?? "dark") === "light" ? "light" : "dark") as "light" | "dark",
        logoUrl: await sign("store", s.logo_path, 7200),
      },
      products: enriched,
      promo,
      membership: (planRow ?? null) as MembershipPlan | null,
    };
  });

/** Look up an active member by their private access token. */
async function resolveMember(storeId: string, token: string | null | undefined) {
  if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: sub } = await supabaseAdmin
    .from("store_subscribers").select("*").eq("access_token", token).eq("store_id", storeId).maybeSingle();
  const row = sub as AnyRow | null;
  if (!row || row.status !== "active") return null;
  if (row.current_period_end && new Date(row.current_period_end).getTime() < Date.now()) return null;

  const { data: plan } = await supabaseAdmin
    .from("store_membership_plans").select("*").eq("store_id", storeId).eq("active", true).maybeSingle();
  const p = plan as AnyRow | null;
  if (!p) return null;

  const state: MemberState = {
    mode: p.mode === "all_access" ? "all_access" : "quota",
    leasesRemaining: Math.max(0, (p.lease_quota ?? 0) - (row.leases_used ?? 0)),
    downloadsRemaining: Math.max(0, (p.download_quota ?? 0) - (row.downloads_used ?? 0)),
    discountPercent: p.discount_percent ?? 0,
  };
  return { subscriber: row, plan: p as unknown as MembershipPlan, state };
}

/** Resolve a cart against live DB prices — never trust prices from the client. */
async function resolveCart(
  handle: string,
  items: { productId: string; tierId: string }[],
  memberToken?: string | null,
) {
  const sb = publicSupabase();
  const { data: store } = await sb
    .from("stores")
    .select("id, handle, display_name, paypal_email, currency, user_id")
    .eq("handle", handle).eq("published", true).maybeSingle();
  if (!store) throw new Error("This store is not available.");
  const s = store as AnyRow;

  const productIds = [...new Set(items.map((i) => i.productId))];
  const { data: products } = await sb
    .from("store_products").select("id, title, store_id").in("id", productIds).eq("active", true);
  const { data: tiers } = await sb
    .from("product_tiers").select("id, product_id, kind, price_cents").in("id", items.map((i) => i.tierId)).eq("active", true);

  const lines: CartLine[] = [];
  for (const item of items) {
    const p = (products ?? []).find((x: AnyRow) => x.id === item.productId) as AnyRow | undefined;
    const t = (tiers ?? []).find((x: AnyRow) => x.id === item.tierId && x.product_id === item.productId) as AnyRow | undefined;
    if (!p || !t || p.store_id !== s.id) throw new Error("One of the items is no longer available.");
    lines.push({
      productId: p.id, tierId: t.id, title: p.title,
      tierKind: t.kind as TierKind, unitPriceCents: t.price_cents as number,
    });
  }

  const { data: promoRow } = await sb
    .from("store_promotions").select("*").eq("store_id", s.id).eq("active", true).maybeSingle();
  const promo = promoIsLive(promoRow as PromoConfig | null) ? (promoRow as PromoConfig) : null;
  const member = await resolveMember(s.id as string, memberToken);
  const totals = applyMembership(priceCart(lines, promo), member?.state ?? null);
  return { store: s, totals, member };
}

export const quoteCart = createServerFn({ method: "POST" })
  .validator((d: { handle: string; items: { productId: string; tierId: string }[]; memberToken?: string | null }) => d)
  .handler(async ({ data }) => {
    if (!data.items?.length) return { totals: null, member: null };
    const { totals, member } = await resolveCart(data.handle.toLowerCase(), data.items.slice(0, 25), data.memberToken);
    return {
      totals,
      member: member ? { email: member.subscriber.email as string, state: member.state } : null,
    };
  });

export const startCheckout = createServerFn({ method: "POST" })
  .validator((d: {
    handle: string; items: { productId: string; tierId: string }[];
    buyerName: string; buyerEmail: string; memberToken?: string | null;
  }) => {
    if (!d?.items?.length) throw new Error("Your cart is empty.");
    if (!d.buyerName?.trim() || d.buyerName.trim().length > 120) throw new Error("Enter the name for your licence.");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.buyerEmail ?? "")) throw new Error("Enter a valid email address.");
    return { ...d, items: d.items.slice(0, 25) };
  })
  .handler(async ({ data }) => {
    const { store, totals, member } = await resolveCart(data.handle.toLowerCase(), data.items, data.memberToken);
    if (totals.totalCents > 0 && !store.paypal_email) throw new Error("This store cannot take payments yet.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = crypto.randomUUID().replace(/-/g, "");
    const { data: order, error } = await (supabaseAdmin.from("store_orders") as any)
      .insert({
        store_id: store.id,
        buyer_email: data.buyerEmail.trim().toLowerCase(),
        buyer_name: data.buyerName.trim(),
        currency: store.currency ?? "USD",
        subtotal_cents: totals.subtotalCents,
        discount_cents: totals.discountCents,
        total_cents: totals.totalCents,
        promo_snapshot: { label: totals.promoLabel },
        token: token,
        status: "pending",
      })
      .select("id, token")
      .maybeSingle();
    if (error || !order) throw new Error(error?.message ?? "Could not start checkout.");

    const orderId = (order as AnyRow).id as string;
    const { data: tierRows } = await supabaseAdmin
      .from("product_tiers")
      .select("id, kind, price_cents, stream_limit, distribution_limit, video_limit, term_months, extra_terms")
      .in("id", totals.lines.map((l) => l.tierId));

    await (supabaseAdmin.from("store_order_items") as any).insert(
      totals.lines.map((l) => {
        const t = (tierRows ?? []).find((x: AnyRow) => x.id === l.tierId) as AnyRow | undefined;
        return {
          order_id: orderId,
          product_id: l.productId,
          tier_id: l.tierId,
          title: l.title,
          tier_kind: l.tierKind,
          unit_price_cents: l.unitPriceCents,
          price_cents: l.priceCents,
          terms_snapshot: {
            stream_limit: t?.stream_limit ?? null,
            distribution_limit: t?.distribution_limit ?? null,
            video_limit: t?.video_limit ?? null,
            term_months: t?.term_months ?? null,
            extra_terms: t?.extra_terms ?? null,
          },
        };
      }),
    );

    if (member) {
      await (supabaseAdmin.from("store_orders") as any)
        .update({
          promo_snapshot: {
            label: totals.promoLabel,
            member_label: totals.memberLabel,
            member_id: member.subscriber.id,
            member_leases_used: totals.leasesUsed,
            member_downloads_used: totals.downloadsUsed,
          },
        })
        .eq("id", orderId);
    }

    const origin = getPublicOrigin();

    // Fully covered by the membership (or a 100% promo): no payment step.
    if (totals.totalCents === 0) {
      const { fulfilOrder } = await import("@/lib/store/fulfil.server");
      await fulfilOrder(orderId, { txnId: `member-${token}`, payerEmail: data.buyerEmail, raw: { source: "membership" } });
      return { checkoutUrl: `${origin}/order/${token}`, orderToken: token, totals, free: true };
    }

    const url = buildCheckoutUrl({
      payeeEmail: store.paypal_email,
      currency: store.currency ?? "USD",
      storeName: store.display_name,
      orderToken: token,
      items: totals.lines
        .filter((l) => l.priceCents > 0)
        .map((l) => ({ name: `${l.title} (${l.tierKind.replace("_", "-")})`, amountCents: l.priceCents })),
      returnUrl: `${origin}/order/${token}`,
      cancelUrl: `${origin}/store/${data.handle}`,
      notifyUrl: `${origin}/api/public/paypal/ipn`,
    });

    return { checkoutUrl: url, orderToken: token, totals, free: false };
  });

export const getOrder = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => ({ token: (d?.token ?? "").trim() }))
  .handler(async ({ data }) => {
    if (!/^[a-f0-9]{16,64}$/i.test(data.token)) return { order: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("store_orders").select("*").eq("token", data.token).maybeSingle();
    if (!order) return { order: null };
    const o = order as AnyRow;

    const { data: items } = await supabaseAdmin
      .from("store_order_items").select("*").eq("order_id", o.id);
    const { data: store } = await supabaseAdmin
      .from("stores").select("handle, display_name, accent").eq("id", o.store_id).maybeSingle();

    const paid = o.status === "paid";
    const detailed = await Promise.all((items ?? []).map(async (it: AnyRow) => {
      let audioUrl: string | null = null;
      if (paid) {
        const { data: prod } = await supabaseAdmin
          .from("store_products").select("audio_path, audio_bucket").eq("id", it.product_id).maybeSingle();
        audioUrl = await sign((prod as AnyRow)?.audio_bucket || "audio", (prod as AnyRow)?.audio_path ?? null, 86400);
      }
      return {
        id: it.id as string,
        title: it.title as string,
        tierKind: it.tier_kind as TierKind,
        priceCents: it.price_cents as number,
        audioUrl,
        licenseUrl: paid ? await sign("store", it.license_pdf_path ?? null, 86400) : null,
      };
    }));

    return {
      order: {
        token: data.token,
        status: o.status as string,
        buyerName: o.buyer_name as string,
        buyerEmail: o.buyer_email as string,
        totalCents: o.total_cents as number,
        discountCents: o.discount_cents as number,
        currency: o.currency as string,
        createdAt: o.created_at as string,
        store: {
          handle: (store as AnyRow)?.handle ?? "",
          name: (store as AnyRow)?.display_name ?? "",
          accent: (store as AnyRow)?.accent ?? "#7c3aed",
        },
        items: detailed,
      },
    };
  });

/** Email-gated free download of the tagged version. */
export const claimFreeDownload = createServerFn({ method: "POST" })
  .validator((d: { productId: string; email: string }) => {
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d?.email ?? "")) throw new Error("Enter a valid email address.");
    return d;
  })
  .handler(async ({ data }) => {
    const sb = publicSupabase();
    const { data: product } = await sb
      .from("store_products")
      .select("id, store_id, title, free_download_enabled")
      .eq("id", data.productId).eq("active", true).eq("free_download_enabled", true).maybeSingle();
    if (!product) throw new Error("This free download is no longer available.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: full } = await supabaseAdmin
      .from("store_products").select("free_download_path").eq("id", data.productId).maybeSingle();
    const path = (full as AnyRow)?.free_download_path as string | null;
    if (!path) throw new Error("This free download is not ready yet.");

    await (supabaseAdmin.from("free_downloads") as any).insert({
      store_id: (product as AnyRow).store_id,
      product_id: data.productId,
      email: data.email.trim().toLowerCase(),
    });

    return { url: await sign("store", path, 3600), title: (product as AnyRow).title as string };
  });

/* -------------------------------------------------------------------------
 * Storefront memberships
 * ---------------------------------------------------------------------- */

async function loadStoreAndPlan(handle: string) {
  const sb = publicSupabase();
  const { data: store } = await sb
    .from("stores").select("id, handle, display_name, currency, published")
    .eq("handle", handle).eq("published", true).maybeSingle();
  if (!store) throw new Error("This store is not available.");
  const s = store as AnyRow;
  const { data: plan } = await sb
    .from("store_membership_plans").select("*").eq("store_id", s.id).eq("active", true).maybeSingle();
  if (!plan) throw new Error("This store does not offer a membership.");
  return { store: s, plan: plan as AnyRow };
}

/** Start a Stripe subscription checkout against the producer's own account. */
export const startMembership = createServerFn({ method: "POST" })
  .validator((d: { handle: string; email: string }) => {
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d?.email ?? "")) throw new Error("Enter a valid email address.");
    return { handle: (d.handle ?? "").trim().toLowerCase(), email: d.email.trim().toLowerCase() };
  })
  .handler(async ({ data }) => {
    const { store, plan } = await loadStoreAndPlan(data.handle);
    const { getStripeConfig, createSubscriptionCheckout } = await import("@/lib/store/stripe.server");
    const { secretKey } = await getStripeConfig(store.id as string);
    if (!secretKey) throw new Error("This store cannot take memberships yet.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("store_subscribers").select("id, access_token, status")
      .eq("store_id", store.id).eq("email", data.email).maybeSingle();
    let subscriber = existing as AnyRow | null;
    if (subscriber?.status === "active") {
      throw new Error("You are already a member — use your member link to apply your benefits.");
    }
    if (!subscriber) {
      const { data: inserted, error } = await (supabaseAdmin.from("store_subscribers") as any)
        .insert({
          store_id: store.id,
          email: data.email,
          access_token: crypto.randomUUID().replace(/-/g, ""),
          status: "pending",
        })
        .select("id, access_token")
        .maybeSingle();
      if (error || !inserted) throw new Error(error?.message ?? "Could not start the membership.");
      subscriber = inserted as AnyRow;
    }

    const origin = getPublicOrigin();
    const url = await createSubscriptionCheckout({
      secretKey,
      currency: (store.currency as string) || "USD",
      productName: `${store.display_name} — ${plan.name}`,
      amountCents: plan.price_cents as number,
      interval: plan.interval === "year" ? "year" : "month",
      customerEmail: data.email,
      successUrl: `${origin}/store/${store.handle}?member=${subscriber.access_token}`,
      cancelUrl: `${origin}/store/${store.handle}`,
      metadata: { store_id: String(store.id), subscriber_id: String(subscriber.id) },
    });
    return { checkoutUrl: url };
  });

/** Membership status for the token stored in the buyer's browser. */
export const getMemberStatus = createServerFn({ method: "POST" })
  .validator((d: { handle: string; token: string }) => ({
    handle: (d?.handle ?? "").trim().toLowerCase(),
    token: (d?.token ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    if (!/^[a-f0-9]{16,64}$/i.test(data.token)) return { member: null };
    const sb = publicSupabase();
    const { data: store } = await sb
      .from("stores").select("id").eq("handle", data.handle).eq("published", true).maybeSingle();
    if (!store) return { member: null };
    const member = await resolveMember((store as AnyRow).id as string, data.token);
    if (!member) return { member: null };
    return {
      member: {
        email: member.subscriber.email as string,
        planName: (member.plan as AnyRow).name as string,
        renewsAt: (member.subscriber.current_period_end ?? null) as string | null,
        state: member.state,
      },
    };
  });

/** Stripe billing portal link so members can cancel or update their card. */
export const manageMembership = createServerFn({ method: "POST" })
  .validator((d: { handle: string; token: string }) => ({
    handle: (d?.handle ?? "").trim().toLowerCase(),
    token: (d?.token ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    if (!/^[a-f0-9]{16,64}$/i.test(data.token)) throw new Error("Member link is not valid.");
    const sb = publicSupabase();
    const { data: store } = await sb
      .from("stores").select("id, handle").eq("handle", data.handle).eq("published", true).maybeSingle();
    if (!store) throw new Error("This store is not available.");
    const storeId = (store as AnyRow).id as string;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
      .from("store_subscribers").select("stripe_customer_id")
      .eq("store_id", storeId).eq("access_token", data.token).maybeSingle();
    const customer = (sub as AnyRow)?.stripe_customer_id as string | undefined;
    if (!customer) throw new Error("No billing account found for this member link.");

    const { getStripeConfig, createBillingPortal } = await import("@/lib/store/stripe.server");
    const { secretKey } = await getStripeConfig(storeId);
    if (!secretKey) throw new Error("Billing is not configured for this store.");
    const url = await createBillingPortal(secretKey, customer, `${getPublicOrigin()}/store/${(store as AnyRow).handle}`);
    return { url };
  });