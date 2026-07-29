import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStorefront, startCheckout, claimFreeDownload, startMembership, getMemberStatus, manageMembership } from "@/lib/storefront.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShoppingCart, Download, Trash2, Loader2, Tag, Play, Pause, SkipBack, SkipForward, Moon, Sun, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { priceCart, money, displayPrice, TIER_LABEL, type CartLine, type PromoConfig, type TierKind } from "@/lib/store/pricing";
import { applyMembership, planBlurb, type MemberState, type MembershipPlan } from "@/lib/store/membership";

export const Route = createFileRoute("/store/$handle")({
  loader: async ({ params }) => {
    const res = await getStorefront({ data: { handle: params.handle } });
    if (!res.store) throw notFound();
    return res;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.store?.name ?? "Music store";
    const title = `${name} — Music & Beats`;
    const description =
      loaderData?.store?.bio?.slice(0, 155) ??
      `Buy singles, albums and beat licences directly from ${name}. Instant delivery.`;
    const image = loaderData?.store?.logoUrl ?? null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        ...(image
          ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }]
          : []),
      ],
    };
  },
  errorComponent: () => (
    <Shell>
      <p className="text-muted-foreground">This store could not be loaded. Please try again.</p>
    </Shell>
  ),
  notFoundComponent: () => (
    <Shell>
      <h1 className="text-2xl font-semibold">Store not found</h1>
      <p className="mt-2 text-muted-foreground">This store does not exist or is not published yet.</p>
    </Shell>
  ),
  component: Storefront,
});

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-6 py-24 text-center">{children}</main>;
}

const PREVIEW_SECONDS = 45;

