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

function bytesToBase64(buf: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  return btoa(bin);
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
    const { data: templates } = await supabase
      .from("store_license_templates").select("*").eq("store_id", store.id).order("created_at");
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
      licenseTemplates: (templates ?? []) as Record<string, any>[],
      stripe: { hasSecret: !!cfg.secretKey, hasWebhook: !!cfg.webhookSecret },
      subscribers: (subscribers ?? []) as Record<string, any>[],
    };
  });

export const saveStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    handle: string; display_name: string; headline?: string; bio?: string; accent?: string;
    paypal_email?: string; logo_path?: string | null; published?: boolean; theme?: string;
    preview_mode?: string;
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
      headline: data.headline?.trim() || null,
      bio: data.bio?.trim() || null,
      accent: data.accent || "#7c3aed",
      theme: data.theme === "light" ? "light" : "dark",
      preview_mode: data.preview_mode === "tagged" ? "tagged" : "clip",
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
    const allowed = ["title", "description", "artwork_path", "active", "free_download_enabled", "free_download_path", "position", "kind", "preview_mode"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in data.patch) patch[k] = (data.patch as any)[k];
    if ("preview_mode" in patch) {
      const v = patch.preview_mode;
      patch.preview_mode = v === "tagged" || v === "clip" ? v : null;
    }
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
    custom_label?: string | null; license_text?: string | null;
    active?: boolean;
  }) => {
    if (!d?.productId) throw new Error("productId required");
    if (!Number.isFinite(d.price_cents) || d.price_cents < 0) throw new Error("Invalid price");
    if (d.kind === "custom") {
      if (!d.custom_label?.trim()) throw new Error("Give your custom licence a name (for example \u201cSync licence\u201d).");
      if ((d.license_text ?? "").trim().length < 60) {
        throw new Error("Paste the full licence language — it is what prints on the buyer's PDF.");
      }
    }
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
      custom_label: data.kind === "custom" ? (data.custom_label ?? "").trim() : null,
      license_text: data.kind === "custom" ? (data.license_text ?? "").trim() : null,
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
    scope_kinds?: string[] | null; scope_tier_ids?: string[] | null;
    active: boolean; ends_at?: string | null;
  }) => {
    if (d.type === "percent" && (d.percent < 1 || d.percent > 90)) {
      throw new Error("Percentage must be between 1 and 90.");
    }
    const kinds = d.scope_kinds ?? null;
    const ids = d.scope_tier_ids ?? null;
    if (d.active && (kinds?.length ?? 0) === 0 && (ids?.length ?? 0) === 0) {
      throw new Error("Pick at least one licence type (or specific licence) for the sale.");
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
      scope_kinds: data.scope_kinds?.length ? data.scope_kinds : null,
      scope_tier_ids: data.scope_tier_ids?.length ? data.scope_tier_ids : null,
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

/* -------------------------------------------------------------------------
 * Reusable licence templates (seller-written language)
 * ---------------------------------------------------------------------- */

export const saveLicenseTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { templateId?: string; name: string; body: string }) => {
    if (!d?.name?.trim()) throw new Error("Give the licence a name.");
    if ((d.body ?? "").trim().length < 60) throw new Error("Paste the full licence language before saving it.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) throw new Error("Create your store first.");
    const row = { store_id: store.id, name: data.name.trim().slice(0, 120), body: data.body.trim().slice(0, 40000) };
    const q = data.templateId
      ? (context.supabase.from("store_license_templates") as AnyClient).update(row).eq("id", data.templateId).eq("store_id", store.id)
      : (context.supabase.from("store_license_templates") as AnyClient).insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLicenseTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { templateId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("store_license_templates").delete().eq("id", data.templateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------------------------------------------------------------
 * Email list export + issued licence library
 * ---------------------------------------------------------------------- */

/** CSV of every free-download email, in the column shape Mailchimp/Klaviyo expect. */
export const exportFreeDownloadEmails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) return { csv: "", count: 0, fileName: "email-list.csv" };

    const { data: leads } = await context.supabase
      .from("free_downloads").select("email, created_at, product_id").eq("store_id", store.id)
      .order("created_at", { ascending: false }).limit(20000);
    const { data: buyers } = await context.supabase
      .from("store_orders").select("buyer_email, buyer_name, created_at, status").eq("store_id", store.id)
      .order("created_at", { ascending: false }).limit(20000);

    const ids = [...new Set((leads ?? []).map((l: any) => l.product_id).filter(Boolean))];
    const { data: products } = ids.length
      ? await context.supabase.from("store_products").select("id, title").in("id", ids)
      : { data: [] as any[] };
    const titleOf = (id: string | null) =>
      (products ?? []).find((p: any) => p.id === id)?.title ?? "";

    type Row = { email: string; firstName: string; lastName: string; source: string; item: string; date: string };
    const rows = new Map<string, Row>();
    const push = (r: Row) => {
      const key = r.email.toLowerCase();
      if (!key.includes("@")) return;
      if (!rows.has(key)) rows.set(key, { ...r, email: key });
    };

    for (const l of (leads ?? []) as any[]) {
      push({ email: l.email ?? "", firstName: "", lastName: "", source: "Free download", item: titleOf(l.product_id), date: new Date(l.created_at).toISOString().slice(0, 10) });
    }
    for (const o of (buyers ?? []) as any[]) {
      if (o.status !== "paid") continue;
      const parts = String(o.buyer_name ?? "").trim().split(/\s+/);
      push({
        email: o.buyer_email ?? "",
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        source: "Purchase",
        item: "",
        date: new Date(o.created_at).toISOString().slice(0, 10),
      });
    }

    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Email Address", "First Name", "Last Name", "Source", "Item", "Signup Date"];
    const csv = [header.join(","), ...[...rows.values()].map((r) =>
      [r.email, r.firstName, r.lastName, r.source, r.item, r.date].map(esc).join(","),
    )].join("\r\n");

    return { csv, count: rows.size, fileName: `${store.handle ?? "store"}-email-list.csv` };
  });

/** Every licence PDF issued by this store, newest first, with signed download links. */
export const listIssuedLicenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) return { licenses: [] };

    const { data: orders } = await context.supabase
      .from("store_orders").select("id, buyer_name, buyer_email, currency, status, paid_at, created_at, token")
      .eq("store_id", store.id).eq("status", "paid")
      .order("created_at", { ascending: false }).limit(500);
    const orderIds = (orders ?? []).map((o: any) => o.id);
    if (!orderIds.length) return { licenses: [] };

    const { data: items } = await context.supabase
      .from("store_order_items")
      .select("id, order_id, title, tier_kind, price_cents, license_pdf_path, terms_snapshot, created_at")
      .in("order_id", orderIds);

    const licenses = await Promise.all(
      ((items ?? []) as any[])
        .filter((i) => !!i.license_pdf_path)
        .map(async (i) => {
          const o = (orders ?? []).find((x: any) => x.id === i.order_id) as any;
          return {
            id: i.id as string,
            title: i.title as string,
            tierKind: i.tier_kind as string,
            tierLabel: (i.terms_snapshot?.custom_label ?? null) as string | null,
            priceCents: i.price_cents as number,
            currency: (o?.currency ?? "USD") as string,
            buyerName: (o?.buyer_name ?? "") as string,
            buyerEmail: (o?.buyer_email ?? "") as string,
            issuedAt: (o?.paid_at ?? i.created_at) as string,
            url: await signPath("store", i.license_pdf_path, 86400),
          };
        }),
    );
    licenses.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
    return { licenses };
  });

