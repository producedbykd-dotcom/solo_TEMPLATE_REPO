import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createProjectsBatch, listCatalog, deleteProject } from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Music, UploadCloud, Loader2, Plus, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { prepareAnalysisAssets, uploadWithProgress, formatBytes } from "@/lib/audio-preview";
import { analyzeAudio } from "@/lib/analysis.functions";

export const Route = createFileRoute("/_authenticated/projects/")({
  component: ProjectsIndex,
});

const MAX_FILES = 10;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB hard ceiling
const WARN_BYTES = 500 * 1024 * 1024;
const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/flac,audio/aac,audio/mp4,audio/x-m4a";

function fileTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";
}

async function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.src = url;
      a.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(a.duration) ? a.duration : null);
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

type UploadPhase = "uploading" | "preview" | "finalizing" | "done" | "error";
type UploadRow = {
  name: string;
  size: number;
  loaded: number;
  pct: number;
  phase: UploadPhase;
  message?: string;
};

function ProjectsIndex() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<UploadRow[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => listCatalog(),
  });

  const create = useMutation({
    mutationFn: (items: Parameters<typeof createProjectsBatch>[0]["data"]["items"]) =>
      createProjectsBatch({ data: { items } }),
    onSuccess: ({ projects }) => {
      qc.invalidateQueries({ queryKey: ["catalog"] });
      for (const p of projects) {
        analyzeAudio({ data: { projectId: p.id } })
          .then(() => qc.invalidateQueries({ queryKey: ["project", p.id] }))
          .catch(() => { /* silent — user can retry from the workspace */ });
      }
      if (projects.length === 1) {
        navigate({ to: "/projects/$id", params: { id: projects[0].id } });
      } else {
        toast.success(`${projects.length} projects created`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).slice(0, MAX_FILES);
      if (!list.length) return;

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return toast.error("Not signed in");

      const filtered = list.filter((f) => {
        if (f.size > MAX_BYTES) {
          toast.error(`${f.name} is over 1 GB — please trim before uploading.`);
          return false;
        }
        if (f.size > WARN_BYTES) {
          toast.message(`${f.name} is ${formatBytes(f.size)} — large uploads may take a while.`);
        }
        return true;
      });
      if (!filtered.length) return;

      setUploading(
        filtered.map((f) => ({
          name: f.name,
          size: f.size,
          loaded: 0,
          pct: 0,
          phase: "uploading" as UploadPhase,
        })),
      );

      const updateRow = (name: string, patch: Partial<UploadRow>) =>
        setUploading((u) => u.map((x) => (x.name === name ? { ...x, ...patch } : x)));

      const items: Parameters<typeof create.mutateAsync>[0] = [];

      for (const f of filtered) {
        const ext = (f.name.split(".").pop() || "bin").toLowerCase();
        const projectFolder = crypto.randomUUID();
        const path = `${uid}/${projectFolder}/audio.${ext}`;

        const { data: signed, error: signErr } = await supabase.storage
          .from("audio")
          .createSignedUploadUrl(path);
        if (signErr || !signed?.signedUrl) {
          updateRow(f.name, { phase: "error", message: signErr?.message || "Could not start upload" });
          toast.error(`${f.name}: ${signErr?.message || "upload failed"}`);
          continue;
        }

        try {
          await uploadWithProgress(
            signed.signedUrl,
            f,
            f.type || "audio/mpeg",
            (loaded, total) => {
              const pct = total ? Math.round((loaded / total) * 100) : 0;
              updateRow(f.name, { loaded, pct });
            },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed";
          updateRow(f.name, { phase: "error", message: msg });
          toast.error(`${f.name}: ${msg}`);
          continue;
        }

        updateRow(f.name, { phase: "preview", pct: 100, loaded: f.size });

        let analysisPath: string | null = null;
        let integratedLufs: number | null = null;
        let truePeakDbtp: number | null = null;
        try {
          const prep = await prepareAnalysisAssets(f);
          integratedLufs = prep.integratedLufs;
          truePeakDbtp = prep.truePeakDbtp;
          if (prep.preview) {
            const previewPath = `${uid}/${projectFolder}/analysis.mp3`;
            const { error: pErr } = await supabase.storage
              .from("audio")
              .upload(previewPath, prep.preview, { contentType: "audio/mpeg", upsert: true });
            if (!pErr) analysisPath = previewPath;
          }
        } catch {
          /* fall through — analysis preview/loudness is best-effort */
        }

        updateRow(f.name, { phase: "finalizing" });
        const duration = await readAudioDuration(f);
        items.push({
          title: fileTitle(f.name),
          storagePath: path,
          durationSec: duration,
          analysisAudioPath: analysisPath,
          integratedLufs,
          truePeakDbtp,
        });
        updateRow(f.name, { phase: "done" });
      }
      if (items.length) await create.mutateAsync(items);
      setTimeout(() => setUploading((u) => u.filter((r) => r.phase === "error")), 1200);
    },
    [create],
  );

  const projects = data?.projects ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--gold)]">Studio</p>
          <h1 className="mt-2 font-display text-4xl">Your projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop up to 10 tracks at once. Each becomes its own release you can edit and publish.
          </p>
        </div>
        <Button onClick={() => inputRef.current?.click()} size="lg">
          <Plus className="mr-1.5 h-4 w-4" /> New upload
        </Button>
      </header>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mt-8 cursor-pointer rounded-2xl border border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-[color:var(--gold)] bg-card"
            : "border-border bg-card/40 hover:bg-card/60"
        }`}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-[color:var(--gold)]" />
        <p className="mt-3 font-display text-xl">Drop your tracks here</p>
        <p className="mt-1 text-sm text-muted-foreground">MP3, WAV, FLAC, M4A — up to 10 at once</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => e.target.files && onFiles(e.target.files)}
        />
      </div>

      {uploading.length > 0 && (
        <div className="mt-4 space-y-3">
          {uploading.map((u) => {
            const statusLabel =
              u.phase === "uploading"
                ? `${formatBytes(u.loaded)} / ${formatBytes(u.size)}`
                : u.phase === "preview"
                  ? "Preparing analysis preview…"
                  : u.phase === "finalizing"
                    ? "Finalizing…"
                    : u.phase === "done"
                      ? "Uploaded"
                      : u.message || "Failed";
            const Icon =
              u.phase === "done"
                ? CheckCircle2
                : u.phase === "error"
                  ? AlertCircle
                  : Loader2;
            return (
              <div
                key={u.name}
                className="rounded-xl border border-border bg-card/60 px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={
                      "h-4 w-4 " +
                      (u.phase === "done"
                        ? "text-emerald-400"
                        : u.phase === "error"
                          ? "text-destructive"
                          : "animate-spin text-[color:var(--gold)]")
                    }
                  />
                  <span className="flex-1 truncate font-medium">{u.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {u.phase === "error" ? "" : `${u.pct}%`}
                  </span>
                </div>
                <Progress value={u.pct} variant="gradient" className="mt-2 h-1.5" />
                <p className="mt-1.5 text-xs text-muted-foreground">{statusLabel}</p>
              </div>
            );
          })}
        </div>
      )}

      <section className="mt-12">
        <h2 className="font-display text-2xl">Recent</h2>
        {isLoading ? (
          <div className="mt-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-card/40" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No projects yet. Drop your first track above to get started.
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            {projects.map((p: any) => {
              const isDraft = p.status !== "published";
              return (
                <div key={p.id} className="group relative">
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="flex items-center gap-4 rounded-2xl border border-border bg-card/40 p-3 pr-14 transition-colors hover:border-[color:var(--accent)]/40 hover:bg-card/70"
                  >
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary/40">
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[color:var(--accent)]/30 to-secondary text-2xl font-display text-foreground/70">
                        {p.title?.charAt(0).toUpperCase() || <Music className="h-6 w-6" />}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-display text-lg">{p.title}</p>
                      {isDraft ? (
                        <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {p.status}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                          Published
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Uploaded {new Date(p.created_at).toLocaleDateString()}
                    </p>
                    {isDraft && typeof p.completion === "number" && (
                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/40">
                          <div
                            className="h-full transition-all"
                            style={{ width: `${p.completion}%`, backgroundImage: "var(--gradient-accent)" }}
                          />
                        </div>
                        <span className="tabular-nums text-xs text-muted-foreground">{p.completion}%</span>
                      </div>
                    )}
                  </div>
                  </Link>
                  <DeleteRowButton projectId={p.id} title={p.title} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function DeleteRowButton({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => deleteProject({ data: { id: projectId } }),
    onSuccess: () => {
      toast.success("Draft deleted");
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-background/80 text-muted-foreground opacity-0 transition hover:border-destructive/60 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
          aria-label="Delete draft"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the draft, its analysis, artwork, and any rendered videos. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); m.mutate(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}