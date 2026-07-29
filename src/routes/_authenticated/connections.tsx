import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Youtube, Instagram, Facebook, Loader2, CheckCircle2, Cloud, Radio, Megaphone, Store, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { getYoutubeAuthUrl, getYoutubeConnection, disconnectYoutube } from "@/lib/youtube.functions";
import { getMetaAuthUrl, getMetaConnectionInfo, disconnectMeta } from "@/lib/meta.functions";
import { getTiktokAuthUrl, getTiktokConnectionInfo, disconnectTiktok } from "@/lib/tiktok.functions";
import { getSoundcloudAuthUrl, getSoundcloudConnectionInfo, disconnectSoundcloud } from "@/lib/soundcloud.functions";
import { NotifyMeDialog } from "@/components/NotifyMeDialog";

export const Route = createFileRoute("/_authenticated/connections")({
  validateSearch: (s: Record<string, unknown>) => ({
    youtube: typeof s.youtube === "string" ? s.youtube : undefined,
    channel: typeof s.channel === "string" ? s.channel : undefined,
    reason: typeof s.reason === "string" ? s.reason : undefined,
    meta: typeof s.meta === "string" ? s.meta : undefined,
    tiktok: typeof s.tiktok === "string" ? s.tiktok : undefined,
    soundcloud: typeof s.soundcloud === "string" ? s.soundcloud : undefined,
    account: typeof s.account === "string" ? s.account : undefined,
  }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const search = useSearch({ from: "/_authenticated/connections" });
  const qc = useQueryClient();
  const [notify, setNotify] = useState<null | { platform: string; label: string; certifier: string }>(null);
  const [ytVerifyOpen, setYtVerifyOpen] = useState(false);

  useEffect(() => {
    if (search.youtube === "connected") {
      toast.success(`Connected ${search.channel ?? "your YouTube channel"}`);
    } else if (search.youtube === "error") {
      toast.error(`YouTube connection failed${search.reason ? `: ${search.reason}` : ""}`);
    }
    if (search.meta === "connected") {
      toast.success(`Connected ${search.account ?? "your Facebook / Instagram account"}`);
    } else if (search.meta === "error") {
      toast.error(`Meta connection failed${search.reason ? `: ${search.reason}` : ""}`);
    }
    if (search.tiktok === "connected") {
      toast.success(`Connected ${search.account ?? "your TikTok account"}`);
    } else if (search.tiktok === "error") {
      toast.error(`TikTok connection failed${search.reason ? `: ${search.reason}` : ""}`);
    }
    if (search.soundcloud === "connected") {
      toast.success(`Connected ${search.account ?? "your SoundCloud account"}`);
    } else if (search.soundcloud === "error") {
      toast.error(`SoundCloud connection failed${search.reason ? `: ${search.reason}` : ""}`);
    }
  }, [search.youtube, search.channel, search.reason, search.meta, search.tiktok, search.soundcloud, search.account]);

  const { data, isLoading } = useQuery({
    queryKey: ["youtube-connection"],
    queryFn: () => getYoutubeConnection(),
  });
  const { data: metaData } = useQuery({ queryKey: ["meta-connection"], queryFn: () => getMetaConnectionInfo() });
  const { data: ttData } = useQuery({ queryKey: ["tiktok-connection"], queryFn: () => getTiktokConnectionInfo() });
  const { data: scData } = useQuery({ queryKey: ["soundcloud-connection"], queryFn: () => getSoundcloudConnectionInfo() });

  const connect = useMutation({
    mutationFn: () => getYoutubeAuthUrl(),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectYoutube(),
    onSuccess: () => {
      toast.success("YouTube disconnected");
      qc.invalidateQueries({ queryKey: ["youtube-connection"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connectMeta = useMutation({
    mutationFn: () => getMetaAuthUrl(),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectMetaMut = useMutation({
    mutationFn: () => disconnectMeta(),
    onSuccess: () => { toast.success("Meta disconnected"); qc.invalidateQueries({ queryKey: ["meta-connection"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  // TikTok connect is gated behind a "coming soon" notify dialog while certification is pending.
  void getTiktokAuthUrl;
  const disconnectTtMut = useMutation({
    mutationFn: () => disconnectTiktok(),
    onSuccess: () => { toast.success("TikTok disconnected"); qc.invalidateQueries({ queryKey: ["tiktok-connection"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const connectSc = useMutation({
    mutationFn: () => getSoundcloudAuthUrl(),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnectScMut = useMutation({
    mutationFn: () => disconnectSoundcloud(),
    onSuccess: () => { toast.success("SoundCloud disconnected"); qc.invalidateQueries({ queryKey: ["soundcloud-connection"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const yt = data?.connection;
  const meta = metaData?.connection;
  const tt = ttData?.connection;
  const sc = scData?.connection;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--accent,#f59e0b)]">Connections</p>
      <h1 className="mt-2 font-display text-4xl">Where you publish</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your accounts once. We'll publish on your behalf when you approve a release.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {/* YouTube */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Youtube className="h-5 w-5 text-[#FF0033]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg">YouTube</h3>
              {yt && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Checking…</p>
            ) : yt ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Connected as <span className="text-foreground">{yt.channel_title}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setYtVerifyOpen(true)}
                  className="mt-1 flex items-center justify-start gap-1 text-[10px] text-[color:var(--accent,#f59e0b)] underline hover:text-foreground transition-colors text-left"
                >
                  <Info className="h-3 w-3 shrink-0" />
                  App Verification in Progress. You may still connect safely.
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  {disconnect.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Upload longform and shorts to your channel.</p>
                <button
                  type="button"
                  onClick={() => setYtVerifyOpen(true)}
                  className="mt-1 flex items-center justify-start gap-1 text-[10px] text-[color:var(--accent,#f59e0b)] underline hover:text-foreground transition-colors text-left"
                >
                  <Info className="h-3 w-3 shrink-0" />
                  App Verification in Progress. You may still connect safely.
                </button>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                >
                  {connect.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Connect YouTube
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Meta — Facebook + Instagram (one connection, two surfaces) */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Facebook className="h-5 w-5 text-[#1877F2]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg">Facebook & Instagram</h3>
              {meta && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </div>
            {meta ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Page: <span className="text-foreground">{meta.page_name ?? "—"}</span>
                  {meta.ig_username && <> · IG: <span className="text-foreground">@{meta.ig_username}</span></>}
                </p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => disconnectMetaMut.mutate()} disabled={disconnectMetaMut.isPending}>
                  {disconnectMetaMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Publish to a Facebook Page and Instagram Reels in one click.</p>
              <Button size="sm" className="mt-3" onClick={() => connectMeta.mutate()} disabled={connectMeta.isPending}>
                  {connectMeta.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Connect Facebook
                </Button>
              </>
            )}
          </div>
        </div>

        {/* TikTok */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <span className="font-display text-base">TT</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg">TikTok</h3>
              {tt && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </div>
            {tt ? (
              <>
                <p className="text-sm text-muted-foreground">Connected as <span className="text-foreground">{tt.display_name ?? "TikTok"}</span></p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => disconnectTtMut.mutate()} disabled={disconnectTtMut.isPending}>
                  {disconnectTtMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Drop shorts straight to your account.</p>
                <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                  Your TikTok account must be switched to a <span className="font-medium">Business account</span> (Settings → Account → Switch to Business).
                </p>
                <Button size="sm" className="mt-3" onClick={() => setNotify({ platform: "tiktok", label: "TikTok", certifier: "TikTok" })}>
                  Connect TikTok
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Instagram info card — actually managed through Meta connection */}
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-card/30 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Instagram className="h-5 w-5 text-[#E1306C]" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg">Instagram</h3>
            <p className="text-sm text-muted-foreground">
              Connected via the Facebook integration above. Your IG Business account must be linked to your Page.
            </p>
          </div>
        </div>

        {/* SoundCloud — placeholder card, coming soon */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Cloud className="h-5 w-5 text-[#ff5500]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg">SoundCloud</h3>
              {sc && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              <HoverCard openDelay={100}>
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className="cursor-help rounded-full border border-[#ff5500]/40 bg-[#ff5500]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[#ff8a3d]"
                  >
                    + DISTRIBUTION
                  </button>
                </HoverCardTrigger>
                <HoverCardContent side="top" className="w-72 text-xs leading-relaxed">
                  Distribute unlimited music to all DSP music stores and keep
                  100% royalties for $15.99/mo. Go <span className="font-semibold text-foreground">"Artist Pro"</span> and choose <span className="font-semibold text-foreground">Monthly</span> at checkout.
                </HoverCardContent>
              </HoverCard>
            </div>
            {sc ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Connected as <span className="text-foreground">{sc.display_name ?? sc.username ?? "SoundCloud"}</span>
                </p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => disconnectScMut.mutate()} disabled={disconnectScMut.isPending}>
                  {disconnectScMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Distribute your release to SoundCloud directly from Release Engine.</p>
                <Button size="sm" className="mt-3" onClick={() => connectSc.mutate()} disabled={connectSc.isPending}>
                  {connectSc.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Connect SoundCloud
                </Button>
              </>
            )}
          </div>
        </div>

        {/* My Music Store — live: links to the storefront setup page */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/40 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Store className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg">My Music Store</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Sell your music directly to fans — albums, singles, leases, exclusives, merch and more.
            </p>
            <Button size="sm" variant="outline" className="mt-3" asChild>
              <Link to="/store">Set up my store</Link>
            </Button>
          </div>
        </div>
      </div>

      <NotifyMeDialog
        open={!!notify}
        onOpenChange={(o) => { if (!o) setNotify(null); }}
        platform={notify?.platform ?? ""}
        platformLabel={notify?.label ?? ""}
        certifierLabel={notify?.certifier ?? ""}
      />

      <Dialog open={ytVerifyOpen} onOpenChange={setYtVerifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>YouTube App Verification</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            Google verification is currently in progress.
            <br /><br />
            During this review, Google may display a warning that our app hasn&apos;t been verified yet. This is expected while Google completes its review.
            <br /><br />
            If you&apos;d like to use the app now, you can continue by selecting <span className="font-medium text-foreground">Advanced → Go to Release Engine (unsafe)</span> on the Google screen. This warning is about Google&apos;s review status—not a known security issue with your account or this app.
            <br /><br />
            If you&apos;d rather wait, we&apos;ll notify you as soon as verification is complete. Release Engine simply posts your videos to your account but requires your permission.
          </DialogDescription>
        </DialogContent>
      </Dialog>

      {/* Coming soon — future Release Engine surfaces */}
      <div className="mt-10">
        <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--accent,#f59e0b)]">Coming soon</p>
        <h2 className="mt-2 font-display text-2xl">More ways to release</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* Direct Distribution */}
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-5">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
              <Radio className="h-5 w-5 text-[color:var(--accent,#f59e0b)]" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg">Direct Distribution</h3>
                <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Distribute directly to every major music store through Release Engine.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setNotify({ platform: "direct_distribution", label: "Direct Distribution", certifier: "Release Engine" })}>
                Notify me
              </Button>
            </div>
          </div>

          {/* Run Ads */}
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-5">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
              <Megaphone className="h-5 w-5 text-[#4285F4]" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg">Run Ads</h3>
                <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Run ads using your analysis straight into Google Ads to run YouTube and Search ads.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setNotify({ platform: "run_ads", label: "Run Ads", certifier: "Google Ads" })}>
                Notify me
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}