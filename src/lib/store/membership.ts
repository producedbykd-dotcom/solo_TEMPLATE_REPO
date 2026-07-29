/**
 * Client-safe membership math. The SAME function runs in the cart drawer and
 * inside the server checkout handler, so what a member sees is what they pay.
 *
 * Membership never covers exclusive licences.
 */
import type { CartTotals, PricedLine, TierKind } from "./pricing";

export type MembershipPlan = {
  name: string;
  description: string | null;
  price_cents: number;
  interval: "month" | "year";
  mode: "quota" | "all_access";
  lease_quota: number;
  download_quota: number;
  discount_percent: number;
  active: boolean;
};

export type MemberState = {
  mode: "quota" | "all_access";
  leasesRemaining: number;
  downloadsRemaining: number;
  discountPercent: number;
};

export type MemberTotals = CartTotals & {
  memberDiscountCents: number;
  memberLabel: string | null;
  leasesUsed: number;
  downloadsUsed: number;
};

const isLease = (k: TierKind) => k === "non_exclusive";
const isDownload = (k: TierKind) => k === "single" || k === "album";
const covered = (k: TierKind) => isLease(k) || isDownload(k);

export function planBlurb(plan: MembershipPlan): string {
  if (plan.mode === "all_access") return "Unlimited leases and downloads while subscribed.";
  const bits: string[] = [];
  if (plan.lease_quota > 0) bits.push(`${plan.lease_quota} beat lease${plan.lease_quota === 1 ? "" : "s"}`);
  if (plan.download_quota > 0) bits.push(`${plan.download_quota} download${plan.download_quota === 1 ? "" : "s"}`);
  const quota = bits.length ? bits.join(" + ") : "member pricing";
  const extra = plan.discount_percent > 0 ? `, then ${plan.discount_percent}% off everything else` : "";
  return `${quota} every ${plan.interval}${extra}.`;
}

/**
 * Apply a member's remaining allowance on top of already-promo-priced lines.
 * The most expensive eligible items are consumed first, which is what a buyer
 * expects from an allowance.
 */
export function applyMembership(totals: CartTotals, member: MemberState | null): MemberTotals {
  const base: MemberTotals = {
    ...totals,
    lines: totals.lines.map((l) => ({ ...l })),
    memberDiscountCents: 0,
    memberLabel: null,
    leasesUsed: 0,
    downloadsUsed: 0,
  };
  if (!member) return base;

  const lines = base.lines as PricedLine[];
  const order = lines
    .map((l, i) => i)
    .filter((i) => covered(lines[i].tierKind) && lines[i].priceCents > 0)
    .sort((a, b) => lines[b].priceCents - lines[a].priceCents);

  let leases = member.mode === "all_access" ? Number.POSITIVE_INFINITY : Math.max(0, member.leasesRemaining);
  let downloads = member.mode === "all_access" ? Number.POSITIVE_INFINITY : Math.max(0, member.downloadsRemaining);

  for (const i of order) {
    const l = lines[i];
    const bucket = isLease(l.tierKind) ? "lease" : "download";
    const left = bucket === "lease" ? leases : downloads;
    if (left >= 1) {
      base.memberDiscountCents += l.priceCents;
      l.discountCents += l.priceCents;
      l.priceCents = 0;
      if (bucket === "lease") { leases -= 1; base.leasesUsed += 1; }
      else { downloads -= 1; base.downloadsUsed += 1; }
    } else if (member.discountPercent > 0) {
      const off = Math.round(l.priceCents * (member.discountPercent / 100));
      base.memberDiscountCents += off;
      l.discountCents += off;
      l.priceCents = Math.max(0, l.priceCents - off);
    }
  }

  base.discountCents = lines.reduce((n, l) => n + l.discountCents, 0);
  base.totalCents = Math.max(0, lines.reduce((n, l) => n + l.priceCents, 0));
  base.memberLabel = base.memberDiscountCents > 0 ? "Membership applied" : "Membership active";
  return base;
}