/* ---------------- AI producer voice tag ---------------- */

export const TAG_STYLE_PRESETS = {
  deep_announcer: "Deep, cinematic announcer. Confident, slow, heavy low end, dramatic pause before the last word.",
  smooth_rnb: "Smooth, laid-back R&B delivery. Warm, breathy, slightly sung, relaxed groove.",
  gritty_street: "Gritty, raspy street voice. Hard-hitting, close to the mic, aggressive but controlled.",
  bright_pop: "Bright, energetic pop delivery. Upbeat, clean, radio-ready, friendly.",
  whisper: "Intimate close whisper. Airy, quiet, mysterious, right against the mic.",
  hype_mc: "Loud hype-man MC. Shouted, excited, punchy, big energy like a live show intro.",
} as const;

export type TagStylePreset = keyof typeof TAG_STYLE_PRESETS;

/** Genre presets: an ElevenLabs character voice + delivery direction + default FX. */
export type TagFx = {
  pitch: number;      // semitones, -12..+12
  double: number;     // 0..1 detuned double level
  slap: number;       // 0..1 slap delay level
  reverb: number;     // 0..1 short tail level
  drive: number;      // 0..1 saturation
  phone: boolean;     // telephone band-pass
  gain: number;       // 0.2..2 output trim
};

export const DEFAULT_TAG_FX: TagFx = {
  pitch: 0, double: 0, slap: 0, reverb: 0.12, drive: 0.1, phone: false, gain: 1,
};