/** Bottom-docked player shared by every track on the page. */
function UnifiedPlayer({
  queue,
  index,
  playing,
  accent,
  currency,
  promo,
  onTogglePlay,
  onSkip,
  onAdd,
}: {
  queue: Record<string, any>[];
  index: number;
  playing: boolean;
  accent: string;
  currency: string;
  promo: PromoConfig | null;
  onTogglePlay: () => void;
  onSkip: (dir: -1 | 1) => void;
  onAdd: (line: CartLine) => void;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [pos, setPos] = useState(0);
  const track = queue[index];

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    setPos(0);
    el.currentTime = 0;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [track?.id, playing]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => {
      if (el.currentTime >= PREVIEW_SECONDS) {
        el.pause();
        el.currentTime = 0;
        setPos(0);
        onSkip(1);
      } else setPos(el.currentTime);
    };
    const onEnd = () => onSkip(1);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [onSkip]);

  if (!track) return null;
  const pct = Math.min(100, (pos / PREVIEW_SECONDS) * 100);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 backdrop-blur">
      <audio ref={ref} src={track.previewUrl} preload="none" />
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-5 py-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
          {track.artworkUrl && <img src={track.artworkUrl} alt={`${track.title} artwork`} className="h-full w-full object-cover" />}
        </div>

        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous track" onClick={() => onSkip(-1)}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Stop preview" : "Play preview"}
            className="grid h-10 w-10 place-items-center rounded-full text-white"
            style={{ background: accent }}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <Button size="icon" variant="ghost" aria-label="Next track" onClick={() => onSkip(1)}>
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-w-[8rem] flex-1">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: accent }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">45-second preview</p>
        </div>

        {track.tiers?.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="text-white hover:opacity-90" style={{ background: accent }}>
                Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {track.tiers.map((t: Record<string, any>) => {
                const kind = t.kind as TierKind;
                const d = displayPrice(t.price_cents, kind, promo);
                return (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={() =>
                      onAdd({
                        productId: track.id,
                        tierId: t.id,
                        title: track.title,
                        tierKind: kind,
                        unitPriceCents: t.price_cents,
                      })
                    }
                  >
                    {TIER_LABEL[kind] ?? kind} · {money(d.priceCents, currency)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

type CartItem = CartLine;

/** Public store theme: producer's default, overridable by the visitor. */
function useStoreTheme(handle: string, initial: "dark" | "light") {
  const key = `store-theme:${handle}`;
  const [theme, setTheme] = useState<"dark" | "light">(initial);

  useEffect(() => {
    const saved = (typeof window !== "undefined" ? localStorage.getItem(key) : null) as "dark" | "light" | null;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, [key]);

  useEffect(() => {
    const root = document.documentElement;
    const prevDark = root.classList.contains("dark");
    const prevLight = root.classList.contains("light");
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    return () => {
      root.classList.toggle("dark", prevDark);
      root.classList.toggle("light", prevLight);
    };
  }, [theme]);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(key, next); } catch { /* ignore */ }
  };

  return { theme, toggle };
}

/** Member token lives in the buyer's browser — it is their private key. */
function useMemberToken(handle: string) {
  const key = `store-member:${handle}`;
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("member");
    if (fromUrl && /^[a-f0-9]{16,64}$/i.test(fromUrl)) {
      try { localStorage.setItem(key, fromUrl); } catch { /* ignore */ }
      url.searchParams.delete("member");
      window.history.replaceState({}, "", url.toString());
      setToken(fromUrl);
      return;
    }
    setToken(localStorage.getItem(key));
  }, [key]);

  return {
    token,
    clear: () => { try { localStorage.removeItem(key); } catch { /* ignore */ } setToken(null); },
  };
}

function Storefront() {
  const { store, products, promo, membership } = Route.useLoaderData() as any;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [freeFor, setFreeFor] = useState<{ id: string; title: string } | null>(null);
  const { theme, toggle: toggleTheme } = useStoreTheme(store!.handle, (store as any)!.theme ?? "dark");
  const { token: memberToken, clear: clearMember } = useMemberToken(store!.handle);
  const [member, setMember] = useState<{ email: string; planName: string; renewsAt: string | null; state: MemberState } | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);

  useEffect(() => {
    if (!memberToken) { setMember(null); return; }
    let live = true;
    getMemberStatus({ data: { handle: store!.handle, token: memberToken } })
      .then((r) => { if (live) setMember((r.member as any) ?? null); })
      .catch(() => { /* treated as non-member */ });
    return () => { live = false; };
  }, [memberToken, store]);

  const queue = useMemo(
    () => (products as Record<string, any>[]).filter((p) => p.previewUrl),
    [products],
  );
  const [playIndex, setPlayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const skip = useCallback(
    (dir: -1 | 1) => {
      if (queue.length === 0) return;
      setPlayIndex((i) => (i + dir + queue.length) % queue.length);
    },
    [queue.length],
  );

  const playTrack = (productId: string) => {
    const i = queue.findIndex((q) => q.id === productId);
    if (i < 0) return;
    if (i === playIndex) setPlaying((p) => !p);
    else {
      setPlayIndex(i);
      setPlaying(true);
    }
  };

  const totals = useMemo(
    () => applyMembership(priceCart(cart, promo as PromoConfig | null), member?.state ?? null),
    [cart, promo, member],
  );
  const accent = store!.accent;

  const add = (line: CartItem) => {
    if (cart.some((c) => c.tierId === line.tierId)) {
      toast.info("Already in your cart");
      return;
    }
    setCart((c) => [...c, line]);
    toast.success(`${line.title} added`);
  };

  return (
    <div className="min-h-screen bg-background" style={{ ["--store-accent" as string]: accent }}>
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            {store!.logoUrl ? (
              <img src={store!.logoUrl} alt={`${store!.name} logo`} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white" style={{ background: accent }}>
                {store!.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="text-sm font-semibold tracking-tight">{store!.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCartOpen(true)}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Cart{cart.length ? ` (${cart.length})` : ""}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{store!.name}</h1>
        {store!.bio && <p className="mt-2 max-w-2xl text-muted-foreground">{store!.bio}</p>}
        {totals.promoLabel && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white" style={{ background: accent }}>
            <Tag className="h-3.5 w-3.5" /> {totals.promoLabel}
          </div>
        )}

        <MembershipCard
          plan={membership as MembershipPlan | null}
          member={member}
          currency={store!.currency}
          accent={accent}
          onJoin={() => setJoinOpen(true)}
          onManage={async () => {
            try {
              const r = await manageMembership({ data: { handle: store!.handle, token: memberToken ?? "" } });
              window.location.href = r.url;
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not open your billing page.");
            }
          }}
          onSignOut={() => { clearMember(); toast.success("Member link removed from this device."); }}
        />

        {products.length === 0 ? (
          <p className="mt-12 text-muted-foreground">No releases are listed yet — check back soon.</p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p: Record<string, any>) => (
              <article key={p.id} className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <div className="aspect-square w-full bg-muted">
                  {p.artworkUrl ? (
                    <img src={p.artworkUrl} alt={`${p.title} artwork`} loading="lazy" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <h2 className="font-medium leading-tight">{p.title}</h2>
                    <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">{p.kind}</p>
                  </div>
                  {p.description && <p className="line-clamp-3 text-sm text-muted-foreground">{p.description}</p>}

                  {p.previewUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => playTrack(p.id)}
                      aria-label={`Play 45 second preview of ${p.title}`}
                    >
                      {playing && queue[playIndex]?.id === p.id ? (
                        <><Pause className="mr-2 h-4 w-4" /> Playing</>
                      ) : (
                        <><Play className="mr-2 h-4 w-4" /> Preview</>
                      )}
                    </Button>
                  )}

                  <div className="space-y-1.5">
                    {p.tiers.map((t: Record<string, any>) => {
                      const kind = t.kind as TierKind;
                      const d = displayPrice(t.price_cents, kind, promo as PromoConfig | null);
                      return (
                        <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{TIER_LABEL[kind] ?? kind}</p>
                            <p className="text-xs text-muted-foreground">
                              {d.wasCents !== null && <s className="mr-1 opacity-60">{money(d.wasCents, store!.currency)}</s>}
                              <span className="font-medium text-foreground">{money(d.priceCents, store!.currency)}</span>
                              {t.stream_limit ? ` · ${Number(t.stream_limit).toLocaleString()} streams` : ""}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            style={{ background: accent }}
                            className="text-white hover:opacity-90"
                            onClick={() => add({ productId: p.id, tierId: t.id, title: p.title, tierKind: kind, unitPriceCents: t.price_cents })}
                          >
                            Add
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {p.freeDownload && (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setFreeFor({ id: p.id, title: p.title })}>
                      <Download className="mr-2 h-4 w-4" /> Free tagged download
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        <footer className="mt-16 border-t border-border/60 pb-24 pt-6 text-xs text-muted-foreground">
          <p>
            Payments are processed securely by PayPal. Licences are delivered instantly after payment.{" "}
            <Link to="/terms" className="underline">Terms</Link> · <Link to="/privacy" className="underline">Privacy</Link>
          </p>
        </footer>
      </main>

      <CartDialog
        open={cartOpen}
        onOpenChange={setCartOpen}
        handle={store!.handle}
        currency={store!.currency}
        accent={accent}
        totals={totals}
        memberToken={memberToken}
        memberEmail={member?.email ?? null}
        onRemove={(tierId) => setCart((c) => c.filter((x) => x.tierId !== tierId))}
      />
      <JoinMembershipDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        handle={store!.handle}
        plan={membership as MembershipPlan | null}
        currency={store!.currency}
        accent={accent}
      />
      <FreeDownloadDialog product={freeFor} onClose={() => setFreeFor(null)} accent={accent} />
      {queue.length > 0 && (
        <UnifiedPlayer
          queue={queue}
          index={playIndex}
          playing={playing}
          accent={accent}
          currency={store!.currency}
          promo={promo as PromoConfig | null}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSkip={(d) => { skip(d); setPlaying(true); }}
          onAdd={add}
        />
      )}
    </div>
  );
}

function CartDialog({
  open, onOpenChange, handle, currency, accent, totals, memberToken, memberEmail, onRemove,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; handle: string; currency: string;
  accent: string; totals: ReturnType<typeof applyMembership>;
  memberToken?: string | null; memberEmail?: string | null;
  onRemove: (tierId: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(memberEmail ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (memberEmail) setEmail(memberEmail); }, [memberEmail]);

  const checkout = async () => {
    setBusy(true);
    try {
      const res = await startCheckout({
        data: {
          handle,
          buyerName: name,
          buyerEmail: email,
          memberToken: memberToken ?? null,
          items: totals.lines.map((l) => ({ productId: l.productId, tierId: l.tierId })),
        },
      });
      window.location.href = res.checkoutUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Checkout could not be started.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your cart</DialogTitle>
          <DialogDescription>Licences are issued in the name you enter below.</DialogDescription>
        </DialogHeader>

        {totals.lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Your cart is empty.</p>
        ) : (
          <>
            <div className="space-y-2">
              {totals.lines.map((l) => (
                <div key={l.tierId} className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{l.title}</p>
                    <p className="text-xs text-muted-foreground">{TIER_LABEL[l.tierKind]}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={l.priceCents === 0 ? "text-emerald-500" : ""}>
                      {l.priceCents === 0 ? "FREE" : money(l.priceCents, currency)}
                    </span>
                    <button aria-label="Remove item" onClick={() => onRemove(l.tierId)} className="text-muted-foreground hover:text-foreground">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1 border-t border-border/60 pt-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span>{money(totals.subtotalCents, currency)}</span>
              </div>
              {totals.discountCents > 0 && (
                <div className="flex justify-between text-emerald-500">
                  <span>{totals.promoLabel ?? "Discount"}</span><span>−{money(totals.discountCents, currency)}</span>
                </div>
              )}
              {totals.memberDiscountCents > 0 && (
                <p className="text-xs text-muted-foreground">
                  Includes {money(totals.memberDiscountCents, currency)} of membership benefits.
                </p>
              )}
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span><span>{money(totals.totalCents, currency)}</span>
              </div>
            </div>

            <div className="grid gap-3 pt-1">
              <div className="grid gap-1.5">
                <Label htmlFor="buyer-name">Full name (for the licence)</Label>
                <Input id="buyer-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Jane Doe" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="buyer-email">Email (delivery)</Label>
                <Input id="buyer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} placeholder="you@email.com" />
              </div>
            </div>

            <DialogFooter>
              <Button
                className="w-full text-white hover:opacity-90"
                style={{ background: accent }}
                disabled={busy || !name.trim() || !email.trim()}
                onClick={checkout}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {totals.totalCents === 0
                  ? "Get these with my membership"
                  : `Pay with PayPal · ${money(totals.totalCents, currency)}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FreeDownloadDialog({
  product, onClose, accent,
}: { product: { id: string; title: string } | null; onClose: () => void; accent: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    if (!product) return;
    setBusy(true);
    try {
      const res = await claimFreeDownload({ data: { productId: product.id, email } });
      if (res.url) window.location.href = res.url;
      toast.success("Your tagged download is on its way.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Free tagged download</DialogTitle>
          <DialogDescription>
            {product?.title} — this version has a voice tag over it. Buy a licence for the clean file.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="free-email">Your email</Label>
          <Input id="free-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" maxLength={255} />
        </div>
        <DialogFooter>
          <Button className="w-full text-white hover:opacity-90" style={{ background: accent }} disabled={busy || !email.trim()} onClick={claim}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function MembershipCard({
  plan, member, currency, accent, onJoin, onManage, onSignOut,
}: {
  plan: MembershipPlan | null;
  member: { email: string; planName: string; renewsAt: string | null; state: MemberState } | null;
  currency: string;
  accent: string;
  onJoin: () => void;
  onManage: () => void;
  onSignOut: () => void;
}) {
  if (member) {
    const s = member.state;
    const remaining = s.mode === "all_access"
      ? "All-access — leases and downloads are on the house."
      : `${s.leasesRemaining} lease${s.leasesRemaining === 1 ? "" : "s"} and ${s.downloadsRemaining} download${s.downloadsRemaining === 1 ? "" : "s"} left this period${s.discountPercent > 0 ? `, then ${s.discountPercent}% off` : ""}.`;
    return (
      <div className="mt-8 rounded-xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" style={{ color: accent }} />
              {member.planName} member
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{remaining}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {member.email}
              {member.renewsAt ? ` · renews ${new Date(member.renewsAt).toLocaleDateString()}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onManage}>Manage</Button>
            <Button size="sm" variant="ghost" onClick={onSignOut}>Not you?</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!plan?.active) return null;

  return (
    <div className="mt-8 rounded-xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" style={{ color: accent }} />
            {plan.name} — {money(plan.price_cents, currency)}/{plan.interval === "year" ? "yr" : "mo"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{plan.description || planBlurb(plan)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Cancel any time. Exclusive licences are not included.</p>
        </div>
        <Button className="text-white hover:opacity-90" style={{ background: accent }} onClick={onJoin}>
          Become a member
        </Button>
      </div>
    </div>
  );
}

function JoinMembershipDialog({
  open, onOpenChange, handle, plan, currency, accent,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; handle: string;
  plan: MembershipPlan | null; currency: string; accent: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const res = await startMembership({ data: { handle, email } });
      window.location.href = res.checkoutUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the membership.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{plan?.name ?? "Membership"}</DialogTitle>
          <DialogDescription>
            {plan ? `${money(plan.price_cents, currency)} per ${plan.interval}. ${plan.description || planBlurb(plan)}` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="member-email">Your email</Label>
          <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" maxLength={255} />
          <p className="text-xs text-muted-foreground">
            Your benefits are linked to this browser after checkout, and to your email if you come back.
          </p>
        </div>
        <DialogFooter>
          <Button className="w-full text-white hover:opacity-90" style={{ background: accent }} disabled={busy || !email.trim()} onClick={join}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Subscribe with Stripe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
