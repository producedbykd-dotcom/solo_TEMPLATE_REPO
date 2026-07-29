import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getOrder } from "@/lib/storefront.functions";
import { Button } from "@/components/ui/button";
import { money, TIER_LABEL, type TierKind } from "@/lib/store/pricing";
import { CheckCircle2, Clock, Download, FileText, Loader2 } from "lucide-react";

export const Route = createFileRoute("/order/$token")({
  loader: ({ params }) => getOrder({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Your order — Release Engine" },
      { name: "description", content: "Download your purchased tracks and licence agreements." },
      { property: "og:title", content: "Your order" },
      { property: "og:description", content: "Download your purchased tracks and licence agreements." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => <Center>We could not load this order. Refresh in a moment.</Center>,
  notFoundComponent: () => <Center>Order not found.</Center>,
  component: OrderPage,
});

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-lg px-6 py-24 text-center text-muted-foreground">{children}</main>;
}

function OrderPage() {
  const initial = Route.useLoaderData();
  const { token } = Route.useParams();
  const [order, setOrder] = useState(initial.order);

  // PayPal's IPN can land a few seconds after the buyer returns — poll briefly.
  useEffect(() => {
    if (!order || order.status === "paid") return;
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      const res = await getOrder({ data: { token } }).catch(() => null);
      if (res?.order) setOrder(res.order);
      if (res?.order?.status === "paid" || tries >= 20) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [order, token]);

  if (!order) return <Center>Order not found.</Center>;
  const paid = order.status === "paid";

  return (
    <main className="mx-auto max-w-2xl px-5 py-14">
      <div className="flex items-center gap-3">
        {paid ? (
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
        ) : (
          <Clock className="h-7 w-7 text-amber-500" />
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {paid ? "Thank you — payment received" : "Waiting for payment confirmation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {paid
              ? `Your files and licences are ready, ${order.buyerName}.`
              : "This page updates automatically as soon as PayPal confirms your payment."}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {order.items.map((it: Record<string, any>) => (
          <div key={it.id} className="rounded-lg border border-border/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{it.title}</p>
                <p className="text-xs text-muted-foreground">{TIER_LABEL[it.tierKind as TierKind] ?? it.tierKind}</p>
              </div>
              <span className="text-sm">{it.priceCents === 0 ? "FREE" : money(it.priceCents, order.currency)}</span>
            </div>
            {paid && (
              <div className="mt-3 flex flex-wrap gap-2">
                {it.audioUrl && (
                  <Button asChild size="sm" variant="secondary">
                    <a href={it.audioUrl} download><Download className="mr-2 h-4 w-4" />Download audio</a>
                  </Button>
                )}
                {it.licenseUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={it.licenseUrl} target="_blank" rel="noreferrer"><FileText className="mr-2 h-4 w-4" />Licence PDF</a>
                  </Button>
                )}
                {!it.audioUrl && !it.licenseUrl && (
                  <span className="inline-flex items-center text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Preparing your files…
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4 text-sm">
        <span className="text-muted-foreground">Total paid</span>
        <span className="text-lg font-semibold">{money(order.totalCents, order.currency)}</span>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Keep this page link — it stays valid for your downloads. Questions? Reply to your PayPal receipt to reach{" "}
        {order.store.name}.
      </p>
      {order.store.handle && (
        <Button asChild variant="ghost" size="sm" className="mt-3 px-0">
          <Link to="/store/$handle" params={{ handle: order.store.handle }}>← Back to {order.store.name}</Link>
        </Button>
      )}
    </main>
  );
}