export const TAG_PRESETS = {
  trap_hype: {
    label: "Trap Hype MC",
    voiceId: "iP95p4xoKVk53GoZ742B",
    direction: "Loud hype-man ad-lib. Shouted, punchy, huge energy like a live show intro.",
    settings: { stability: 0.2, similarity_boost: 0.8, style: 0.85, speed: 1.05 },
    fx: { pitch: -1, double: 0.45, slap: 0.35, reverb: 0.18, drive: 0.35, phone: false, gain: 1 },
  },
  street_gritty: {
    label: "Street Gritty",
    voiceId: "N2lVS1w4EtoT3dr4eOWO",
    direction: "Gritty, raspy street voice. Hard-hitting, right on the mic, aggressive but controlled.",
    settings: { stability: 0.25, similarity_boost: 0.85, style: 0.7, speed: 0.98 },
    fx: { pitch: -3, double: 0.35, slap: 0.2, reverb: 0.12, drive: 0.5, phone: false, gain: 1 },
  },
  rnb_smooth: {
    label: "R&B Smooth",
    voiceId: "cjVigY5qzO86Huf0OWal",
    direction: "Smooth, laid-back R&B delivery. Warm, breathy, half-sung, relaxed groove.",
    settings: { stability: 0.45, similarity_boost: 0.8, style: 0.45, speed: 0.95 },
    fx: { pitch: -1, double: 0.3, slap: 0.15, reverb: 0.3, drive: 0.12, phone: false, gain: 1 },
  },
  soul_warm: {
    label: "Soul Warm",
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    direction: "Warm soulful spoken intro. Rich, unhurried, intimate, vinyl-era feel.",
    settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, speed: 0.93 },
    fx: { pitch: -2, double: 0.2, slap: 0.1, reverb: 0.28, drive: 0.2, phone: false, gain: 1 },
  },
  edm_announcer: {
    label: "EDM Announcer",
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    direction: "Festival stage announcer. Big, clean, commanding, drop-ready.",
    settings: { stability: 0.4, similarity_boost: 0.75, style: 0.6, speed: 1 },
    fx: { pitch: -1, double: 0.5, slap: 0.4, reverb: 0.35, drive: 0.2, phone: false, gain: 1 },
  },
  deep_cinematic: {
    label: "Deep Cinematic",
    voiceId: "nPczCjzI2devNBz1zQrb",
    direction: "Deep cinematic trailer voice. Slow, heavy low end, dramatic pause before the last word.",
    settings: { stability: 0.6, similarity_boost: 0.8, style: 0.4, speed: 0.9 },
    fx: { pitch: -4, double: 0.25, slap: 0.15, reverb: 0.4, drive: 0.15, phone: false, gain: 1 },
  },
  whisper_ghost: {
    label: "Whisper / Ghost",
    voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    direction: "Intimate close whisper. Airy, quiet, mysterious, right against the mic.",
    settings: { stability: 0.5, similarity_boost: 0.85, style: 0.3, speed: 0.92 },
    fx: { pitch: -1, double: 0.55, slap: 0.1, reverb: 0.45, drive: 0.05, phone: false, gain: 1.15 },
  },
  female_hype: {
    label: "Female Hype",
    voiceId: "Xb7hH8MSUJpSbSDYk0k2",
    direction: "Confident female hype ad-lib. Punchy, bright, attitude, front of the mix.",
    settings: { stability: 0.25, similarity_boost: 0.8, style: 0.8, speed: 1.05 },
    fx: { pitch: 0, double: 0.4, slap: 0.3, reverb: 0.2, drive: 0.3, phone: false, gain: 1 },
  },
  female_sultry: {
    label: "Female Sultry",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    direction: "Sultry, breathy female delivery. Slow, close, seductive, R&B mood.",
    settings: { stability: 0.5, similarity_boost: 0.85, style: 0.5, speed: 0.92 },
    fx: { pitch: -1, double: 0.3, slap: 0.15, reverb: 0.35, drive: 0.1, phone: false, gain: 1 },
  },
} as const;

