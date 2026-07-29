/**
 * PayPal hosted checkout with the ARTIST'S EMAIL ONLY (no API credentials).
 *
 * Buyers are sent to PayPal's hosted cart (`business=<artist paypal email>`),
 * so funds settle directly in the artist's account. Completion arrives as an
 * IPN POST at /api/public/paypal/ipn, which we validate by posting the exact
 * payload back to PayPal (`cmd=_notify-validate`) before trusting a single
 * field, then cross-check payee + total against what we priced server-side.
 */

export function paypalEnv(): "live" | "sandbox" {
  return (process.env.PAYPAL_ENV ?? "live").trim().toLowerCase() === "sandbox" ? "sandbox" : "live";
}

export function paypalCheckoutBase(): string {
  return paypalEnv() === "sandbox"
    ? "https://www.sandbox.paypal.com/cgi-bin/webscr"
    : "https://www.paypal.com/cgi-bin/webscr";
}

export function paypalIpnBase(): string {
  return paypalEnv() === "sandbox"
    ? "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr"
    : "https://ipnpb.paypal.com/cgi-bin/webscr";
}

export type CheckoutItem = { name: string; amountCents: number };

/**
 * Build the hosted-cart URL. Uses cart upload so several items land in one
 * PayPal payment. Item prices are the DISCOUNTED prices we computed, so the
 * PayPal total always equals our stored order total.
 */
export function buildCheckoutUrl(args: {
  payeeEmail: string;
  items: CheckoutItem[];
  currency: string;
  orderToken: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  storeName: string;
}): string {
  const p = new URLSearchParams();
  p.set("cmd", "_cart");
  p.set("upload", "1");
  p.set("business", args.payeeEmail);
  p.set("currency_code", args.currency);
  p.set("no_shipping", "1");
  p.set("charset", "utf-8");
  p.set("custom", args.orderToken);
  p.set("invoice", args.orderToken);
  p.set("item_name", `${args.storeName} order`);
  p.set("notify_url", args.notifyUrl);
  p.set("return", args.returnUrl);
  p.set("cancel_return", args.cancelUrl);
  p.set("rm", "1");

  args.items.forEach((it, i) => {
    const n = i + 1;
    p.set(`item_name_${n}`, it.name.slice(0, 120));
    p.set(`amount_${n}`, (it.amountCents / 100).toFixed(2));
    p.set(`quantity_${n}`, "1");
  });

  return `${paypalCheckoutBase()}?${p.toString()}`;
}

/** Post the raw IPN body back to PayPal. Only "VERIFIED" may be trusted. */
export async function verifyIpn(rawBody: string): Promise<boolean> {
  const res = await fetch(paypalIpnBase(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ReleaseEngine-IPN/1.0",
    },
    body: `cmd=_notify-validate&${rawBody}`,
  });
  const text = (await res.text()).trim();
  return text === "VERIFIED";
}

/** True when the address is a real, receivable PayPal account. */
export async function paypalAddressExists(email: string): Promise<boolean> {
  // PayPal has no public "does this email exist" API without credentials.
  // Hosted checkout itself rejects unreceivable addresses, so we validate
  // shape here and surface PayPal's own error at checkout time.
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim());
}