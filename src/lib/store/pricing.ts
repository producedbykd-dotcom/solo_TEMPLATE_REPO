/**
 * Client-safe storefront pricing + promotion math.
 *
 * The SAME functions run in the cart drawer (preview) and inside the server
 * checkout handler (authoritative), so what the buyer sees is exactly what
 * PayPal charges. Never price a cart anywhere else.
 */

export type TierKind = "single" | "album" | "non_exclusive" | "exclusive";

export const TIER_LABEL: Record<TierKind, string> = {
  single: "Single",
  album: "Album",
  non_exclusive: "Non-exclusive lease",
  exclusive: "Exclusive lease",
};

export type PromoConfig = {
  type: "percent" | "bogo";
  percent: number;
  bogo_buy: number;
  bogo_free: number;
  scope: "all" | "leases";
  exclude_exclusive: boolean;
  headline: string | null;
  active: boolean;
  ends_at: string | null;
};

export type CartLine = {
  productId: string;
  tierId: string;
  title: string;
  tierKind: TierKind;
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
  if (promo.exclude_exclusive && line.tierKind === "exclusive") return false;
  if (promo.scope === "leases") return line.tierKind === "non_exclusive" || line.tierKind === "exclusive";
  return true;
}

export function promoHeadline(promo: PromoConfig | null | undefined): string | null {
  if (!promoIsLive(promo)) return null;
  const p = promo as PromoConfig;
  if (p.headline?.trim()) return p.headline.trim();
  if (p.type === "percent") return `${p.percent}% off${p.scope === "leases" ? " all leases" : " everything"}`;
  const free = p.bogo_free === 1 ? "get 1 free" : `get ${p.bogo_free} free`;
  return p.bogo_buy === 1 ? `Buy 1, ${free}` : `Buy ${p.bogo_buy}, ${free}`;
}

/** Discounted unit price for a single item, used for struck-through prices. */
export function displayPrice(
  priceCents: number,
  tierKind: TierKind,
  promo: PromoConfig | null | undefined,
): { priceCents: number; wasCents: number | null } {
  if (!promoIsLive(promo)) return { priceCents, wasCents: null };
  const p = promo as PromoConfig;
  if (p.type !== "percent") return { priceCents, wasCents: null };
  if (!isEligible({ productId: "", tierId: "", title: "", tierKind, unitPriceCents: priceCents }, p)) {
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