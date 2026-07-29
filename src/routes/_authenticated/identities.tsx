import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Star, Trash2, Loader2, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { listIdentities, upsertIdentity, deleteIdentity, type Identity, type IdentityLinks } from "@/lib/identities.functions";

export const Route = createFileRoute("/_authenticated/identities")({
  component: IdentitiesPage,
});

const LINK_KEYS: Array<keyof IdentityLinks> = [
  "spotify", "apple", "youtube", "instagram", "tiktok", "facebook", "soundcloud", "bandcamp", "website",
];

function IdentitiesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["identities"], queryFn: () => listIdentities() });
  const [editing, setEditing] = useState<Partial<Identity> | null>(null);

  const save = useMutation({
    mutationFn: (input: Partial<Identity>) => upsertIdentity({ data: {
      id: input.id, name: input.name || "Untitled",
      artist_name: input.artist_name ?? null,
      links: (input.links ?? {}) as IdentityLinks,
      default_tags: input.default_tags ?? [],
      description_template: input.description_template ?? null,
      image_style_prompt: input.image_style_prompt ?? null,
      reference_image_paths: input.reference_image_paths ?? [],
      is_default: !!input.is_default,
    } }),
    onSuccess: () => { toast.success("Identity saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["identities"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteIdentity({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["identities"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const identities = data?.identities ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--accent)]">Templates</p>
          <h1 className="mt-2 font-display text-4xl">Identities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save the artist info, links, tags, and visual style you reuse across releases. Pick one on any project to prefill everything.
          </p>
        </div>
        <Button onClick={() => setEditing({ name: "New identity", links: {}, default_tags: [], reference_image_paths: [] })}>
          <Plus className="mr-1.5 h-4 w-4" /> New identity
        </Button>
      </header>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : identities.length === 0 && !editing ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
          <UserCircle2 className="mx-auto h-8 w-8 text-[color:var(--accent)]" />
          <p className="mt-3 font-display text-xl">No identities yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Save one from a finished release, or create one here.</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-3">
          {identities.map((i) => (
            <div key={i.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-4">
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
                <UserCircle2 className="h-5 w-5 text-[color:var(--accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-display text-base">
                  {i.name}
                  {i.is_default && <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--accent)]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[color:var(--accent)]"><Star className="h-3 w-3" /> default</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {i.artist_name || "—"} · {(i.default_tags ?? []).length} tags · {Object.keys(i.links ?? {}).length} links
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(i)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => del.mutate(i.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <IdentityEditor
          value={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => save.mutate(editing)}
          saving={save.isPending}
        />
      )}
    </div>
  );
}

function IdentityEditor({ value, onChange, onCancel, onSave, saving }: {
  value: Partial<Identity>;
  onChange: (v: Partial<Identity>) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [tagInput, setTagInput] = useState("");
  useEffect(() => { setTagInput(""); }, [value.id]);

  function setLink(k: keyof IdentityLinks, v: string) {
    onChange({ ...value, links: { ...(value.links ?? {}), [k]: v } });
  }
  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/^#/, "");
    if (!t) return;
    const tags = value.default_tags ?? [];
    if (tags.includes(t)) { setTagInput(""); return; }
    onChange({ ...value, default_tags: [...tags, t] });
    setTagInput("");
  }

  return (
    <div className="mt-8 rounded-2xl border border-[color:var(--accent)]/40 bg-card/60 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">{value.id ? "Edit identity" : "New identity"}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save identity
          </Button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Identity name</Label>
          <Input value={value.name ?? ""} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Artist name</Label>
          <Input value={value.artist_name ?? ""} onChange={(e) => onChange({ ...value, artist_name: e.target.value })} />
        </div>
      </div>

      <div className="mt-6">
        <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Links</Label>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {LINK_KEYS.map((k) => (
            <div key={k} className="space-y-1">
              <Label className="text-[11px] capitalize text-muted-foreground">{k}</Label>
              <Input value={(value.links as any)?.[k] ?? ""} onChange={(e) => setLink(k, e.target.value)} placeholder={`https://…`} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Default tags</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(value.default_tags ?? []).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs">
              {t}
              <button onClick={() => onChange({ ...value, default_tags: (value.default_tags ?? []).filter((x) => x !== t) })}>×</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="add a tag"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
          <Button variant="outline" onClick={addTag}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Description template</Label>
          <p className="text-[11px] text-muted-foreground">Use <code>{"{title}"}</code> and <code>{"{links}"}</code> as placeholders. Applied as a starting point on every new release.</p>
          <Textarea rows={6} value={value.description_template ?? ""} onChange={(e) => onChange({ ...value, description_template: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Image style prompt</Label>
          <p className="text-[11px] text-muted-foreground">Injected into every artwork generation as your visual identity.</p>
          <Textarea rows={3} value={value.image_style_prompt ?? ""} onChange={(e) => onChange({ ...value, image_style_prompt: e.target.value })}
            placeholder="e.g. matte film grain, single subject, deep navy + warm orange, 35mm lens" />
        </div>
      </div>

      <label className="mt-6 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!value.is_default} onChange={(e) => onChange({ ...value, is_default: e.target.checked })} />
        Use as default for new projects
      </label>
    </div>
  );
}