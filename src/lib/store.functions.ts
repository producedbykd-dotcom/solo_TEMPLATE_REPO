/**
 * Artist-facing storefront management (authenticated).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPublicOrigin } from "@/lib/public-origin";

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

type AnyClient = any;

async function ownStore(supabase: AnyClient, userId: string) {
  const { data } = await supabase.from("stores").select("*").eq("user_id", userId).maybeSingle();
  return data as Record<string, any> | null;
}

async function signPath(bucket: string, path: string | null, secs = 3600): Promise<string | null> {
  if (!path) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, secs);
  return data?.signedUrl ?? null;
}

export const getMyStore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const store = await ownStore(supabase, userId);
    if (!store) {
      return { store: null, products: [], promo: null, storeUrl: null, membership: null, stripe: { hasSecret: false, hasWebhook: false }, subscribers: [] };
    }

    const { data: products } = await supabase
      .from("store_products").select("*").eq("store_id", store.id).order("position");
    const ids = (products ?? []).map((p: any) => p.id);
    const { data: tiers } = ids.length
      ? await supabase.from("product_tiers").select("*").in("product_id", ids)
      : { data: [] as any[] };
    const { data: promo } = await supabase
      .from("store_promotions").select("*").eq("store_id", store.id).maybeSingle();
    const { data: membership } = await supabase
      .from("store_membership_plans").select("*").eq("store_id", store.id).maybeSingle();
    const { data: subscribers } = await supabase
      .from("store_subscribers")
      .select("id, email, status, current_period_end, leases_used, downloads_used, created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(200);

    const { getStripeConfig } = await import("@/lib/store/stripe.server");
    const cfg = await getStripeConfig(store.id);

    const enriched = await Promise.all((products ?? []).map(async (p: any) => ({
      ...p,
      artworkUrl: await signPath("store", p.artwork_path),
      freeDownloadUrl: await signPath("store", p.free_download_path),
      tiers: (tiers ?? []).filter((t: any) => t.product_id === p.id),
    })));

    return {
      store: { ...store, logoUrl: await signPath("store", store.logo_path) } as Record<string, any>,
      products: enriched,
      promo: promo ?? null,
      storeUrl: store.handle ? `${getPublicOrigin()}/store/${store.handle}` : null,
      membership: (membership ?? null) as Record<string, any> | null,
      stripe: { hasSecret: !!cfg.secretKey, hasWebhook: !!cfg.webhookSecret },
      subscribers: (subscribers ?? []) as Record<string, any>[],
    };
  });

export const saveStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    handle: string; display_name: string; bio?: string; accent?: string;
    paypal_email?: string; logo_path?: string | null; published?: boolean; theme?: string;
  }) => {
    const handle = (d?.handle ?? "").trim().toLowerCase();
    if (!HANDLE_RE.test(handle)) {
      throw new Error("Handle must be 3-32 characters, lowercase letters, numbers or dashes.");
    }
    if (!d.display_name?.trim()) throw new Error("Store name is required.");
    if (d.paypal_email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.paypal_email.trim())) {
      throw new Error("That does not look like a valid PayPal email address.");
    }
    return { ...d, handle };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const existing = await ownStore(supabase, userId);
    const paypal = data.paypal_email?.trim() || null;

    if (data.published && !paypal) {
      throw new Error("Add your PayPal email before publishing the store.");
    }

    const row: Record<string, unknown> = {
      user_id: userId,
      handle: data.handle,
      display_name: data.display_name.trim(),
      bio: data.bio?.trim() || null,
      accent: data.accent || "#7c3aed",
      theme: data.theme === "light" ? "light" : "dark",
      paypal_email: paypal,
      paypal_verified_at: paypal ? new Date().toISOString() : null,
      published: !!data.published,
    };
    if (data.logo_path !== undefined) row.logo_path = data.logo_path;

    const q = existing
      ? (supabase.from("stores") as AnyClient).update(row).eq("id", existing.id)
      : (supabase.from("stores") as AnyClient).insert(row);
    const { error } = await q;
    if (error) {
      if (String(error.message).includes("stores_handle_key")) {
        throw new Error("That store handle is already taken — try another.");
      }
      throw new Error(error.message);
    }
    return { ok: true, storeUrl: `${getPublicOrigin()}/store/${data.handle}` };
  });

export const checkHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { handle: string }) => d)
  .handler(async ({ data, context }) => {
    const handle = (data.handle ?? "").trim().toLowerCase();
    if (!HANDLE_RE.test(handle)) return { available: false, reason: "invalid" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("stores").select("user_id").eq("handle", handle).maybeSingle();
    if (row && (row as any).user_id !== context.userId) return { available: false, reason: "taken" as const };
    return { available: true, reason: null };
  });

/** Signed upload URL into the artist's own folder of the private `store` bucket. */
export const startStoreUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { kind: "logo" | "artwork" | "tag" | "free"; fileName: string; contentType: string }) => {
    if (!d?.fileName) throw new Error("file name required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = (data.fileName.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${context.userId}/${data.kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("store").createSignedUploadUrl(path, { upsert: true } as { upsert: boolean });
    if (error || !signed) throw new Error(error?.message ?? "could not create upload url");
    return { path: signed.path, token: signed.token, storagePath: path };
  });