export type TagPresetKey = keyof typeof TAG_PRESETS;

/** Older saved tags stored an OpenAI-style style key — map them onto a preset. */
const LEGACY_STYLE_TO_PRESET: Record<string, TagPresetKey> = {
  deep_announcer: "deep_cinematic",
  smooth_rnb: "rnb_smooth",
  gritty_street: "street_gritty",
  bright_pop: "edm_announcer",
  whisper: "whisper_ghost",
  hype_mc: "trap_hype",
};

function resolvePreset(key?: string | null): TagPresetKey {
  if (key && key in TAG_PRESETS) return key as TagPresetKey;
  if (key && LEGACY_STYLE_TO_PRESET[key]) return LEGACY_STYLE_TO_PRESET[key];
  return "trap_hype";
}

const VOICE_BY_STYLE: Record<TagStylePreset, { male: string; female: string; neutral: string }> = {
  deep_announcer: { male: "onyx", female: "sage", neutral: "ash" },
  smooth_rnb: { male: "verse", female: "coral", neutral: "alloy" },
  gritty_street: { male: "ash", female: "ballad", neutral: "echo" },
  bright_pop: { male: "echo", female: "nova", neutral: "alloy" },
  whisper: { male: "ballad", female: "shimmer", neutral: "sage" },
  hype_mc: { male: "onyx", female: "nova", neutral: "fable" },
};

function tagVoice(style: string, gender: string): string {
  const preset = (style in VOICE_BY_STYLE ? style : "deep_announcer") as TagStylePreset;
  const g = gender === "male" || gender === "female" ? gender : "neutral";
  return VOICE_BY_STYLE[preset][g];
}

function tagInstructions(style: string, gender: string, note?: string): string {
  const preset = (style in TAG_STYLE_PRESETS ? style : "deep_announcer") as TagStylePreset;
  const g = gender === "male" ? "masculine" : gender === "female" ? "feminine" : "androgynous";
  return [
    `This is a short producer tag played over a music beat.`,
    TAG_STYLE_PRESETS[preset],
    `Use a ${g} sounding voice.`,
    note?.trim() ? `Extra direction: ${note.trim()}` : "",
    `Keep it short and punchy — no intro, no extra words.`,
  ].filter(Boolean).join(" ");
}

