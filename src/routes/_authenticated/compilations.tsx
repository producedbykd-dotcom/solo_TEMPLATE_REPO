import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Info, Layers, Loader2, Music, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { listCatalog } from "@/lib/projects.functions";
import {
  listCompilations,
  upsertCompilation,
  deleteCompilation,
} from "@/lib/compilations.functions";
import { supabase } from "@/integrations/supabase/client";
import { renderCompilationVideo } from "@/lib/compilation-render";

export const Route = createFileRoute("/_authenticated/compilations")({
  component: CompilationsPage,
});

type Track = { id: string; title: string; primary_audio_path: string; coverUrl: string | null };

function CompilationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [ordered, setOrdered] = useState<Track[]>([]);
  const [renderState, setRenderState] = useState<{ id: string; pct: number } | null>(null);

  const inPreviewIframe =
    typeof window !== "undefined" &&
    window.self !== window.top &&
    /lovable\.app/.test(window.location.hostname);

  // Warn before navigation while a render is in progress — leaving the page
  // discards the in-browser ffmpeg job.
  useEffect(() => {
    if (!renderState) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [renderState]);

  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: () => listCatalog() });
  const { data: comps } = useQuery({ queryKey: ["compilations"], queryFn: () => listCompilations() });

  const projects = (catalog?.projects ?? []) as any[];
  const trackById = useMemo(() => {
    const m = new Map<string, Track>();
    for (const p of projects) {
      m.set(p.id, { id: p.id, title: p.title, primary_audio_path: p.primary_audio_path, coverUrl: p.coverUrl ?? null });
    }
    return m;
  }, [projects]);

  const save = useMutation({
    mutationFn: () =>
      upsertCompilation({
        data: {
          title: title || "Untitled Compilation",
          orderedTrackIds: ordered.map((t) => t.id),
        },
      }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["compilations"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success("Compilation saved — opening wizard");
      setTitle("");
      setOrdered([]);
      const projectId = res?.projectId ?? res?.compilation?.project_id;
      if (projectId) navigate({ to: "/projects/$id", params: { id: projectId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCompilation({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["compilations"] }),
  });

  const add = (id: string) => {
    if (ordered.find((t) => t.id === id)) return;
    if (ordered.length >= 12) return toast.error("Max 12 tracks per compilation");
    const t = trackById.get(id);
    if (t) setOrdered((arr) => [...arr, t]);
  };
  const move = (idx: number, delta: number) => {
    setOrdered((arr) => {
      const next = arr.slice();
      const j = idx + delta;
      if (j < 0 || j >= next.length) return arr;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const renderAndDownload = async (comp: any) => {
    const trackIds: string[] = comp.ordered_track_ids;
    const tracks = trackIds.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
    if (tracks.length < 2) return toast.error("Compilation references missing tracks");
    setRenderState({ id: comp.id, pct: 0 });
    try {
      // Download each audio.
      const audios: Array<{ blob: Blob; ext: string }> = [];
      for (const t of tracks) {
        try {
          const { data: signed, error: signErr } = await supabase.storage
            .from("audio")
            .createSignedUrl(t.primary_audio_path, 60 * 60);
          if (signErr || !signed?.signedUrl) {
            throw new Error(signErr?.message || "could not sign audio URL");
          }
          const res = await fetch(signed.signedUrl, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const ext = (t.primary_audio_path.split(".").pop() || "mp3").toLowerCase();
          audios.push({ blob, ext });
        } catch (inner) {
          throw new Error(
            `Failed to fetch "${t.title}": ${(inner as Error).message}. ` +
            (inPreviewIframe
              ? "The Lovable preview can block long downloads — try on release-engine.pro."
              : "Check your connection and retry."),
          );
        }
      }
      // Cover — use first track's cover if present, else generate a dark placeholder.
      let coverBlob: Blob | null = null;
      let coverMime = "image/jpeg";
      const firstWithCover = tracks.find((t) => t.coverUrl);
      if (firstWithCover?.coverUrl) {
        try {
          const r = await fetch(firstWithCover.coverUrl, { cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          coverBlob = await r.blob();
          coverMime = coverBlob.type || "image/jpeg";
        } catch {
          coverBlob = null;
        }
      }
      if (!coverBlob) {
        // 1080p black canvas with title via SVG.
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="#0a0613"/><text x="50%" y="50%" font-family="sans-serif" font-size="86" fill="#f59e0b" text-anchor="middle" dominant-baseline="middle">${comp.title}</text></svg>`;
        coverBlob = new Blob([svg], { type: "image/svg+xml" });
        coverMime = "image/svg+xml";
      }
      const mp4 = await renderCompilationVideo({
        audios,
        coverBlob,
        coverMime,
        onProgress: (pct) => setRenderState({ id: comp.id, pct }),
      });
      const url = URL.createObjectURL(mp4);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${comp.title || "compilation"}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Compilation rendered");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRenderState(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--accent,#f59e0b)]">Studio</p>
      <h1 className="mt-2 font-display text-4xl">Compilations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Combine up to 12 tracks into a single longform video in the order you choose. Perfect for
        playlists, mixtapes, and beat tapes.
      </p>

      {inPreviewIframe && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The Lovable preview iframe can block long audio downloads. If quick-render hits
            "Failed to fetch", open this page on <strong>release-engine.pro</strong> and retry —
            or use the wizard's render step, which is more robust.
          </p>
        </div>
      )}

      {renderState && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[color:var(--accent,#f59e0b)]/40 bg-[color:var(--accent,#f59e0b)]/10 px-4 py-3 text-sm">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[color:var(--accent,#f59e0b)]" />
          <p>
            Rendering in your browser — <strong>do not close this tab or navigate away</strong> or
            the job will be lost. {renderState.pct}% complete.
          </p>
        </div>
      )}

      {/* Builder */}
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-xl">Your tracks</h2>
          <p className="mt-1 text-xs text-muted-foreground">Tap to add to the compilation.</p>
          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">No tracks yet — upload from Projects.</p>
            )}
            {projects.map((p) => {
              const inList = !!ordered.find((t) => t.id === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={inList}
                  onClick={() => add(p.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    inList
                      ? "cursor-not-allowed border-border bg-secondary/40 opacity-50"
                      : "border-border bg-card/40 hover:border-[color:var(--accent,#f59e0b)]/40 hover:bg-card/70"
                  }`}
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-secondary/40">
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-muted-foreground">
                        <Music className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <span className="flex-1 truncate text-sm">{p.title}</span>
                  {!inList && <Plus className="h-4 w-4 text-muted-foreground" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-xl">New compilation</h2>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title — e.g. Lo-fi Beat Tape Vol. 1"
            className="mt-3"
          />
          <div className="mt-4 space-y-2">
            {ordered.length === 0 && (
              <p className="text-sm text-muted-foreground">Pick tracks from the left, in order.</p>
            )}
            {ordered.map((t, idx) => (
              <div key={t.id} className="flex items-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2">
                <span className="w-6 text-center font-mono text-xs text-muted-foreground">{idx + 1}</span>
                <span className="flex-1 truncate text-sm">{t.title}</span>
                <Button variant="ghost" size="icon" type="button" onClick={() => move(idx, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" type="button" onClick={() => move(idx, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => setOrdered((arr) => arr.filter((x) => x.id !== t.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={ordered.length < 2 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            <Layers className="mr-1.5 h-4 w-4" /> Save & open wizard
          </Button>
        </div>
      </section>

      {/* Saved compilations */}
      <section className="mt-10">
        <h2 className="font-display text-2xl">Saved compilations</h2>
        <div className="mt-4 space-y-3">
          {(comps?.compilations ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">None yet.</p>
          )}
          {(comps?.compilations ?? []).map((c: any) => {
            const rendering = renderState?.id === c.id;
            return (
              <div key={c.id} className="rounded-2xl border border-border bg-card/40 p-4">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-display text-lg">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.ordered_track_ids?.length ?? 0} tracks
                    </p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    {c.project_id && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => navigate({ to: "/projects/$id", params: { id: c.project_id } })}
                      >
                        <Wand2 className="mr-1.5 h-4 w-4" /> Open wizard
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={!!renderState}
                      onClick={() => renderAndDownload(c)}
                    >
                      {rendering ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-4 w-4" />
                      )}
                      {rendering ? `Rendering ${renderState?.pct ?? 0}%` : "Quick render"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => remove.mutate(c.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}