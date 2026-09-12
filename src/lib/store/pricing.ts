/**
 * Client-safe storefront pricing + promotion math.
 *
 * The SAME functions run in the cart drawer (preview) and inside the server
 * checkout handler (authoritative), so what the buyer sees is exactly what
 * PayPal charges. Never price a cart anywhere else.
 */

export type TierKind = "single" | "album" | "non_exclusive" | "exclusive" | "custom";

export const TIER_LABEL: Record<TierKind, string> = {
  single: "Single",
  album: "Album",
  non_exclusive: "Non-exclusive lease",
  exclusive: "Exclusive lease",
  custom: "Custom licence",
};

export const TIER_KINDS: TierKind[] = ["single", "album", "non_exclusive", "exclusive", "custom"];

/** Display name for a tier — custom licences use the seller's own wording. */
export function tierLabel(kind: TierKind | string, customLabel?: string | null): string {
  if (kind === "custom") return (customLabel ?? "").trim() || "Custom licence";
  return TIER_LABEL[kind as TierKind] ?? String(kind);
}

export type PromoConfig = {
  type: "percent" | "bogo";
  percent: number;
  bogo_buy: number;
  bogo_free: number;
  scope: "all" | "leases";
  exclude_exclusive: boolean;
  /** Licence types the sale applies to. When set, this wins over scope/exclude_exclusive. */
  scope_kinds?: string[] | null;
  /** Specific tier ids the sale applies to (used to target individual custom licences). */
  scope_tier_ids?: string[] | null;
  headline: string | null;
  active: boolean;
  ends_at: string | null;
};

export type CartLine = {
  productId: string;
  tierId: string;
  title: string;
  tierKind: TierKind;
  tierLabel?: string | null;
  unitPriceCents: number;
};

export type PricedLine = CartLine & { priceCents: number; discountCents: number };

export type CartTotals = {
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  promoLabel: string | null;
};

export function promoIsLive(promo: PromoConfig | null | undefined, now = new Date()): boolean {
  if (!promo || !promo.active) return false;
  if (promo.type === "percent" && promo.percent <= 0) return false;
  if (promo.ends_at && new Date(promo.ends_at).getTime() < now.getTime()) return false;
  return true;
}

function isEligible(line: CartLine, promo: PromoConfig): boolean {
  const ids = promo.scope_tier_ids ?? null;
  if (ids && ids.length > 0) return line.tierId ? ids.includes(line.tierId) : false;
  const kinds = promo.scope_kinds ?? null;
  if (kinds && kinds.length > 0) return kinds.includes(line.tierKind);
  if (promo.exclude_exclusive && line.tierKind === "exclusive") return false;
  if (promo.scope === "leases") return line.tierKind === "non_exclusive" || line.tierKind === "exclusive";
  return true;
}

export function promoHeadline(promo: PromoConfig | null | undefined): string | null {
  if (!promoIsLive(promo)) return null;
  const p = promo as PromoConfig;
  if (p.headline?.trim()) return p.headline.trim();
  const ids = p.scope_tier_ids ?? null;
  const kinds = p.scope_kinds ?? null;
  const where = ids && ids.length > 0
    ? " on selected licences"
    : kinds && kinds.length > 0 && kinds.length < TIER_KINDS.length
      ? ` on ${kinds.map((k) => tierLabel(k).toLowerCase()).join(", ")}`
      : p.scope === "leases" ? " all leases" : " everything";
  if (p.type === "percent") return `${p.percent}% off${where}`;
  const free = p.bogo_free === 1 ? "get 1 free" : `get ${p.bogo_free} free`;
  return p.bogo_buy === 1 ? `Buy 1, ${free}` : `Buy ${p.bogo_buy}, ${free}`;
}

/** Discounted unit price for a single item, used for struck-through prices. */
export function displayPrice(
  priceCents: number,
  tierKind: TierKind,
  promo: PromoConfig | null | undefined,
  tierId?: string,
): { priceCents: number; wasCents: number | null } {
  if (!promoIsLive(promo)) return { priceCents, wasCents: null };
  const p = promo as PromoConfig;
  if (p.type !== "percent") return { priceCents, wasCents: null };
  if (!isEligible({ productId: "", tierId: tierId ?? "", title: "", tierKind, unitPriceCents: priceCents }, p)) {
    return { priceCents, wasCents: null };
  }
  const next = Math.max(0, Math.round(priceCents * (1 - p.percent / 100)));
  return { priceCents: next, wasCents: priceCents };
}

export function priceCart(lines: CartLine[], promo: PromoConfig | null | undefined): CartTotals {
  const subtotalCents = lines.reduce((n, l) => n + l.unitPriceCents, 0);
  const priced: PricedLine[] = lines.map((l) => ({ ...l, priceCents: l.unitPriceCents, discountCents: 0 }));

  if (promoIsLive(promo)) {
    const p = promo as PromoConfig;
    const eligibleIdx = priced.map((l, i) => (isEligible(l, p) ? i : -1)).filter((i) => i >= 0);

    if (p.type === "percent") {
      for (const i of eligibleIdx) {
        const off = Math.round(priced[i].unitPriceCents * (p.percent / 100));
        priced[i].discountCents = off;
        priced[i].priceCents = Math.max(0, priced[i].unitPriceCents - off);
      }
    } else {
      const buy = Math.max(1, p.bogo_buy);
      const free = Math.max(1, p.bogo_free);
      // Cheapest items in each (buy + free) group are the free ones.
      const sorted = [...eligibleIdx].sort((a, b) => priced[a].unitPriceCents - priced[b].unitPriceCents);
      const groups = Math.floor(eligibleIdx.length / (buy + free));
      const freeCount = groups * free;
      for (let n = 0; n < freeCount; n++) {
        const i = sorted[n];
        priced[i].discountCents = priced[i].unitPriceCents;
        priced[i].priceCents = 0;
      }
    }
  }

  const discountCents = priced.reduce((n, l) => n + l.discountCents, 0);
  return {
    lines: priced,
    subtotalCents,
    discountCents,
    totalCents: Math.max(0, subtotalCents - discountCents),
    promoLabel: promoHeadline(promo),
  };
}

export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format((cents || 0) / 100);
}