/** Auditionable ElevenLabs voices for the advanced picker. */
export const listTagVoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { available: false, voices: [] as Array<{ id: string; name: string; description: string | null }> };
    const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
    if (!res.ok) {
      console.error(`[tag] voices ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { available: true, voices: [] as Array<{ id: string; name: string; description: string | null }> };
    }
    const json = (await res.json()) as any;
    const voices = (json?.voices ?? []).map((v: any) => ({
      id: String(v.voice_id),
      name: String(v.name ?? "Voice"),
      description: (v.labels
        ? Object.values(v.labels).filter(Boolean).join(" · ")
        : v.description) ?? null,
    }));
    return { available: true, voices };
  });

/** Generate a spoken producer tag. Prefers ElevenLabs character voices and
 *  falls back to the built-in Lovable AI voice when it is not connected. */
export const generateVoiceTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    phrase?: string; preset?: string; voiceId?: string; note?: string;
    stability?: number; style?: number; speed?: number;
    // legacy
    style_key?: string; gender?: string;
  }) => d ?? {})
  .handler(async ({ data }) => {
    const phrase = (data.phrase?.trim() || "Purchase this track").slice(0, 120);
    const presetKey = resolvePreset(data.preset ?? data.style_key);
    const preset = TAG_PRESETS[presetKey];
    const note = data.note?.trim();
    const elevenKey = process.env.ELEVENLABS_API_KEY;

    if (elevenKey) {
      const voiceId = data.voiceId?.trim() || preset.voiceId;
      const clamp = (n: number | undefined, lo: number, hi: number, d: number) =>
        typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            // Direction is spoken context, not read aloud — ElevenLabs reads `text`
            // only, so delivery is steered through voice settings + the chosen voice.
            text: phrase,
            model_id: "eleven_multilingual_v2",
            previous_text: note ? `${preset.direction} ${note}` : preset.direction,
            voice_settings: {
              stability: clamp(data.stability, 0, 1, preset.settings.stability),
              similarity_boost: preset.settings.similarity_boost,
              style: clamp(data.style, 0, 1, preset.settings.style),
              use_speaker_boost: true,
              speed: clamp(data.speed, 0.7, 1.2, preset.settings.speed),
            },
          }),
        },
      );
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return {
          base64: bytesToBase64(buf), mimeType: "audio/mpeg",
          voice: voiceId, engine: "elevenlabs" as const, preset: presetKey, fx: preset.fx as TagFx,
        };
      }
      const body = (await res.text()).slice(0, 300);
      console.error(`[tag] elevenlabs ${res.status}: ${body}`);
      if (res.status === 401 || res.status === 403) throw new Error("ElevenLabs rejected the request — reconnect it with a valid key.");
      if (res.status === 429) throw new Error("ElevenLabs is rate limiting — try again in a moment.");
      if (res.status === 402) throw new Error("ElevenLabs credits are exhausted — top up your ElevenLabs account.");
      throw new Error(`Voice tag failed: ${res.status} ${body}`);
    }

    // Fallback: built-in Lovable AI voice.
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured");
    const gender = data.gender ?? "neutral";
    const legacyStyle = Object.entries(LEGACY_STYLE_TO_PRESET)
      .find(([, p]) => p === presetKey)?.[0] ?? "deep_announcer";
    const voice = tagVoice(legacyStyle, gender);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: phrase,
        voice,
        instructions: tagInstructions(legacyStyle, gender, note),
        response_format: "mp3",
        stream_format: "audio",
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      if (res.status === 402) throw new Error("Out of AI credits — top up to generate a voice tag.");
      if (res.status === 429) throw new Error("Voice generation is busy right now — try again in a moment.");
      throw new Error(`Voice tag failed: ${res.status} ${body}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      base64: bytesToBase64(buf), mimeType: "audio/mpeg",
      voice, engine: "lovable" as const, preset: presetKey, fx: preset.fx as TagFx,
    };
  });

/** Persist a generated tag as the store's saved producer tag. */
export const saveVoiceTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    base64: string; phrase: string; style: string; gender: string; voice: string;
    note?: string; preset?: string; fx?: TagFx;
  }) => {
    if (!d?.base64) throw new Error("Generate a tag first.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const store = await ownStore(context.supabase, context.userId);
    if (!store) throw new Error("Create your store first.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const bin = atob(data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const path = `${context.userId}/tag/producer-tag.mp3`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("store").upload(path, bytes, { upsert: true, contentType: "audio/mpeg" });
    if (upErr) throw new Error(upErr.message);

    const { error } = await (context.supabase.from("stores") as AnyClient).update({
      tag_phrase: data.phrase.slice(0, 120),
      tag_style: data.style,
      tag_gender: data.gender,
      tag_voice: data.voice,
      tag_audio_path: path,
      tag_preset: data.preset ?? null,
      tag_fx: data.fx ?? null,
    }).eq("id", store.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Saved producer tag bytes, so the browser can build tagged versions. */
export const getMyVoiceTag = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const store = await ownStore(context.supabase, context.userId);
    const path = store?.tag_audio_path as string | null | undefined;
    if (!path) return { base64: null as string | null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: blob, error } = await supabaseAdmin.storage.from("store").download(path);
    if (error || !blob) return { base64: null as string | null };
    return { base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
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