/** List catalog releases that can be turned into store products. */
export const listSellableReleases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("projects")
      .select("id, title, kind, cover_image_path, primary_audio_path")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    return { releases: data ?? [] };
  });

export const addProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId?: string | null; kind: "single" | "album" | "beat"; title: string }) => {
    if (!d?.title?.trim()) throw new Error("Title required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const store = await ownStore(supabase, userId);
    if (!store) throw new Error("Create your store first.");

    let audio_path: string | null = null;
    let audio_bucket = "audio";
    let artwork_path: string | null = null;
    if (data.projectId) {
      const { data: proj } = await supabase
        .from("projects").select("primary_audio_path, cover_image_path").eq("id", data.projectId).maybeSingle();
      audio_path = (proj as any)?.primary_audio_path ?? null;
      // Covers are stored in the videos bucket by the release pipeline.
      artwork_path = (proj as any)?.cover_image_path ?? null;
    }

    const { data: inserted, error } = await (supabase.from("store_products") as AnyClient)
      .insert({
        store_id: store.id,
        project_id: data.projectId ?? null,
        kind: data.kind,
        title: data.title.trim(),
        audio_path,
        audio_bucket,
        artwork_path: null,
        position: Date.now() % 100000,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const productId = (inserted as any).id as string;
    // Sensible starting tiers.
    const tiers = data.kind === "beat"
      ? [
          { product_id: productId, kind: "non_exclusive", price_cents: 3500, stream_limit: 100000, distribution_limit: 5000, video_limit: 1, term_months: 24 },
          { product_id: productId, kind: "exclusive", price_cents: 25000, stream_limit: null, distribution_limit: null, video_limit: null, term_months: null },
        ]
      : [{ product_id: productId, kind: data.kind === "album" ? "album" : "single", price_cents: data.kind === "album" ? 999 : 199 }];
    await (supabase.from("product_tiers") as AnyClient).insert(tiers);

    // Copy the release cover into the store bucket so the public page can show it.
    if (artwork_path) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: blob } = await supabaseAdmin.storage.from("videos").download(artwork_path);
        if (blob) {
          const dest = `${userId}/artwork/${productId}.jpg`;
          await supabaseAdmin.storage.from("store").upload(dest, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
          await (supabaseAdmin.from("store_products") as AnyClient).update({ artwork_path: dest }).eq("id", productId);
        }
      } catch (e) {
        console.error("[store] cover copy failed", e);
      }
    }
    return { ok: true, productId };
  });

