import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  setupStatus, verifySupabase, verifyGemini, createOwner, verifyLicense,
  getSchemaSql, verifySchema, ensureBuckets,
} from "@/lib/setup.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/Brand";
import { SERVICES } from "@/lib/solo/services";
import { CheckCircle2, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set up your Release Engine" },
      { name: "description", content: "One-time setup for your Release Engine Solo installation." },
      { property: "og:title", content: "Set up your Release Engine" },
      { property: "og:description", content: "One-time setup for your Solo installation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupWizard,
});

type Step = "checklist" | "licence" | "database" | "schema" | "ai" | "owner" | "done";

function SetupWizard() {
  const navigate = useNavigate();
  const status = useServerFn(setupStatus);
  const checkDb = useServerFn(verifySupabase);
  const checkAi = useServerFn(verifyGemini);
  const makeOwner = useServerFn(createOwner);
  const checkLicence = useServerFn(verifyLicense);
  const fetchSchema = useServerFn(getSchemaSql);
  const checkSchema = useServerFn(verifySchema);
  const makeBuckets = useServerFn(ensureBuckets);

  const [step, setStep] = useState<Step>("checklist");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [serviceRoleKey, setServiceRoleKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [licenceKey, setLicenceKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [schemaSql, setSchemaSql] = useState("");

  useEffect(() => {
    status().then((s) => {
      if (s.ownerExists) setLocked(true);
    }).catch(() => {});
  }, [status]);

  if (locked) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card/60 p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
          <h1 className="mt-4 font-display text-2xl">Already set up</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This installation already has an owner. Setup is closed for good.
          </p>
          <Button className="mt-6" onClick={() => navigate({ to: "/auth" })}>
            Go to sign in
          </Button>
        </div>
      </Shell>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <ol className="mb-8 flex flex-wrap gap-2 text-xs">
        {(["checklist", "licence", "database", "schema", "ai", "owner"] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`rounded-full border px-3 py-1 capitalize ${
              step === s
                ? "border-[color:var(--accent)] text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {i + 1}. {s === "ai" ? "AI key" : s}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      {step === "checklist" && (
        <section className="rounded-2xl border border-border bg-card/60 p-6">
          <h1 className="font-display text-2xl">Before you start</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You need accounts with these services. The required ones take about ten minutes.
          </p>
          <ul className="mt-5 space-y-3">
            {SERVICES.filter((s) => s.required).map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{s.name}</p>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[color:var(--gold)] hover:underline"
                  >
                    Sign up <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.purpose}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.cost}</p>
              </li>
            ))}
          </ul>
          <Button className="mt-6 w-full" onClick={() => setStep("licence")}>
            I have these — continue
          </Button>
        </section>
      )}

      {step === "licence" && (
        <section className="rounded-2xl border border-border bg-card/60 p-6">
          <h1 className="font-display text-2xl">Enter your licence key</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The key emailed to you after purchase. It is checked once, right now — this
            installation never phones home again.
          </p>
          <div className="mt-5">
            <Label htmlFor="lic">Licence key</Label>
            <Input
              id="lic"
              autoComplete="off"
              placeholder="SOLO-..."
              value={licenceKey}
              onChange={(e) => setLicenceKey(e.target.value)}
            />
          </div>
          <Button
            className="mt-6 w-full"
            disabled={busy || !licenceKey.trim()}
            onClick={() =>
              run(async () => {
                const res = await checkLicence({ data: { key: licenceKey.trim() } });
                if (!res.ok) throw new Error(res.error);
                toast.success(res.offline ? "Licence accepted (offline check)" : "Licence verified");
                setStep("database");
              })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify licence"}
          </Button>
        </section>
      )}

      {step === "database" && (
        <section className="rounded-2xl border border-border bg-card/60 p-6">
          <h1 className="font-display text-2xl">Connect your database</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            From your Supabase project: Settings → API. These values are stored in your
            own environment, never sent to us.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="sb-url">Project URL</Label>
              <Input
                id="sb-url"
                placeholder="https://xxxx.supabase.co"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sb-key">Service role key</Label>
              <Input
                id="sb-key"
                type="password"
                autoComplete="off"
                value={serviceRoleKey}
                onChange={(e) => setServiceRoleKey(e.target.value)}
              />
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            disabled={busy || !supabaseUrl || !serviceRoleKey}
            onClick={() =>
              run(async () => {
                const res = await checkDb({ data: { supabaseUrl, serviceRoleKey } });
                if (!res.ok) throw new Error(res.error);
                if (res.ownerExists) {
                  setLocked(true);
                  return;
                }
                toast.success("Database connected");
                const { sql } = await fetchSchema();
                setSchemaSql(sql);
                setStep("schema");
              })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test connection"}
          </Button>
        </section>
      )}

      {step === "schema" && (
        <section className="rounded-2xl border border-border bg-card/60 p-6">
          <h1 className="font-display text-2xl">Create your tables</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One copy and paste. Open the SQL editor in your Supabase project, paste this in,
            and press Run. It builds every table and storage bucket the app needs.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(schemaSql);
                toast.success("Copied — now paste it into the SQL editor");
              }}
            >
              Copy the SQL
            </Button>
            <a
              href={`${supabaseUrl.replace(/\/$/, "")}/project/default/sql/new`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 self-center text-xs text-[color:var(--gold)] hover:underline"
            >
              Open the SQL editor <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-black/40 p-4 text-[10px] leading-relaxed">
            {schemaSql.slice(0, 4000)}
            {schemaSql.length > 4000 ? "\n… (use the Copy button for the whole thing)" : ""}
          </pre>
          <Button
            className="mt-6 w-full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await checkSchema({ data: { supabaseUrl, serviceRoleKey } });
                if (!res.ok) throw new Error(res.error);
                const buckets = await makeBuckets({ data: { supabaseUrl, serviceRoleKey } });
                if (!buckets.ok) {
                  toast.warning(
                    `Tables are in place. Create these private storage buckets by hand: ${buckets.failed.join(", ")}`,
                  );
                } else {
                  toast.success("Tables and storage are in place");
                }
                setStep("ai");
              })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "I've run it — check"}
          </Button>
        </section>
      )}

      {step === "ai" && (
        <section className="rounded-2xl border border-border bg-card/60 p-6">
          <h1 className="font-display text-2xl">Add your AI key</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your Google Gemini API key powers analysis, metadata and artwork. You pay Google
            directly — usually a few cents per release.
          </p>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-[color:var(--gold)] hover:underline"
          >
            Get a key <ExternalLink className="h-3 w-3" />
          </a>
          <div className="mt-5">
            <Label htmlFor="gem">API key</Label>
            <Input
              id="gem"
              type="password"
              autoComplete="off"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
          </div>
          <Button
            className="mt-6 w-full"
            disabled={busy || !geminiKey}
            onClick={() =>
              run(async () => {
                const res = await checkAi({ data: { apiKey: geminiKey } });
                if (!res.ok) throw new Error(res.error);
                toast.success("AI key verified");
                setStep("owner");
              })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify key"}
          </Button>
        </section>
      )}

      {step === "owner" && (
        <section className="rounded-2xl border border-border bg-card/60 p-6">
          <h1 className="font-display text-2xl">Create your login</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the only account this installation will ever have. There is no public sign-up.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="ow-email">Email</Label>
              <Input
                id="ow-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ow-pass">Password</Label>
              <Input
                id="ow-pass"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">At least 10 characters.</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            disabled={busy || !email || password.length < 10}
            onClick={() =>
              run(async () => {
                await makeOwner({ data: { email, password } });
                setStep("done");
              })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create owner account"}
          </Button>
        </section>
      )}

      {step === "done" && (
        <section className="rounded-2xl border border-border bg-card/60 p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
          <h1 className="mt-4 font-display text-2xl">You're set up</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in and drop your first track. Setup is now permanently closed.
          </p>
          <Button className="mt-6" onClick={() => navigate({ to: "/auth" })}>
            Sign in
          </Button>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-2xl items-center px-6 py-6">
        <Brand />
      </header>
      <main className="mx-auto max-w-2xl px-6 pb-24">{children}</main>
    </div>
  );
}