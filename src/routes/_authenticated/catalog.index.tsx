import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listCatalog } from "@/lib/projects.functions";
import { Library, Music, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/catalog/")({
  component: CatalogPage,
});

type Row = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  first_published_at: string | null;
  completion: number;
  coverUrl: string | null;
  is_released?: boolean;
};

function CatalogPage() {
  const { data, isLoading } = useQuery({ queryKey: ["catalog"], queryFn: () => listCatalog() });
  const projects = (data?.projects ?? []) as Row[];
  const [tab, setTab] = useState<"all" | "drafts" | "released">("all");
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return projects.filter((p) => {
      const released = p.is_released || p.status === "published";
      if (tab === "drafts" && released) return false;
      if (tab === "released" && !released) return false;
      if (term && !p.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [projects, tab, q]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--gold)]">Catalog</p>
      <h1 className="mt-2 font-display text-4xl">All your releases</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every release with its album cover, completion status, and a one-click jump back in.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex rounded-full border border-border bg-card/60 p-1 text-xs">
          {([
            ["all", "All"], ["drafts", "Drafts"], ["released", "Released"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                tab === k ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >{label}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" className="pl-9" />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <Library className="mx-auto mb-2 h-5 w-5" />
            Nothing here yet.
          </div>
        ) : (
          filtered.map((p) => <CatalogRow key={p.id} row={p} />)
        )}
      </div>
    </div>
  );
}

function CatalogRow({ row }: { row: Row }) {
  const released = row.is_released || row.status === "published";
  const isDraft = !released;
  return (
    <Link
      to="/projects/$id"
      params={{ id: row.id }}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-card/40 p-3 transition-colors hover:border-[color:var(--accent)]/40 hover:bg-card/70"
    >
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary/40">
        {row.coverUrl ? (
          <img src={row.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[color:var(--accent)]/30 to-secondary text-2xl font-display text-foreground/70">
            {row.title.charAt(0).toUpperCase() || <Music className="h-6 w-6" />}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-display text-lg">{row.title}</p>
          {isDraft ? (
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {row.status}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
              Published {row.first_published_at ? new Date(row.first_published_at).toLocaleDateString() : ""}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Uploaded {new Date(row.created_at).toLocaleDateString()}
        </p>
        {isDraft && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/40">
              <div
                className="h-full bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] transition-all"
                style={{ width: `${row.completion}%` }}
              />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground">{row.completion}%</span>
          </div>
        )}
      </div>
    </Link>
  );
}