export const updateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { productId: string; patch: Record<string, unknown> }) => {
    if (!d?.productId) throw new Error("productId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const allowed = ["title", "description", "artwork_path", "active", "free_download_enabled", "free_download_path", "position", "kind"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in data.patch) patch[k] = (data.patch as any)[k];
    const { error } = await (context.supabase.from("store_products") as AnyClient)
      .update(patch).eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { productId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("store_products").delete().eq("id", data.productId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Persist a new display order for the artist's store products. */
export const reorderProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { orderedIds: string[] }) => {
    if (!Array.isArray(d?.orderedIds) || d.orderedIds.length === 0) throw new Error("No order supplied");
    return { orderedIds: d.orderedIds.slice(0, 200) };
  })
  .handler(async ({ data, context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) throw new Error("Create your store first.");
    for (let i = 0; i < data.orderedIds.length; i++) {
      const { error } = await (context.supabase.from("store_products") as AnyClient)
        .update({ position: i })
        .eq("id", data.orderedIds[i])
        .eq("store_id", store.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const saveTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    tierId?: string; productId: string; kind: string; price_cents: number;
    stream_limit?: number | null; distribution_limit?: number | null;
    video_limit?: number | null; term_months?: number | null; extra_terms?: string | null;
    active?: boolean;
  }) => {
    if (!d?.productId) throw new Error("productId required");
    if (!Number.isFinite(d.price_cents) || d.price_cents < 0) throw new Error("Invalid price");
    return d;
  })
  .handler(async ({ data, context }) => {
    const row = {
      product_id: data.productId,
      kind: data.kind,
      price_cents: Math.round(data.price_cents),
      stream_limit: data.stream_limit ?? null,
      distribution_limit: data.distribution_limit ?? null,
      video_limit: data.video_limit ?? null,
      term_months: data.term_months ?? null,
      extra_terms: data.extra_terms ?? null,
      active: data.active ?? true,
    };
    const q = data.tierId
      ? (context.supabase.from("product_tiers") as AnyClient).update(row).eq("id", data.tierId)
      : (context.supabase.from("product_tiers") as AnyClient).insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { tierId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("product_tiers").delete().eq("id", data.tierId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const savePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    type: "percent" | "bogo"; percent: number; bogo_buy: number; bogo_free: number;
    scope: "all" | "leases"; exclude_exclusive: boolean; headline?: string | null;
    active: boolean; ends_at?: string | null;
  }) => {
    if (d.type === "percent" && (d.percent < 1 || d.percent > 90)) {
      throw new Error("Percentage must be between 1 and 90.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) throw new Error("Create your store first.");
    const row = {
      store_id: store.id,
      type: data.type,
      percent: Math.round(data.percent || 0),
      bogo_buy: Math.max(1, Math.round(data.bogo_buy || 1)),
      bogo_free: Math.max(1, Math.round(data.bogo_free || 1)),
      scope: data.scope,
      exclude_exclusive: data.exclude_exclusive,
      headline: data.headline?.trim() || null,
      active: data.active,
      ends_at: data.ends_at || null,
    };
    const { error } = await (context.supabase.from("store_promotions") as AnyClient)
      .upsert(row, { onConflict: "store_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listStoreOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) return { orders: [], leads: [] };
    const { data: orders } = await context.supabase
      .from("store_orders").select("*").eq("store_id", store.id)
      .order("created_at", { ascending: false }).limit(100);
    const orderIds = (orders ?? []).map((o: any) => o.id);
    const { data: items } = orderIds.length
      ? await context.supabase.from("store_order_items").select("*").in("order_id", orderIds)
      : { data: [] as any[] };
    const { data: leads } = await context.supabase
      .from("free_downloads").select("*").eq("store_id", store.id)
      .order("created_at", { ascending: false }).limit(200);
    return {
      orders: (orders ?? []).map((o: any) => ({ ...o, items: (items ?? []).filter((i: any) => i.order_id === o.id) })),
      leads: leads ?? [],
    };
  });

/** Generate the spoken "purchase this track" tag with Lovable AI TTS. */
export const generateVoiceTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { phrase?: string }) => d ?? {})
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured");
    const phrase = (data.phrase ?? "Purchase this track").slice(0, 80);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: phrase,
        voice: "alloy",
        response_format: "mp3",
        stream_format: "audio",
      }),
    });
    if (!res.ok) throw new Error(`Voice tag failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
    }
    return { base64: btoa(bin), mimeType: "audio/mpeg" };
  });

/** Master audio for a product, so the browser can render the tagged version. */
export const getProductAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { productId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: product } = await context.supabase
      .from("store_products").select("audio_path, audio_bucket").eq("id", data.productId).maybeSingle();
    const path = (product as any)?.audio_path;
    if (!path) throw new Error("This item has no audio file attached.");
    const { data: blob, error } = await context.supabase.storage
      .from((product as any).audio_bucket || "audio").download(path);
    if (error || !blob) throw new Error(error?.message ?? "Could not read the audio file.");
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
    }
    return { base64: btoa(bin), contentType: blob.type || "audio/mpeg" };
  });

/* -------------------------------------------------------------------------
 * Storefront memberships (producer's own Stripe account)
 * ---------------------------------------------------------------------- */

/** Save the producer's own Stripe keys. Values are write-only from the UI. */
export const saveStripeKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { secretKey?: string | null; webhookSecret?: string | null }) => {
    const sk = d?.secretKey?.trim();
    if (sk && !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(sk)) {
      throw new Error("That does not look like a Stripe secret key (it should start with sk_live_ or sk_test_).");
    }
    const wh = d?.webhookSecret?.trim();
    if (wh && !wh.startsWith("whsec_")) throw new Error("Webhook signing secrets start with whsec_.");
    return { secretKey: sk ?? undefined, webhookSecret: wh ?? undefined };
  })
  .handler(async ({ data, context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) throw new Error("Create your store first.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { store_id: store.id, updated_at: new Date().toISOString() };
    if (data.secretKey !== undefined) patch.secret_key = data.secretKey || null;
    if (data.webhookSecret !== undefined) patch.webhook_secret = data.webhookSecret || null;
    const { error } = await (supabaseAdmin.from("store_stripe_config") as AnyClient)
      .upsert(patch, { onConflict: "store_id" });
    if (error) throw new Error(error.message);
    return { ok: true, webhookUrl: `${getPublicOrigin()}/api/public/stripe/${store.id}` };
  });

export const saveMembershipPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    name: string; description?: string | null; price_cents: number;
    interval: "month" | "year"; mode: "quota" | "all_access";
    lease_quota: number; download_quota: number; discount_percent: number; active: boolean;
  }) => {
    if (!d?.name?.trim()) throw new Error("Give your membership a name.");
    if (!Number.isFinite(d.price_cents) || d.price_cents < 100) throw new Error("Price must be at least 1.00.");
    if (d.discount_percent < 0 || d.discount_percent > 90) throw new Error("Member discount must be between 0 and 90%.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) throw new Error("Create your store first.");
    if (data.active) {
      const { getStripeConfig } = await import("@/lib/store/stripe.server");
      const cfg = await getStripeConfig(store.id);
      if (!cfg.secretKey) throw new Error("Add your Stripe secret key before switching the membership on.");
    }
    const row = {
      store_id: store.id,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      price_cents: Math.round(data.price_cents),
      interval: data.interval,
      mode: data.mode,
      lease_quota: Math.max(0, Math.round(data.lease_quota || 0)),
      download_quota: Math.max(0, Math.round(data.download_quota || 0)),
      discount_percent: Math.round(data.discount_percent || 0),
      active: !!data.active,
    };
    const { error } = await (context.supabase.from("store_membership_plans") as AnyClient)
      .upsert(row, { onConflict: "store_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });