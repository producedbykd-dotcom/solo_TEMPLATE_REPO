import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyStore, saveStore, startStoreUpload, listSellableReleases, addProduct,
  updateProduct, deleteProduct, saveTier, deleteTier, savePromotion, listStoreOrders,
  generateVoiceTag, saveVoiceTag, getMyVoiceTag, getProductAudio, reorderProducts, saveStripeKeys, saveMembershipPlan,
  saveLicenseTemplate, deleteLicenseTemplate, exportFreeDownloadEmails, listIssuedLicenses,
  listTagVoices, TAG_PRESETS,
} from "@/lib/store.functions";
import { NEUTRAL_FX, type TagFxSettings } from "@/lib/store/tag-fx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ExternalLink, Loader2, Plus, Trash2, Upload, Wand2, Copy, ArrowUp, ArrowDown } from "lucide-react";
import { money, TIER_LABEL, TIER_KINDS, tierLabel, promoHeadline, type PromoConfig, type TierKind } from "@/lib/store/pricing";
import { planBlurb, type MembershipPlan } from "@/lib/store/membership";
import { buildTaggedMp3, base64ToBytes } from "@/lib/store/tagged-download";
import { supabase } from "@/integrations/supabase/client";

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}

function parseAccent(value: string) {
  const v = (value || "#7c3aed").trim().toLowerCase();
  if (v.startsWith("rgba(")) {
    const parts = v.replace("rgba(", "").replace(")", "").split(",").map((s) => parseFloat(s.trim()));
    const [r, g, b, a] = parts;
    return { hex: rgbToHex(r || 0, g || 0, b || 0), opacity: Number.isFinite(a) ? Math.round(a * 100) : 100 };
  }
  if (v.startsWith("rgb(")) {
    const parts = v.replace("rgb(", "").replace(")", "").split(",").map((s) => parseFloat(s.trim()));
    return { hex: rgbToHex(parts[0] || 0, parts[1] || 0, parts[2] || 0), opacity: 100 };
  }
  return { hex: v.startsWith("#") ? v : "#7c3aed", opacity: 100 };
}

function formatAccent(hex: string, opacity: number) {
  if (opacity >= 100) return hex;
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}


export const Route = createFileRoute("/_authenticated/store")({
  head: () => ({
    meta: [
      { title: "My Store — Release Engine" },
      { name: "description", content: "Set up your artist storefront, list singles, albums and beat leases, and take PayPal payments." },
      { property: "og:title", content: "My Store — Release Engine" },
      { property: "og:description", content: "Sell singles, albums and beat licences straight from your catalog." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StoreAdmin,
});

async function uploadToStore(file: File, kind: "logo" | "artwork" | "free" | "tag") {
  const { token, storagePath } = await startStoreUpload({
    data: { kind, fileName: file.name, contentType: file.type || "application/octet-stream" },
  });
  const { error } = await supabase.storage.from("store").uploadToSignedUrl(storagePath, token, file);
  if (error) throw new Error(error.message);
  return storagePath;
}

function StoreAdmin() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["my-store"], queryFn: () => getMyStore() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-store"] });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Store</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A public page where fans buy your singles, albums and beat licences. Money goes straight to your PayPal.
        </p>
      </header>

      {data?.storeUrl && data.store?.published && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm">
          <span className="text-muted-foreground">Live at</span>
          <code className="rounded bg-muted px-2 py-0.5">{data.storeUrl}</code>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(data.storeUrl!); toast.success("Link copied"); }}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />Copy
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={data.storeUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open</a>
          </Button>
        </div>
      )}

      <Tabs defaultValue="setup">
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="promo">Sales</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-5">
          <SetupPanel store={data?.store ?? null} onSaved={refresh} />
        </TabsContent>
        <TabsContent value="products" className="mt-5">
          {data?.store ? <ProductsPanel products={data.products} onChanged={refresh} /> : <NeedStore />}
        </TabsContent>
        <TabsContent value="promo" className="mt-5">
          {data?.store
            ? <PromoPanel promo={data.promo} products={(data.products ?? []) as Record<string, any>[]} onSaved={refresh} />
            : <NeedStore />}
        </TabsContent>
        <TabsContent value="members" className="mt-5">
          {data?.store ? (
            <MembersPanel
              storeId={data.store.id}
              plan={(data as any).membership ?? null}
              stripe={(data as any).stripe ?? { hasSecret: false, hasWebhook: false }}
              subscribers={(data as any).subscribers ?? []}
              currency={data.store.currency ?? "USD"}
              onSaved={refresh}
            />
          ) : <NeedStore />}
        </TabsContent>
        <TabsContent value="orders" className="mt-5">
          {data?.store ? <OrdersPanel /> : <NeedStore />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const NeedStore = () => (
  <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
    Finish the Setup tab first — your store needs a name and handle.
  </p>
);

function SetupPanel({ store, onSaved }: { store: Record<string, any> | null; onSaved: () => void }) {
  const [handle, setHandle] = useState(store?.handle ?? "");
  const [name, setName] = useState(store?.display_name ?? "");
  const [headline, setHeadline] = useState(store?.headline ?? "");
  const [bio, setBio] = useState(store?.bio ?? "");
  const initialAccent = useMemo(() => parseAccent(store?.accent ?? "#7c3aed"), [store?.accent]);
  const [accentHex, setAccentHex] = useState(initialAccent.hex);
  const [accentOpacity, setAccentOpacity] = useState(initialAccent.opacity);
  const accent = useMemo(() => formatAccent(accentHex, accentOpacity), [accentHex, accentOpacity]);
  const [paypal, setPaypal] = useState(store?.paypal_email ?? "");
  const [theme, setTheme] = useState<"dark" | "light">(store?.theme === "light" ? "light" : "dark");
  const [previewMode, setPreviewMode] = useState<"clip" | "tagged">(store?.preview_mode === "tagged" ? "tagged" : "clip");
  const [published, setPublished] = useState(!!store?.published);
  const [logoPath, setLogoPath] = useState<string | null>(store?.logo_path ?? null);
  const [logoUrl, setLogoUrl] = useState<string | null>(store?.logoUrl ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = parseAccent(store?.accent ?? "#7c3aed");
    setAccentHex(next.hex);
    setAccentOpacity(next.opacity);
  }, [store?.accent]);


  const save = async () => {
    setBusy(true);
    try {
      await saveStore({ data: { handle, display_name: name, headline, bio, accent, paypal_email: paypal, published, logo_path: logoPath, theme, preview_mode: previewMode } });
      toast.success("Store saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your store.");
    } finally {
      setBusy(false);
    }
  };

  const onLogo = async (file?: File) => {
    if (!file) return;
    try {
      const path = await uploadToStore(file, "logo");
      setLogoPath(path);
      setLogoUrl(URL.createObjectURL(file));
      toast.success("Logo uploaded — save to apply.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  return (
    <div className="space-y-5 rounded-lg border border-border/60 bg-card p-5">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
          {logoUrl ? <img src={logoUrl} alt="Store logo" className="h-full w-full object-cover" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div>
          <Label htmlFor="logo" className="text-sm">Store logo</Label>
          <Input id="logo" type="file" accept="image/*" className="mt-1.5 max-w-xs" onChange={(e) => onLogo(e.target.files?.[0])} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Store name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="KD Beats" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="handle">Store link</Label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">/store/</span>
            <Input id="handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={32} placeholder="kdbeats" />
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="headline">Page headline (optional)</Label>
        <Input
          id="headline"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={120}
          placeholder="Beats, singles and exclusive licences"
        />
        <p className="text-xs text-muted-foreground">
          Shown big across the top of your store page. Your store name and logo stay in the top bar. Leave it blank for no headline.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bio">Short bio</Label>
        <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={3} placeholder="Producer from Atlanta. Soul-sampled beats and original singles." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="paypal">PayPal email (where you get paid)</Label>
          <Input id="paypal" type="email" value={paypal} onChange={(e) => setPaypal(e.target.value)} maxLength={255} placeholder="you@email.com" />
          <p className="text-xs text-muted-foreground">Only your email is needed — no API keys. Buyers pay you directly.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="accent">Accent colour</Label>
          <div className="flex items-center gap-3">
            <Input id="accent" type="color" value={accentHex} onChange={(e) => setAccentHex(e.target.value)} className="h-10 w-20 p-1" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Opacity</span>
                <span>{accentOpacity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={accentOpacity}
                onChange={(e) => setAccentOpacity(parseInt(e.target.value, 10))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--accent,currentColor)]"
              />
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-6 w-6 rounded border border-border/60" style={{ background: accent }} />
            <p className="text-[11px] text-muted-foreground font-mono truncate">{accent}</p>
          </div>
        </div>

      </div>

      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Store appearance</p>
          <p className="text-xs text-muted-foreground">The look your page opens with. Visitors can still switch it themselves.</p>
        </div>
        <Select value={theme} onValueChange={(v) => setTheme(v as "dark" | "light")}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Preview style (whole store)</p>
          <p className="text-xs text-muted-foreground">
            45-second clip, or the full voice-tagged version. You can override this per track.
          </p>
        </div>
        <Select value={previewMode} onValueChange={(v) => setPreviewMode(v as "clip" | "tagged")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="clip">45-second clip</SelectItem>
            <SelectItem value="tagged">Full tagged version</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <VoiceTagPanel store={store} />

      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Publish store</p>
          <p className="text-xs text-muted-foreground">Makes your page visible to anyone with the link.</p>
        </div>
        <Switch checked={published} onCheckedChange={setPublished} />
      </div>

      <Button onClick={save} disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save store
      </Button>
    </div>
  );
}

const PRESET_ORDER: Array<{ key: string; label: string; hint: string }> = [
  { key: "trap_hype", label: "Trap Hype MC", hint: "Shouted ad-lib energy" },
  { key: "street_gritty", label: "Street Gritty", hint: "Raspy, hard-hitting" },
  { key: "rnb_smooth", label: "R&B Smooth", hint: "Warm and half-sung" },
  { key: "soul_warm", label: "Soul Warm", hint: "Rich, vinyl-era" },
  { key: "edm_announcer", label: "EDM Announcer", hint: "Big festival voice" },
  { key: "deep_cinematic", label: "Deep Cinematic", hint: "Trailer-deep" },
  { key: "whisper_ghost", label: "Whisper / Ghost", hint: "Airy and close" },
  { key: "female_hype", label: "Female Hype", hint: "Bright with attitude" },
  { key: "female_sultry", label: "Female Sultry", hint: "Slow and breathy" },
];

function VoiceTagPanel({ store }: { store: Record<string, any> | null }) {
  const [phrase, setPhrase] = useState(store?.tag_phrase ?? "Purchase this track");
  const [preset, setPreset] = useState<string>(
    store?.tag_preset ?? (store?.tag_style && store.tag_style in TAG_PRESETS ? store.tag_style : "trap_hype"),
  );
  const [gender, setGender] = useState(store?.tag_gender ?? "neutral");
  const [note, setNote] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [voiceId, setVoiceId] = useState<string>("");
  const [stability, setStability] = useState<number | null>(null);
  const [styleAmt, setStyleAmt] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [fx, setFx] = useState<TagFxSettings>(
    (store?.tag_fx as TagFxSettings | null) ?? (TAG_PRESETS as any)[preset]?.fx ?? NEUTRAL_FX,
  );
  const [busy, setBusy] = useState(false);
  const [rawBase64, setRawBase64] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; base64: string; voice: string } | null>(null);
  const [saved, setSaved] = useState(!!store?.tag_audio_path);

  const voices = useQuery({
    queryKey: ["tag-voices"],
    queryFn: () => listTagVoices(),
    enabled: advanced,
    staleTime: 60 * 60 * 1000,
  });

  const choosePreset = (key: string) => {
    setPreset(key);
    const p = (TAG_PRESETS as any)[key];
    if (p?.fx) setFx(p.fx as TagFxSettings);
    setVoiceId("");
    setStability(null); setStyleAmt(null); setSpeed(null);
  };

  const render = async (base64: string, settings: TagFxSettings, voice: string) => {
    const { applyTagFx } = await import("@/lib/store/tag-fx");
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = await applyTagFx(bytes.buffer, settings);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let out = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      out += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    const b64 = btoa(out);
    const url = `data:audio/mpeg;base64,${b64}`;
    setPreview({ url, base64: b64, voice });
    void new Audio(url).play().catch(() => {});
  };

  const generate = async () => {
    setBusy(true);
    try {
      const r = await generateVoiceTag({
        data: {
          phrase, preset, gender, note,
          voiceId: voiceId || undefined,
          stability: stability ?? undefined,
          style: styleAmt ?? undefined,
          speed: speed ?? undefined,
        },
      });
      setRawBase64(r.base64);
      await render(r.base64, fx, r.voice);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate that tag.");
    } finally {
      setBusy(false);
    }
  };

  const reRender = async () => {
    if (!rawBase64) return;
    setBusy(true);
    try {
      await render(rawBase64, fx, preview?.voice ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply those effects.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await saveVoiceTag({
        data: {
          base64: preview.base64, phrase, style: preset, gender,
          voice: preview.voice, note, preset, fx,
        },
      });
      setSaved(true);
      toast.success("Producer tag saved — it'll be used on tagged versions.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that tag.");
    } finally {
      setBusy(false);
    }
  };

  const fxRow = (
    label: string, key: keyof TagFxSettings, min: number, max: number, step: number,
  ) => (
    <div key={key as string} className="grid gap-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{Number(fx[key] as number).toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[Number(fx[key] as number)]}
        onValueChange={([v]) => setFx({ ...fx, [key]: v })}
      />
    </div>
  );

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <div>
        <p className="text-sm font-medium">AI producer tag</p>
        <p className="text-xs text-muted-foreground">
          Write what the tag should say, pick a voice, then shape it with the tag effects. Saved tags are overlaid on tagged versions.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="tag-phrase">What it says</Label>
        <Input id="tag-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={120} placeholder="KD on the beat" />
      </div>

      <div className="grid gap-1.5">
        <Label>Voice preset</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRESET_ORDER.map((p) => (
            <button
              key={p.key} type="button" onClick={() => choosePreset(p.key)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                preset === p.key
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10"
                  : "border-border hover:border-[color:var(--accent)]/60"
              }`}
            >
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="tag-note">Extra direction (optional)</Label>
        <Input id="tag-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Slow it down, big pause before the last word" />
      </div>

      <div className="rounded-md border border-border/60">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
        >
          Advanced voice &amp; effects
          <span className="text-xs text-muted-foreground">{advanced ? "Hide" : "Show"}</span>
        </button>
        {advanced && (
          <div className="space-y-4 border-t border-border/60 p-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Voice</Label>
                <Select value={voiceId || "preset"} onValueChange={(v) => setVoiceId(v === "preset" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preset">Preset voice</SelectItem>
                    {((voices.data?.voices ?? []) as Array<{ id: string; name: string }>).map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {voices.data && !voices.data.available && (
                  <p className="text-xs text-muted-foreground">
                    Premium voice library unavailable right now — the built-in voice is used instead.
                  </p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label>Voice type (built-in fallback)</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="neutral">No preference</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span>Consistency</span>
                  <span className="text-muted-foreground">{(stability ?? (TAG_PRESETS as any)[preset].settings.stability).toFixed(2)}</span>
                </div>
                <Slider min={0} max={1} step={0.05}
                  value={[stability ?? (TAG_PRESETS as any)[preset].settings.stability]}
                  onValueChange={([v]) => setStability(v)} />
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span>Expression</span>
                  <span className="text-muted-foreground">{(styleAmt ?? (TAG_PRESETS as any)[preset].settings.style).toFixed(2)}</span>
                </div>
                <Slider min={0} max={1} step={0.05}
                  value={[styleAmt ?? (TAG_PRESETS as any)[preset].settings.style]}
                  onValueChange={([v]) => setStyleAmt(v)} />
              </div>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span>Speed</span>
                  <span className="text-muted-foreground">{(speed ?? (TAG_PRESETS as any)[preset].settings.speed).toFixed(2)}</span>
                </div>
                <Slider min={0.7} max={1.2} step={0.01}
                  value={[speed ?? (TAG_PRESETS as any)[preset].settings.speed]}
                  onValueChange={([v]) => setSpeed(v)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {fxRow("Pitch (semitones)", "pitch", -12, 12, 1)}
              {fxRow("Doubling", "double", 0, 1, 0.05)}
              {fxRow("Slap delay", "slap", 0, 1, 0.05)}
              {fxRow("Tail / reverb", "reverb", 0, 1, 0.05)}
              {fxRow("Drive", "drive", 0, 1, 0.05)}
              {fxRow("Output level", "gain", 0.2, 2, 0.05)}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={fx.phone} onCheckedChange={(v) => setFx({ ...fx, phone: v })} />
                Telephone band
              </label>
              <Button size="sm" variant="ghost" disabled={busy || !rawBase64} onClick={reRender}>
                Re-apply effects
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={generate}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
          Generate tag
        </Button>
        {preview && (
          <>
            <audio src={preview.url} controls className="h-8" />
            <Button size="sm" disabled={busy} onClick={save}>Use this tag</Button>
          </>
        )}
        {saved && !preview && <span className="text-xs text-muted-foreground">A saved tag is in use.</span>}
      </div>
    </div>
  );
}

function ProductsPanel({ products, onChanged }: { products: Record<string, any>[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [order, setOrder] = useState<Record<string, any>[]>(products);
  const [saving, setSaving] = useState(false);

  useEffect(() => setOrder(products), [products]);

  const move = async (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= order.length) return;
    const reordered = [...order];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    setOrder(reordered);
    setSaving(true);
    try {
      await reorderProducts({ data: { orderedIds: reordered.map((p) => p.id) } });
      onChanged();
    } catch (e) {
      setOrder(products);
      toast.error(e instanceof Error ? e.message : "Could not save the new order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">
          {order.length} item{order.length === 1 ? "" : "s"} listed
          {saving && <span className="ml-2 text-xs">saving order…</span>}
        </p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" />Add item</Button>
      </div>
      <SavedLicensesPanel />
      {order.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Nothing listed yet. Add a release from your catalog to start selling.
        </p>
      )}
      {order.map((p, i) => (
        <div key={p.id} className="flex items-start gap-2">
          <div className="flex flex-col gap-1 pt-4">
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              aria-label={`Move ${p.title} up`}
              disabled={i === 0 || saving}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              aria-label={`Move ${p.title} down`}
              disabled={i === order.length - 1 || saving}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-w-0 flex-1">
            <ProductCard product={p} onChanged={onChanged} />
          </div>
        </div>
      ))}
      <AddProductDialog open={adding} onOpenChange={setAdding} onAdded={onChanged} />
    </div>
  );
}

function ProductCard({ product, onChanged }: { product: Record<string, any>; onChanged: () => void }) {
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description ?? "");
  const [active, setActive] = useState(!!product.active);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagPct, setTagPct] = useState(0);
  const [tagFile, setTagFile] = useState<File | null>(null);
  const [previewMode, setPreviewMode] = useState<string>(product.preview_mode ?? "inherit");

  const save = async () => {
    await updateProduct({
      data: {
        productId: product.id,
        patch: { title, description, active, preview_mode: previewMode === "inherit" ? null : previewMode },
      },
    });
    toast.success("Saved");
    onChanged();
  };

  const makeTagged = async () => {
    setTagBusy(true);
    setTagPct(2);
    try {
      const resolveTag = async (): Promise<ArrayBuffer> => {
        if (tagFile) return tagFile.arrayBuffer();
        const saved = await getMyVoiceTag();
        if (saved.base64) return base64ToBytes(saved.base64);
        const r = await generateVoiceTag({ data: { phrase: "Purchase this track" } });
        return base64ToBytes(r.base64);
      };
      const [tagBytes, master] = await Promise.all([
        resolveTag(),
        getProductAudio({ data: { productId: product.id } }),
      ]);
      const blob = await buildTaggedMp3({
        masterBytes: base64ToBytes(master.base64),
        tagBytes,
        intervalSec: 25,
        onProgress: setTagPct,
      });
      const file = new File([blob], `${product.id}-tagged.mp3`, { type: "audio/mpeg" });
      const path = await uploadToStore(file, "free");
      await updateProduct({ data: { productId: product.id, patch: { free_download_path: path, free_download_enabled: true } } });
      toast.success("Tagged free download is live");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the tagged version.");
    } finally {
      setTagBusy(false);
      setTagPct(0);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-start gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {product.artworkUrl && <img src={product.artworkUrl} alt={`${product.title} artwork`} className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={600} placeholder="Short description shown on your store page" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="secondary" className="uppercase">{product.kind}</Badge>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Live</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>
      </div>

      <TierEditor productId={product.id} tiers={product.tiers ?? []} onChanged={onChanged} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="outline" disabled={tagBusy} onClick={makeTagged}>
          {tagBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
          {product.free_download_path ? "Rebuild tagged free download" : "Create tagged free download"}
        </Button>
        <Button
          size="sm" variant="ghost" className="text-destructive"
          onClick={async () => {
            if (!confirm(`Remove "${product.title}" from your store?`)) return;
            await deleteProduct({ data: { productId: product.id } });
            toast.success("Removed");
            onChanged();
          }}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />Remove
        </Button>
      </div>

      <div className="grid gap-1.5 rounded-md border border-border/60 p-3">
        <Label htmlFor={`tag-${product.id}`} className="text-xs">Your own voice tag (optional)</Label>
        <Input
          id={`tag-${product.id}`}
          type="file"
          accept="audio/*"
          className="max-w-xs"
          onChange={(e) => setTagFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-[11px] text-muted-foreground">
          {tagFile
            ? `Using "${tagFile.name}" — click Create/Rebuild tagged free download to apply.`
            : "Upload a short MP3/WAV tag to overlay every 25 seconds. Leave empty to use your saved AI producer tag."}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-3">
        <div>
          <p className="text-xs font-medium">Preview style for this track</p>
          <p className="text-[11px] text-muted-foreground">Full tagged needs a tagged version built first.</p>
        </div>
        <Select value={previewMode} onValueChange={setPreviewMode}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Use store default</SelectItem>
            <SelectItem value="clip">45-second clip</SelectItem>
            <SelectItem value="tagged">Full tagged version</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tagBusy && <Progress value={tagPct} className="h-1.5" />}
    </div>
  );
}

const TIER_OPTIONS: TierKind[] = TIER_KINDS;

function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function TierEditor({ productId, tiers, onChanged }: { productId: string; tiers: Record<string, any>[]; onChanged: () => void }) {
  return (
    <div className="space-y-2">
      {tiers.map((t) => <TierRow key={t.id} productId={productId} tier={t} onChanged={onChanged} />)}
      <Button
        size="sm" variant="ghost"
        onClick={async () => {
          await saveTier({ data: { productId, kind: "non_exclusive", price_cents: 3500, stream_limit: 100000, distribution_limit: 5000, video_limit: 1, term_months: 24 } });
          onChanged();
        }}
      >
        <Plus className="mr-1.5 h-4 w-4" />Add price / licence
      </Button>
      <Button
        size="sm" variant="ghost"
        onClick={async () => {
          try {
            await saveTier({
              data: {
                productId, kind: "custom", price_cents: 9900,
                custom_label: "Custom licence",
                license_text:
                  "1. GRANT. {{producer_name}} grants {{buyer_name}} ({{buyer_email}}) a licence to use the recording \"{{track_title}}\" on the terms below.\n\n" +
                  "2. TERM. This licence begins on {{date}} and continues until terminated in writing.\n\n" +
                  "3. USE. Describe exactly what the buyer may do with the track here.\n\n" +
                  "4. CREDIT. The buyer must credit {{producer_name}} wherever the track appears.\n\n" +
                  "5. CONSIDERATION. {{price}} paid under order {{order_id}}.",
              },
            });
            onChanged();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not add the custom licence");
          }
        }}
      >
        <Plus className="mr-1.5 h-4 w-4" />Add custom licence
      </Button>
    </div>
  );
}

/** Reusable licence language the seller can drop onto any track. */
function SavedLicensesPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["my-store"], queryFn: () => getMyStore() });
  const templates = (data?.licenseTemplates ?? []) as Record<string, any>[];
  if (templates.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 p-4">
      <p className="text-sm font-semibold">Your saved licences ({templates.length})</p>
      <p className="mb-3 text-xs text-muted-foreground">Pick any of these when you add a custom licence to a track.</p>
      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2 text-sm">
            <span className="truncate">{t.name}</span>
            <Button
              size="sm" variant="ghost" className="text-destructive"
              onClick={async () => {
                await deleteLicenseTemplate({ data: { templateId: t.id } });
                qc.invalidateQueries({ queryKey: ["my-store"] });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholders the licence PDF fills in per sale. */
const LICENCE_TAGS: { label: string; tag: string }[] = [
  { label: "Buyer name", tag: "{{buyer_name}}" },
  { label: "Buyer email", tag: "{{buyer_email}}" },
  { label: "Producer name", tag: "{{producer_name}}" },
  { label: "Track title", tag: "{{track_title}}" },
  { label: "Price", tag: "{{price}}" },
  { label: "Date", tag: "{{date}}" },
  { label: "Order ID", tag: "{{order_id}}" },
];

function TierRow({ productId, tier, onChanged }: { productId: string; tier: Record<string, any>; onChanged: () => void }) {
  const [kind, setKind] = useState<TierKind>(tier.kind);
  const [price, setPrice] = useState(((tier.price_cents ?? 0) / 100).toFixed(2));
  const [streams, setStreams] = useState(tier.stream_limit ?? "");
  const [dist, setDist] = useState(tier.distribution_limit ?? "");
  const [videos, setVideos] = useState(tier.video_limit ?? "");
  const [months, setMonths] = useState(tier.term_months ?? "");
  const [customLabel, setCustomLabel] = useState<string>(tier.custom_label ?? "");
  const [licenseText, setLicenseText] = useState<string>(tier.license_text ?? "");
  const licenseRef = useRef<HTMLTextAreaElement | null>(null);

  /** Drops a placeholder in at the cursor (or at the end if the box was never focused). */
  const insertTag = (tag: string) => {
    const el = licenseRef.current;
    const text = licenseText ?? "";
    const start = el ? el.selectionStart ?? text.length : text.length;
    const end = el ? el.selectionEnd ?? start : start;
    const next = text.slice(0, start) + tag + text.slice(end);
    setLicenseText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    });
  };
  const isLease = kind === "non_exclusive" || kind === "exclusive";
  const isCustom = kind === "custom";
  const { data: storeData } = useQuery({ queryKey: ["my-store"], queryFn: () => getMyStore() });
  const templates = (storeData?.licenseTemplates ?? []) as Record<string, any>[];
  const num = (v: string | number) => (String(v).trim() === "" ? null : Math.max(0, Math.round(Number(v))));

  const save = async () => {
    try {
      await saveTier({
        data: {
          tierId: tier.id, productId, kind,
          price_cents: Math.round(parseFloat(price || "0") * 100),
          stream_limit: num(streams), distribution_limit: num(dist),
          video_limit: num(videos), term_months: num(months),
          custom_label: customLabel, license_text: licenseText,
        },
      });
      toast.success("Price saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div className="rounded-md border border-border/50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label className="text-xs">Type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as TierKind)}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIER_OPTIONS.map((k) => <SelectItem key={k} value={k}>{TIER_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Price (USD)</Label>
          <Input className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </div>
        {isLease && (
          <>
            <NumField label="Streams" value={streams} onChange={setStreams} />
            <NumField label="Downloads" value={dist} onChange={setDist} />
            <NumField label="Videos" value={videos} onChange={setVideos} />
            <NumField label="Term (months)" value={months} onChange={setMonths} />
          </>
        )}
        <Button size="sm" onClick={save}>Save</Button>
        <Button
          size="sm" variant="ghost" className="text-destructive"
          onClick={async () => { await deleteTier({ data: { tierId: tier.id } }); onChanged(); }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {isLease && <p className="mt-2 text-xs text-muted-foreground">Leave a limit blank for unlimited. These exact numbers print on the buyer's licence PDF.</p>}

      {isCustom && (
        <div className="mt-3 space-y-3 rounded-md border border-border/50 bg-muted/20 p-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Licence name (buyers see this)</Label>
            <Input
              className="h-9 max-w-xs"
              value={customLabel}
              maxLength={120}
              placeholder="Sync licence"
              onChange={(e) => setCustomLabel(e.target.value)}
            />
          </div>

          {templates.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Start from a saved licence</Label>
              <Select
                value=""
                onValueChange={(id) => {
                  const t = templates.find((x) => x.id === id);
                  if (!t) return;
                  setLicenseText(t.body ?? "");
                  if (!customLabel.trim()) setCustomLabel(t.name ?? "");
                }}
              >
                <SelectTrigger className="h-9 max-w-xs"><SelectValue placeholder="Pick a saved licence" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs">Licence language (paste it here)</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Click to insert at your cursor:</span>
              {LICENCE_TAGS.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  title={`Inserts ${t.tag}`}
                  onClick={() => insertTag(t.tag)}
                  className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] text-foreground transition-colors hover:border-[color:var(--accent)] hover:bg-[color:var(--accent)]/10"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Textarea
              ref={licenseRef}
              value={licenseText}
              onChange={(e) => setLicenseText(e.target.value)}
              rows={8}
              placeholder={"Paste your full licence wording. Use the buttons above to drop in details that get filled in on every sale."}
            />
            <p className="text-[11px] text-muted-foreground">
              This exact text prints on the buyer's PDF and is stored with the sale, so every licence you issue stays on record.
            </p>
          </div>

          <Button
            size="sm" variant="outline"
            onClick={async () => {
              try {
                await saveLicenseTemplate({ data: { name: customLabel || "Custom licence", body: licenseText } });
                toast.success("Saved to your reusable licences");
                onChanged();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save the licence");
              }
            }}
          >
            Save as reusable licence
          </Button>
        </div>
      )}
      {tier.sold_out && <Badge variant="destructive" className="mt-2">Exclusive sold</Badge>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string | number; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-9 w-28" value={value ?? ""} onChange={(e) => onChange(e.target.value)} inputMode="numeric" placeholder="∞" />
    </div>
  );
}

function AddProductDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void }) {
  const { data } = useQuery({ queryKey: ["sellable-releases"], queryFn: () => listSellableReleases(), enabled: open });
  const [projectId, setProjectId] = useState<string>("");
  const [kind, setKind] = useState<"single" | "album" | "beat">("single");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const releases = (data?.releases ?? []) as Record<string, any>[];
  useEffect(() => {
    const r = releases.find((x) => x.id === projectId);
    if (r && !title) setTitle(r.title);
  }, [projectId, releases, title]);

  const add = async () => {
    setBusy(true);
    try {
      await addProduct({ data: { projectId: projectId || null, kind, title: title.trim() } });
      toast.success("Added to your store");
      onAdded();
      onOpenChange(false);
      setProjectId(""); setTitle("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the item.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an item</DialogTitle>
          <DialogDescription>Pick a release from your catalog so the audio and artwork carry over.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Release</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); const r = releases.find((x) => x.id === v); if (r) setTitle(r.title); }}>
              <SelectTrigger><SelectValue placeholder="Choose from your catalog" /></SelectTrigger>
              <SelectContent>
                {releases.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Selling as</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="album">Album / EP</SelectItem>
                <SelectItem value="beat">Beat (leases)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-title">Title</Label>
            <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={add} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add to store
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromoPanel({ promo, products, onSaved }: {
  promo: Record<string, any> | null;
  products: Record<string, any>[];
  onSaved: () => void;
}) {
  const [type, setType] = useState<"percent" | "bogo">(promo?.type ?? "percent");
  const [percent, setPercent] = useState(String(promo?.percent ?? 25));
  const [buy, setBuy] = useState(String(promo?.bogo_buy ?? 2));
  const [free, setFree] = useState(String(promo?.bogo_free ?? 1));
  const [scope, setScope] = useState<"all" | "leases">(promo?.scope ?? "all");
  const [excl, setExcl] = useState(promo?.exclude_exclusive ?? true);
  const [headline, setHeadline] = useState(promo?.headline ?? "");
  const [active, setActive] = useState(!!promo?.active);
  const [busy, setBusy] = useState(false);
  const [kinds, setKinds] = useState<string[]>(
    (promo?.scope_kinds as string[] | null) ?? ["single", "album", "non_exclusive", "custom"],
  );
  const [tierIds, setTierIds] = useState<string[]>((promo?.scope_tier_ids as string[] | null) ?? []);

  const customTiers = useMemo(
    () => products.flatMap((p) =>
      ((p.tiers ?? []) as Record<string, any>[])
        .filter((t) => t.kind === "custom")
        .map((t) => ({ id: t.id as string, label: `${p.title} — ${tierLabel("custom", t.custom_label)}` })),
    ),
    [products],
  );

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const preview = useMemo(
    () => promoHeadline({
      type, percent: Number(percent) || 0, bogo_buy: Number(buy) || 1, bogo_free: Number(free) || 1,
      scope, exclude_exclusive: excl, scope_kinds: kinds, scope_tier_ids: tierIds,
      headline: headline || null, active: true, ends_at: null,
    } as PromoConfig),
    [type, percent, buy, free, scope, excl, headline, kinds, tierIds],
  );

  const save = async () => {
    setBusy(true);
    try {
      await savePromotion({
        data: {
          type, percent: Number(percent) || 0, bogo_buy: Number(buy) || 1, bogo_free: Number(free) || 1,
          scope, exclude_exclusive: excl, scope_kinds: kinds, scope_tier_ids: tierIds,
          headline: headline || null, active,
        },
      });
      toast.success("Sale updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the sale.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 rounded-lg border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Run a store-wide sale</p>
          <p className="text-xs text-muted-foreground">Shown as a banner on your store page and applied at checkout.</p>
        </div>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Sale type</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Percentage off</SelectItem>
              <SelectItem value="bogo">Buy X get Y free</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {type === "percent" ? (
          <div className="grid gap-1.5">
            <Label>Percent off</Label>
            <Input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="numeric" />
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <div className="grid gap-1.5"><Label>Buy</Label><Input className="w-20" value={buy} onChange={(e) => setBuy(e.target.value)} inputMode="numeric" /></div>
            <div className="grid gap-1.5"><Label>Get free</Label><Input className="w-20" value={free} onChange={(e) => setFree(e.target.value)} inputMode="numeric" /></div>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="headline">Banner text (optional)</Label>
          <Input id="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={80} placeholder={preview ?? "Summer sale"} />
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border/60 p-3">
        <div>
          <p className="text-sm font-medium">Applies to</p>
          <p className="text-xs text-muted-foreground">
            Tick only what you want on sale. Leave exclusives off to keep your top-price licences out of the discount.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TIER_OPTIONS.map((k) => {
            const on = kinds.includes(k);
            return (
              <Button
                key={k} type="button" size="sm" variant={on ? "default" : "outline"}
                onClick={() => setKinds((prev) => toggle(prev, k))}
              >
                {TIER_LABEL[k]}
              </Button>
            );
          })}
        </div>

        {customTiers.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-sm font-medium">Or run the sale on specific custom licences only</p>
            <p className="text-xs text-muted-foreground">
              Pick one or more and the sale ignores everything else — handy for a sync-licence-only or exclusive-only sale.
            </p>
            <div className="flex flex-wrap gap-2">
              {customTiers.map((t) => {
                const on = tierIds.includes(t.id);
                return (
                  <Button
                    key={t.id} type="button" size="sm" variant={on ? "default" : "outline"}
                    onClick={() => setTierIds((prev) => toggle(prev, t.id))}
                  >
                    {t.label}
                  </Button>
                );
              })}
            </div>
            {tierIds.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setTierIds([])}>Clear specific licences</Button>
            )}
          </div>
        )}
      </div>

      {preview && <p className="text-sm">Buyers will see: <span className="font-medium">{preview}</span></p>}
      <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save sale</Button>
    </div>
  );
}

function OrdersPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["store-orders"], queryFn: () => listStoreOrders() });
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const orders = (data?.orders ?? []) as Record<string, any>[];
  const leads = (data?.leads ?? []) as Record<string, any>[];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold">Orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-lg border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{o.buyer_name} · {o.buyer_email}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleString()} · {(o.items ?? []).map((i: Record<string, any>) => i.title).join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={o.status === "paid" ? "default" : "secondary"}>{o.status}</Badge>
                    <span className="font-medium">{money(o.total_cents, o.currency)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Free download leads ({leads.length})</h2>
        {leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails collected yet.</p>
        ) : (
          <>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-border/60 p-3 text-sm">
              {leads.map((l) => (
                <div key={l.id} className="flex justify-between py-0.5">
                  <span>{l.email}</span>
                  <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
            <Button
              size="sm" variant="outline" className="mt-3"
              onClick={async () => {
                try {
                  const res = await exportFreeDownloadEmails();
                  if (!res.count) { toast.info("No emails to export yet."); return; }
                  downloadCsv(res.csv, res.fileName);
                  toast.success(`Exported ${res.count} email${res.count === 1 ? "" : "s"}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not export your email list.");
                }
              }}
            >
              Export email list (CSV)
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Includes free-download emails and paying customers, de-duplicated, with Email Address / First Name / Last Name
              columns that import straight into Mailchimp, Klaviyo, ConvertKit and Substack.
            </p>
          </>
        )}
      </section>

      <LicensesPanel />
    </div>
  );
}

function LicensesPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["store-licenses"], queryFn: () => listIssuedLicenses() });
  const [busy, setBusy] = useState(false);
  const licenses = (data?.licenses ?? []) as Record<string, any>[];

  const downloadAll = async () => {
    setBusy(true);
    try {
      for (const l of licenses) {
        if (!l.url) continue;
        const res = await fetch(l.url as string, { cache: "no-store" });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${String(l.title).replace(/[^\w\-]+/g, "-")}-${String(l.buyerName).replace(/[^\w\-]+/g, "-")}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        await new Promise((r) => setTimeout(r, 250));
      }
      toast.success("Licences downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download the licences.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Issued licences ({licenses.length})</h2>
        {licenses.length > 0 && (
          <Button size="sm" variant="outline" onClick={downloadAll} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Download all
          </Button>
        )}
      </div>
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : licenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Licences appear here as soon as a licensed sale completes.</p>
      ) : (
        <div className="space-y-2">
          {licenses.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{l.title}</p>
                <p className="text-xs text-muted-foreground">
                  {tierLabel(l.tierKind, l.tierLabel)} · {l.buyerName} ({l.buyerEmail}) · {new Date(l.issuedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{money(l.priceCents, l.currency)}</span>
                <Button size="sm" variant="outline" asChild>
                  <a href={l.url ?? "#"} target="_blank" rel="noreferrer">PDF</a>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function MembersPanel({
  storeId, plan, stripe, subscribers, currency, onSaved,
}: {
  storeId: string;
  plan: Record<string, any> | null;
  stripe: { hasSecret: boolean; hasWebhook: boolean };
  subscribers: Record<string, any>[];
  currency: string;
  onSaved: () => void;
}) {
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);

  const [name, setName] = useState(plan?.name ?? "Membership");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [price, setPrice] = useState(String(((plan?.price_cents ?? 1999) / 100).toFixed(2)));
  const [interval, setInterval] = useState<"month" | "year">(plan?.interval === "year" ? "year" : "month");
  const [mode, setMode] = useState<"quota" | "all_access">(plan?.mode === "all_access" ? "all_access" : "quota");
  const [leaseQuota, setLeaseQuota] = useState(String(plan?.lease_quota ?? 2));
  const [downloadQuota, setDownloadQuota] = useState(String(plan?.download_quota ?? 5));
  const [discount, setDiscount] = useState(String(plan?.discount_percent ?? 10));
  const [active, setActive] = useState(!!plan?.active);
  const [savingPlan, setSavingPlan] = useState(false);

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/stripe/${storeId}`;

  const preview: MembershipPlan = {
    name,
    description: description || null,
    price_cents: Math.round(parseFloat(price || "0") * 100),
    interval,
    mode,
    lease_quota: parseInt(leaseQuota || "0", 10) || 0,
    download_quota: parseInt(downloadQuota || "0", 10) || 0,
    discount_percent: parseInt(discount || "0", 10) || 0,
    active,
  };

  const saveKeys = async () => {
    setSavingKeys(true);
    try {
      await saveStripeKeys({
        data: {
          secretKey: secretKey.trim() || undefined,
          webhookSecret: webhookSecret.trim() || undefined,
        },
      });
      setSecretKey("");
      setWebhookSecret("");
      toast.success("Stripe keys saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your Stripe keys.");
    } finally {
      setSavingKeys(false);
    }
  };

  const savePlan = async () => {
    setSavingPlan(true);
    try {
      await saveMembershipPlan({
        data: {
          name,
          description: description || null,
          price_cents: preview.price_cents,
          interval,
          mode,
          lease_quota: preview.lease_quota,
          download_quota: preview.download_quota,
          discount_percent: preview.discount_percent,
          active,
        },
      });
      toast.success("Membership saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the membership.");
    } finally {
      setSavingPlan(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-5">
        <div>
          <h2 className="text-sm font-medium">Your Stripe account</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Memberships bill through your own Stripe account, so the money lands with you. Keys are stored
            server-side and never sent back to the browser.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={stripe.hasSecret ? "default" : "secondary"}>
            {stripe.hasSecret ? "Secret key saved" : "Secret key missing"}
          </Badge>
          <Badge variant={stripe.hasWebhook ? "default" : "secondary"}>
            {stripe.hasWebhook ? "Webhook secret saved" : "Webhook secret missing"}
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="sk">Stripe secret key</Label>
              <a
                href="https://dashboard.stripe.com/developers/apikeys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[color:var(--gold)] hover:underline"
              >
                Get your keys <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input id="sk" type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_live_..." />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="whsec">Webhook signing secret</Label>
              <a
                href="https://dashboard.stripe.com/developers/webhooks"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[color:var(--gold)] hover:underline"
              >
                Add endpoint <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input id="whsec" type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="whsec_..." />
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
          <p className="font-medium">Webhook endpoint (add this in Stripe → Developers → Webhooks)</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-background px-2 py-0.5">{webhookUrl}</code>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("Link copied"); }}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />Copy
            </Button>
          </div>
          <p className="mt-2 text-muted-foreground">
            Send these events: checkout.session.completed, customer.subscription.updated,
            customer.subscription.deleted, invoice.paid, invoice.payment_failed.
          </p>
        </div>

        <Button onClick={saveKeys} disabled={savingKeys || (!secretKey.trim() && !webhookSecret.trim())}>
          {savingKeys && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Stripe keys
        </Button>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-5">
        <div>
          <h2 className="text-sm font-medium">Membership plan</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            One recurring plan per store. Members get their allowance applied automatically at checkout.
            Exclusive licences are never included.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="mname">Plan name</Label>
            <Input id="mname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mprice">Price</Label>
            <div className="flex items-center gap-2">
              <Input id="mprice" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} className="max-w-28" />
              <Select value={interval} onValueChange={(v) => setInterval(v as "month" | "year")}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">per month</SelectItem>
                  <SelectItem value="year">per year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="mdesc">Pitch (optional)</Label>
          <Textarea id="mdesc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} placeholder="Two beats a month plus 10% off everything else." />
        </div>

        <div className="grid gap-1.5">
          <Label>What members get</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as "quota" | "all_access")}>
            <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quota">Set allowance + member discount</SelectItem>
              <SelectItem value="all_access">All-access (unlimited)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "quota" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mlease">Beat leases / period</Label>
              <Input id="mlease" value={leaseQuota} onChange={(e) => setLeaseQuota(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mdl">Downloads / period</Label>
              <Input id="mdl" value={downloadQuota} onChange={(e) => setDownloadQuota(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mdisc">Discount after that (%)</Label>
              <Input id="mdisc" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          </div>
        )}

        <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          Buyers will see: <span className="text-foreground">{money(preview.price_cents, currency)}/{interval === "year" ? "yr" : "mo"} — {planBlurb(preview)}</span>
        </p>

        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
          <div>
            <p className="text-sm font-medium">Offer this membership</p>
            <p className="text-xs text-muted-foreground">Shows a subscribe card on your public page.</p>
          </div>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>

        <Button onClick={savePlan} disabled={savingPlan}>
          {savingPlan && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save membership
        </Button>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-5">
        <h2 className="text-sm font-medium">Members ({subscribers.length})</h2>
        {subscribers.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No members yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {subscribers.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 px-3 py-2 text-sm">
                <span className="truncate">{s.email}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge>
                  <span>{s.leases_used} leases · {s.downloads_used} downloads used</span>
                  {s.current_period_end && <span>renews {new Date(s.current_period_end).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
