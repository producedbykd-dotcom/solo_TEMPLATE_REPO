import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getProject } from "@/lib/projects.functions";
import { analyzeAudio, updateAnalysis } from "@/lib/analysis.functions";
import { researchKeywords, updateKeywords, suggestKeywordSeeds, type KeywordsPayload } from "@/lib/keywords.functions";
import { discoverKeywordOpportunities, type KeywordOpportunity } from "@/lib/keywords.functions";
import { generateMetadata, updateMetadata, type MetadataPayload } from "@/lib/metadata.functions";
import { generateArtwork, generateArtworkPair, selectArtwork, addArtworkReference, removeArtworkReference, useOwnArtwork, type ArtworkPayload } from "@/lib/artwork.functions";
import { renameProject, deleteProject, markAutoChainRan } from "@/lib/projects.functions";
import { researchMusicStats, type YoutubeMusicPayload } from "@/lib/youtube-music.functions";
import { listIdentities, setProjectIdentity, createIdentityFromProject, type Identity } from "@/lib/identities.functions";
import { recordLongformAsset } from "@/lib/longform.functions";
import { buildLongformVideo, preresizeThumbnail, warmupFFmpeg } from "@/lib/longform";
import { loadCompilationConcatAudio } from "@/lib/compilation-audio";
import { ensureCompilationKeywords } from "@/lib/compilations.functions";
import { recordShortAsset, deleteShortClip, type ShortsPayload } from "@/lib/shorts.functions";
import { buildShortVideo } from "@/lib/shorts";
import { downloadStorageObject } from "@/lib/storage-proxy.functions";
import { publishToYoutube, publishShortsToYoutube, publishToFacebook, publishToInstagram, publishToTiktok, publishToSoundcloud, listPublishJobs } from "@/lib/publish.functions";
import { getSoundcloudConnectionInfo } from "@/lib/soundcloud.functions";
import { getYoutubeConnection } from "@/lib/youtube.functions";
import { getMetaConnectionInfo } from "@/lib/meta.functions";
import { getTiktokConnectionInfo } from "@/lib/tiktok.functions";
import { GenerateFromResearchCard } from "@/components/GenerateFromResearchCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import {
  ArrowLeft, Music, Sparkles, Search, Type, Tags, Image as ImageIcon,
  Film, Smartphone, Send, Lock, Loader2, ChevronLeft, ChevronRight, LayoutGrid, ListChecks, Youtube, Instagram, Facebook, ExternalLink, CheckCircle2,
  Copy, Download, Check, Plus, X, Star, Pencil, UploadCloud, Wand2, Info, UserCircle2, Trash2, Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { DirectionComposer } from "@/components/DirectionComposer";
import { ImageGenProgress } from "@/components/ImageGenProgress";
import { SectionSaveProvider, useRegisterSectionSave } from "@/components/SectionSave";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  component: ProjectPage,
});

// Fetch a signed-URL asset and label failures with which asset failed and why,
// so the render toast pinpoints the failing step instead of a generic
// "Failed to fetch".
async function downloadAssetOrThrow(label: string, bucket: string, path: string): Promise<Blob> {
  // Route the download through a same-origin server function. Ad-blockers /
  // privacy extensions frequently block direct browser -> *.supabase.co
  // requests, causing an instant "Failed to fetch" before anything reaches
  // the network. The server proxy avoids the cross-origin call entirely.
  try {
    const res = await downloadStorageObject({ data: { bucket, path } });
    const bin = atob(res.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: res.contentType });
  } catch (e) {
    const msg = (e as Error)?.message || "download rejected";
    throw new Error(`${label} download failed: ${msg}`);
  }
}

type SectionKey =
  | "track" | "analysis" | "keywords" | "metadata" | "tags"
  | "thumbnail" | "longform" | "shorts" | "publish";

type SectionDef = {
  key: SectionKey;
  title: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SECTIONS: SectionDef[] = [
  { key: "analysis", title: "Music analysis", blurb: "Genre, niche, key, BPM and production notes. Everything downstream is built from this.", icon: Sparkles },
  { key: "track", title: "Track", blurb: "Audio file, duration and player.", icon: Music },
  { key: "keywords", title: "Keyword research", blurb: "YouTube-driven keyword volume & competition.", icon: Search },
  { key: "metadata", title: "Title & description", blurb: "AI title, hook and full description.", icon: Type },
  { key: "tags", title: "Tags", blurb: "Top-performing tag set tuned to your niche.", icon: Tags },
  { key: "thumbnail", title: "Thumbnail & cover", blurb: "Realistic thumbnail and 3000×3000 album cover.", icon: ImageIcon },
  { key: "longform", title: "Render video", blurb: "Thumbnail + audio + waveform, broadcast quality.", icon: Film },
  { key: "shorts", title: "Shorts", blurb: "Up to 3 vertical cutdowns for IG / TikTok / YT.", icon: Smartphone },
  { key: "publish", title: "Publish", blurb: "YouTube, Instagram, TikTok, Facebook.", icon: Send },
];

const READY: Record<SectionKey, boolean> = {
  track: true, analysis: true,
  keywords: true, metadata: true, tags: true,
  thumbnail: true, longform: true, shorts: true, publish: true,
};

type Mode = "wizard" | "blocks";

function ProjectPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject({ data: { id } }),
  });

  const [mode, setMode] = useState<Mode>("wizard");
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("re:mode")) as Mode | null;
    if (saved === "wizard" || saved === "blocks") setMode(saved);
  }, []);

  // Warm the ffmpeg core in the background so the first render doesn't pay
  // the ~25 MB core-load cost synchronously.
  useEffect(() => { warmupFFmpeg(); }, []);

  function setModePersist(m: Mode) {
    setMode(m);
    try { localStorage.setItem("re:mode", m); } catch {/* ignore */}
  }

  const project = data?.project;
  const sections = data?.sections ?? [];
  const isCompilation =
    project?.kind === "compilation_video" || project?.kind === "compilation_playlist";
  const VISIBLE_SECTIONS = isCompilation
    ? SECTIONS.filter((s) => s.key !== "analysis" && s.key !== "track")
    : SECTIONS;
  const analysisRow = sections.find((s) => s.section === "analysis");
  const keywordsRow = sections.find((s) => s.section === "keywords");
  const metadataRow = sections.find((s) => s.section === "metadata");
  const compilationKeywordsEnsuredRef = useRef(false);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["project", id] });
  }

  // Auto-generate keywords + metadata once per project per session, after analysis is ready.
  const autoRanRef = useRef<{ analysis: boolean; keywords: boolean; metadata: boolean }>({ analysis: false, keywords: false, metadata: false });
  useEffect(() => {
    if (!project) return;
    // Hard stop: if the post-upload auto-chain already ran for this project,
    // never re-trigger it on revisit. Saves YouTube API quota and AI credits.
    if (project.auto_chain_ran_at) return;
    // If the upload-time analyzeAudio call missed (page opened mid-upload, or
    // user navigated away before it finished), kick it off here exactly once.
    if (
      !isCompilation &&
      project.primary_audio_path &&
      !analysisRow?.data &&
      !autoRanRef.current.analysis
    ) {
      autoRanRef.current.analysis = true;
      analyzeAudio({ data: { projectId: project.id } })
        .then(() => refresh())
        .catch((e) => console.error("auto-analyze failed", e));
      return;
    }
    if (!isCompilation && !analysisRow?.data) return;
    (async () => {
      try {
        if (!keywordsRow && !autoRanRef.current.keywords) {
          autoRanRef.current.keywords = true;
          if (isCompilation) {
            await ensureCompilationKeywords({ data: { projectId: project.id } });
            refresh();
          } else {
            const { seeds } = await suggestKeywordSeeds({ data: { projectId: project.id } });
            if (seeds?.length) {
              // Auto-chain only researches 6 keywords to stay well under daily
              // YouTube quota. User can run all 15 manually from the section.
              await researchKeywords({ data: { projectId: project.id, seeds: seeds.slice(0, 6) } });
              refresh();
            }
          }
        }
        if (!metadataRow && !autoRanRef.current.metadata) {
          autoRanRef.current.metadata = true;
          await generateMetadata({ data: { projectId: project.id } });
          refresh();
        }
        // Persist that the chain ran — even partial — so we never re-run on revisit.
        await markAutoChainRan({ data: { projectId: project.id } }).catch(() => {});
        refresh();
      } catch (e) {
        // silent — user can still click Generate manually
        console.error("auto-generate failed", e);
        // Still mark as ran so failures (e.g. quota) don't loop on every visit.
        await markAutoChainRan({ data: { projectId: project.id } }).catch(() => {});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.auto_chain_ran_at, !!analysisRow?.data, !!keywordsRow, !!metadataRow]);

  // Older saved compilations can have an empty/missing keyword pool because
  // they do not run analysis. Rebuild once on load so the wizard opens with the
  // combined Keywords/tags from its member tracks even if auto-chain already ran.
  useEffect(() => {
    if (!project || !isCompilation || compilationKeywordsEnsuredRef.current) return;
    const seeds = Array.isArray((keywordsRow?.data as any)?.seeds) ? (keywordsRow?.data as any).seeds : [];
    if (seeds.length > 0) return;
    compilationKeywordsEnsuredRef.current = true;
    ensureCompilationKeywords({ data: { projectId: project.id } })
      .then(() => refresh())
      .catch((e) => console.error("compilation keyword rebuild failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, isCompilation, (keywordsRow?.data as any)?.generatedAt]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link to="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All projects
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--accent)]">Release</p>
          {isLoading || !project ? (
            <h1 className="mt-2 truncate font-display text-4xl">Loading…</h1>
          ) : (
            <EditableTitle project={project} refresh={refresh} />
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Wizard walks you through every step. Blocks lets you jump anywhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {project && <IdentityPicker project={project} refresh={refresh} />}
          <div className="flex rounded-full border border-border bg-card/60 p-1 text-xs">
            <button
              onClick={() => setModePersist("wizard")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
                mode === "wizard" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" /> Wizard
            </button>
            <button
              onClick={() => setModePersist("blocks")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
                mode === "blocks" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Blocks
            </button>
          </div>
          <Button>Publish everywhere</Button>
          {project && project.status !== "published" && (
            <DeleteDraftButton projectId={project.id} title={project.title} />
          )}
        </div>
      </header>

      {/* Progress dots (wizard) */}
      {mode === "wizard" && (
        <div className="mt-8 flex flex-wrap items-center gap-1.5">
          {VISIBLE_SECTIONS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setStepIdx(i)}
              className={`h-1.5 flex-1 min-w-6 rounded-full transition-all ${
                i === stepIdx ? "bg-[color:var(--accent)]" : i < stepIdx ? "bg-foreground/40" : "bg-border"
              }`}
              title={s.title}
            />
          ))}
        </div>
      )}

      {mode === "wizard" ? (
        <WizardView
          stepIdx={stepIdx}
          setStepIdx={setStepIdx}
          project={project}
          analysisRow={analysisRow}
          refresh={refresh}
          sections={VISIBLE_SECTIONS}
        />
      ) : (
        <BlocksView
          project={project}
          analysisRow={analysisRow}
          refresh={refresh}
          sections={VISIBLE_SECTIONS}
        />
      )}
    </div>
  );
}

function WizardView({
  stepIdx, setStepIdx, project, analysisRow, refresh, sections,
}: {
  stepIdx: number;
  setStepIdx: (n: number) => void;
  project: any;
  analysisRow: any;
  refresh: () => void;
  sections: SectionDef[];
}) {
  const def = sections[Math.min(stepIdx, sections.length - 1)];
  return (
    <SectionSaveProvider>
      {(runSave) => {
        const approve = async () => {
          await runSave();
          setStepIdx(stepIdx + 1);
        };
        const actions = (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button size="lg" disabled={stepIdx === sections.length - 1} onClick={approve} className="h-12 px-7 text-base font-semibold shadow-[var(--shadow-glow)]">
              Approve & continue <ChevronRight className="ml-1 h-5 w-5" />
            </Button>
          </div>
        );
        return (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_220px]">
            <div className="rounded-2xl border border-border bg-card/60 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
                    <def.icon className="h-5 w-5 text-[color:var(--accent)]" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                      Step {stepIdx + 1} of {sections.length}
                    </p>
                    <h2 className="font-display text-2xl">{def.title}</h2>
                  </div>
                </div>
                {actions}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{def.blurb}</p>

              <div className="mt-6">
                <SectionContent sectionKey={def.key} project={project} analysisRow={analysisRow} refresh={refresh} />
              </div>

              <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
                <p className="text-xs text-muted-foreground">
                  Step {stepIdx + 1} of {sections.length} · {def.title}
                </p>
                {actions}
              </div>
            </div>

      <aside className="rounded-2xl border border-border bg-card/40 p-3">
        <p className="px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Jump to</p>
        <ul className="mt-1 space-y-0.5">
          {sections.map((s, i) => (
            <li key={s.key}>
              <button
                onClick={() => setStepIdx(i)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  i === stepIdx ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.title}
              </button>
            </li>
          ))}
        </ul>
            </aside>
          </div>
        );
      }}
    </SectionSaveProvider>
  );
}

function BlocksView({
  project, analysisRow, refresh, sections,
}: { project: any; analysisRow: any; refresh: () => void; sections: SectionDef[] }) {
  const [open, setOpen] = useState<SectionKey | null>(null);
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => {
        const isOpen = open === s.key;
        const ready = READY[s.key];
        return (
          <div
            key={s.key}
            className={`group relative flex flex-col rounded-xl border bg-card/60 p-5 transition-colors ${
              isOpen ? "border-[color:var(--accent)]/60 sm:col-span-2 lg:col-span-3" : "border-border hover:border-[color:var(--accent)]/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
                <s.icon className="h-5 w-5 text-[color:var(--accent)]" />
              </div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {ready ? "Ready" : "Coming soon"}
              </span>
            </div>
            <h3 className="mt-4 font-display text-lg">{s.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{s.blurb}</p>
            <Button
              variant={ready ? (isOpen ? "default" : "outline") : "ghost"}
              size="sm"
              className="mt-4 w-full justify-center"
              disabled={!ready}
              onClick={() => setOpen(isOpen ? null : s.key)}
            >
              {!ready ? (<><Lock className="mr-1.5 h-3.5 w-3.5" /> Coming next</>) : isOpen ? "Close" : "Open"}
            </Button>
            {isOpen && (
              <div className="mt-5 border-t border-border pt-5">
                <SectionContent sectionKey={s.key} project={project} analysisRow={analysisRow} refresh={refresh} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionContent({
  sectionKey, project, analysisRow, refresh,
}: { sectionKey: SectionKey; project: any; analysisRow: any; refresh: () => void }) {
  if (!project) return <p className="text-sm text-muted-foreground">Loading…</p>;
  switch (sectionKey) {
    case "track":      return <TrackSection project={project} />;
    case "analysis":   return <AnalysisSection project={project} row={analysisRow} refresh={refresh} />;
    case "keywords":   return <KeywordsSection project={project} refresh={refresh} />;
    case "metadata":   return <MetadataSection project={project} refresh={refresh} />;
    case "tags":       return <TagsSection project={project} refresh={refresh} />;
    case "thumbnail":  return <ArtworkSection project={project} refresh={refresh} />;
    case "longform":   return <LongformSection project={project} refresh={refresh} />;
    case "shorts":     return <ShortsSection project={project} refresh={refresh} />;
    case "publish":    return <PublishSection project={project} />;
    default:           return <ComingSoon name={SECTIONS.find((s) => s.key === sectionKey)!.title} />;
  }
}

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center">
      <Lock className="mx-auto h-5 w-5 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="text-foreground">{name}</span> is wired up in the next phase.
      </p>
    </div>
  );
}

function TrackSection({ project }: { project: any }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!project.primary_audio_path) return;
      const { data } = await supabase.storage
        .from("audio")
        .createSignedUrl(project.primary_audio_path, 60 * 60);
      if (active) setUrl(data?.signedUrl ?? null);
    })();
    return () => { active = false; };
  }, [project.primary_audio_path]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-lg border border-border bg-background">
          <Music className="h-5 w-5 text-[color:var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base">{project.title}</p>
          <p className="text-xs text-muted-foreground">
            {project.duration_sec ? `${Math.floor(project.duration_sec / 60)}:${String(Math.floor(project.duration_sec % 60)).padStart(2, "0")}` : "—"}
            {" · "}
            {project.primary_audio_path?.split("/").pop()}
          </p>
        </div>
      </div>
      {url ? (
        <audio src={url} controls className="w-full" />
      ) : (
        <p className="text-xs text-muted-foreground">Loading audio…</p>
      )}
    </div>
  );
}

function AnalysisSection({ project, row, refresh }: { project: any; row: any; refresh: () => void }) {
  const analysis = (row?.data ?? null) as null | {
    genre: string; niche: string; key: string; bpm: number | null;
    mood: string; productionNotes: string; vocalNotes: string;
  };
  const [draft, setDraft] = useState(analysis);
  useEffect(() => { setDraft(analysis); }, [row?.id]);

  const run = useMutation({
    mutationFn: (steering: string) => analyzeAudio({ data: { projectId: project.id, steering: steering || undefined } }),
    onSuccess: () => { toast.success("Analysis ready"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () => updateAnalysis({ data: { projectId: project.id, patch: draft ?? {} } }),
    onSuccess: () => { toast.success("Saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Approve & continue (wizard) also flushes pending edits.
  useRegisterSectionSave(draft ? () => save.mutateAsync() : null);

  const hasAudio = !!project.primary_audio_path;
  const lufs: number | null = (project.integrated_lufs ?? null) as number | null;
  const tp: number | null = (project.true_peak_dbtp ?? null) as number | null;

  return (
    <div className="space-y-5">
      {!analysis && hasAudio && (
        <div className="rounded-xl border border-dashed border-[color:var(--accent)]/40 bg-background/40 p-6 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-[color:var(--accent)]" />
          <p className="mt-2 text-sm text-muted-foreground">Listening to your track and breaking it down…</p>
        </div>
      )}
      {analysis && (
        <div className="rounded-2xl border border-[color:var(--accent)]/30 bg-gradient-to-br from-[color:var(--accent)]/10 via-card/40 to-card/40 p-6">
          <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Detected by AI</p>
          <div className="mt-3 grid gap-3 grid-cols-3">
            <StatCard label="Genre" value={analysis.genre || "—"} />
            <StatCard label="BPM" value={analysis.bpm != null ? String(analysis.bpm) : "—"} />
            <StatCard label="Key" value={analysis.key || "—"} />
          </div>
          <div className="mt-3 grid gap-3 grid-cols-1">
            <WideStatCard label="Mood" value={analysis.mood || "—"} />
            <WideStatCard label="Niche" value={analysis.niche || "—"} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Keyword research, titles, tags, description and artwork are all built from this analysis. Re-analyze any time to steer the rest of the release.
          </p>
        </div>
      )}

      {(lufs != null || tp != null) && (
        <LoudnessCard lufs={lufs} truePeak={tp} />
      )}

      <DirectionComposer
        storageKey={`re:dir:analysis:${project.id}`}
        label={analysis ? "Re-direct the analysis" : "Direct the analysis"}
        placeholder={hasAudio
          ? 'Tell the AI what to focus on — e.g. "Brand this as drill, not trap" or "Focus on the drum pocket and sample sources."'
          : "Upload an audio file first."}
        busy={run.isPending}
        hasPayload={!!analysis}
        onSubmit={(d) => hasAudio && run.mutate(d)}
      />

      {!draft ? (
        <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
          No analysis yet. Click <span className="text-foreground">Analyze track</span> to have Gemini listen and break it down.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Genre" value={draft.genre} onChange={(v) => setDraft({ ...draft!, genre: v })} />
          <Field label="Niche / subgenre" value={draft.niche} onChange={(v) => setDraft({ ...draft!, niche: v })} />
          <Field label="Key" value={draft.key} onChange={(v) => setDraft({ ...draft!, key: v })} />
          <Field
            label="BPM"
            value={draft.bpm?.toString() ?? ""}
            onChange={(v) => setDraft({ ...draft!, bpm: v ? Number(v) : null })}
          />
          <Field label="Mood" value={draft.mood} onChange={(v) => setDraft({ ...draft!, mood: v })} className="sm:col-span-2" />
          <Area label="Production notes" value={draft.productionNotes} onChange={(v) => setDraft({ ...draft!, productionNotes: v })} className="sm:col-span-2" />
          <Area label="Vocal performance" value={draft.vocalNotes} onChange={(v) => setDraft({ ...draft!, vocalNotes: v })} className="sm:col-span-2" />
          <div className="sm:col-span-2 flex justify-end">
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save edits
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Area({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</Label>
      <Textarea rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function useSection<T = any>(projectId: string, section: string): T | null {
  const { data } = useQuery({ queryKey: ["project", projectId], queryFn: () => getProject({ data: { id: projectId } }) });
  const row = data?.sections?.find((s: any) => s.section === section);
  return (row?.data as T) ?? null;
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="ghost" size="sm" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setDone(true); setTimeout(() => setDone(false), 1200);
    }}>
      {done ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />} {done ? "Copied" : label}
    </Button>
  );
}

function KeywordsSection({ project, refresh }: { project: any; refresh: () => void }) {
  const payload = useSection<KeywordsPayload>(project.id, "keywords");
  const analysis = useSection<any>(project.id, "analysis");
  const musicStats = useSection<YoutubeMusicPayload>(project.id, "music_stats");
  const isCompilation = project?.kind === "compilation_video" || project?.kind === "compilation_playlist";
  const keywordLimit = isCompilation ? 30 : 15;
  const [seeds, setSeeds] = useState<string[]>([]);
  const [newSeed, setNewSeed] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [opps, setOpps] = useState<KeywordOpportunity[]>([]);

  function notifyKeywordResult(d: KeywordsPayload) {
    if (d.quotaExhausted) {
      toast.error("YouTube daily quota exhausted", {
        description: "Resets at midnight Pacific. Results below are reused from prior runs where possible.",
      });
      return;
    }
    const failedCount = d.failedSeeds?.length ?? 0;
    if (failedCount > 0) {
      toast.warning(`${failedCount} of ${d.seeds.length} Keywords need a retry`, {
        description: "Every Keyword is still shown in the report. Retry the failed rows when the temporary YouTube issue clears.",
      });
      return;
    }
    toast.success("Keyword research ready");
  }

  // Hydrate chip list once from saved payload.
  useEffect(() => {
    if (!payload) return;
    const incoming = payload.seeds ?? [];
    // For compilations, an empty shell can be replaced by the async combined
    // keyword rebuild after this section mounted — pull those new seeds in.
    if (!hydrated || (isCompilation && incoming.length > 0 && seeds.length === 0)) {
      setSeeds(incoming);
      setHydrated(true);
    }
  }, [payload?.generatedAt, payload?.seeds, hydrated, isCompilation, seeds.length]);

  // Persist any keyword pool edit (add/remove/opps-pick) immediately so the
  // pool is the single source of truth for every downstream step (metadata,
  // tags, artwork). Debounced so rapid edits collapse into one write.
  useEffect(() => {
    if (!hydrated) return;
    if (!payload) return;
    const norm = (a: string[]) => a.map((s) => s.trim().toLowerCase()).join("|");
    if (norm(seeds) === norm(payload.seeds ?? [])) return;
    const t = setTimeout(() => {
      updateKeywords({ data: { projectId: project.id, payload: { ...payload, seeds } } })
        .then(refresh)
        .catch(() => {/* surfaced by row-level mutations */});
    }, 500);
    return () => clearTimeout(t);
  }, [seeds, hydrated, payload, project.id, refresh]);

  const suggest = useMutation({
    mutationFn: (steering: string) => suggestKeywordSeeds({ data: { projectId: project.id, steering: steering || undefined } }),
    onSuccess: (d) => {
      setSeeds(d.seeds);
      setHydrated(true);
      toast.success(`Suggested ${d.seeds.length} Keywords from your analysis`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const run = useMutation({
    mutationFn: (args?: { keywords?: string[]; forceRefresh?: boolean }) => researchKeywords({
      data: {
        projectId: project.id,
        seeds: (args?.keywords ?? seeds).slice(0, keywordLimit),
        forceRefresh: args?.forceRefresh,
      },
    }),
    onSuccess: (d) => { notifyKeywordResult(d); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const discover = useMutation({
    mutationFn: (steering: string) => discoverKeywordOpportunities({ data: { projectId: project.id, steering: steering || undefined } }),
    onSuccess: (d) => { setOpps(d.opportunities ?? []); toast.success(`Found ${d.opportunities?.length ?? 0} opportunities`); },
    onError: (e: Error) => toast.error(e.message),
  });

  // One-click: suggest Keywords from analysis and immediately run research.
  const generateFromAnalysis = useMutation({
    mutationFn: async () => {
      if (isCompilation) {
        const rebuilt = await ensureCompilationKeywords({ data: { projectId: project.id } });
        setSeeds(rebuilt.seeds ?? []);
        setHydrated(true);
        return rebuilt as KeywordsPayload;
      }
      const { seeds: suggested } = await suggestKeywordSeeds({ data: { projectId: project.id } });
      if (!suggested?.length) throw new Error("Could not suggest Keywords from analysis");
      setSeeds(suggested);
      setHydrated(true);
      return researchKeywords({ data: { projectId: project.id, seeds: suggested.slice(0, 15) } });
    },
    onSuccess: (d) => { isCompilation ? toast.success("Compilation Keywords combined") : notifyKeywordResult(d); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pullMusicStats = useMutation({
    mutationFn: () => {
      const terms = (payload?.rows ?? []).filter((r) => !r.failed).slice(0, 10).map((r) => r.term);
      if (!terms.length) throw new Error("Run keyword research first");
      return researchMusicStats({ data: { projectId: project.id, terms } });
    },
    onSuccess: () => { toast.success("YouTube Music outlook ready"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function addSeed() {
    const v = newSeed.trim();
    if (!v) return;
    if (seeds.some((s) => s.toLowerCase() === v.toLowerCase())) { setNewSeed(""); return; }
    if (seeds.length >= keywordLimit) { toast.error(`Max ${keywordLimit} Keywords`); return; }
    setSeeds([...seeds, v]);
    setNewSeed("");
  }
  function removeSeed(s: string) { setSeeds(seeds.filter((x) => x !== s)); }

  function removeRow(term: string) {
    if (!payload) return;
    // Keep the keyword pool in sync — dropping a row also drops it from the
    // pool, so the next title/tag/artwork generation does not see it again.
    setSeeds((prev) => prev.filter((s) => s.toLowerCase() !== term.toLowerCase()));
    const next: KeywordsPayload = {
      ...payload,
      seeds: (payload.seeds ?? []).filter((s) => s.toLowerCase() !== term.toLowerCase()),
      rows: payload.rows.filter((r) => r.term !== term),
      failedSeeds: payload.failedSeeds?.filter((s) => s.toLowerCase() !== term.toLowerCase()),
    };
    updateKeywords({ data: { projectId: project.id, payload: next } }).then(refresh);
  }

  function downloadCsv() {
    if (!payload) return;
    const header = "term,demandScore,estMonthlySearches,avgViews,topChannelSubs,competition,opportunity,status";
    const lines = payload.rows.map((r) => [
      r.term, (r as any).demandScore ?? "", (r as any).estMonthlySearches ?? "",
      r.avgViews, r.topChannelSubs, r.competition, r.opportunity, r.failed ? "failed" : "researched",
    ].join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.title}-keywords.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  const failedKeywords = payload?.failedSeeds?.length
    ? payload.failedSeeds
    : (payload?.rows ?? []).filter((r) => r.failed).map((r) => r.term);

  const quotaHit = payload?.quotaExhausted || (payload?.rows ?? []).some((r) =>
    r.failedReason?.code === "quota" || (r.failed && r.failedReason?.status === 429),
  );
  const combinedCandidates = isCompilation
    ? (((payload as any)?.combinedCandidates ?? []) as string[]).filter(Boolean)
    : [];
  const availableCombinedCandidates = combinedCandidates.filter(
    (term) => !seeds.some((seed) => seed.toLowerCase() === term.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <GenerateFromResearchCard
        title={isCompilation ? "Refresh combined compilation Keywords" : payload ? "Regenerate Keywords from your analysis" : "Generate Keywords from your analysis"}
        description={isCompilation ? "Combines Keywords and tags from every track in this compilation into one curated pool." : "Suggests Keywords from your detected music, then runs YouTube research in one shot."}
        buttonLabel={isCompilation ? "Rebuild from Tracks" : payload ? "Regenerate from Research" : "Generate from Research"}
        busy={generateFromAnalysis.isPending}
        disabled={!analysis && !isCompilation}
        disabledHint="Run Music analysis first — Keywords come from the detected genre and niche."
        onClick={() => generateFromAnalysis.mutate()}
      />

      {/* Analysis context strip — larger, accent-coloured chips */}
      <div className="rounded-xl border border-[color:var(--accent)]/30 bg-gradient-to-br from-[color:var(--accent)]/10 via-background/40 to-background/40 px-5 py-4">
        {analysis ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] uppercase tracking-[0.25em] text-[color:var(--accent)]">From analysis</span>
            {analysis.genre && <span className="rounded-full border border-[color:var(--accent)]/50 bg-[color:var(--accent)]/15 px-3 py-1 text-sm font-semibold text-foreground">{analysis.genre}</span>}
            {analysis.niche && <span className="rounded-full border border-[color:var(--accent)]/50 bg-[color:var(--accent)]/10 px-3 py-1 text-sm font-semibold text-foreground">{analysis.niche}</span>}
            {analysis.mood && <span className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-sm text-foreground">{analysis.mood}</span>}
            {analysis.bpm != null && <span className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-sm text-foreground">{analysis.bpm} bpm</span>}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Run <span className="text-foreground">Music analysis</span> first — Keywords are derived from your track's detected genre and niche.</span>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h3 className="font-display text-xl font-semibold tracking-tight bg-[image:var(--gradient-accent-text)] bg-clip-text text-transparent">
            My Keywords and Tags
          </h3>
          <span className="text-xs text-muted-foreground">{seeds.length}/{keywordLimit}</span>
        </div>
        {seeds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No Keywords yet. Click <span className="text-foreground">{isCompilation ? "Rebuild from Tracks" : "Generate from analysis"}</span> or add your own below.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {seeds.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-3.5 py-1.5 text-sm font-semibold text-foreground shadow-sm">
                {s}
                <button onClick={() => removeSeed(s)} aria-label={`Remove ${s}`} className="opacity-60 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        {isCompilation && availableCombinedCandidates.length > 0 && (
          <div className="rounded-xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Available from tracks</p>
                <p className="text-xs text-muted-foreground">Pick any combined Keywords/tags from the source tracks, up to {keywordLimit} selected.</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {availableCombinedCandidates.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => {
                    if (seeds.length >= keywordLimit) return toast.error(`Max ${keywordLimit} Keywords`);
                    setSeeds([...seeds, term]);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent)]/35 bg-background/40 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-[color:var(--accent)] hover:bg-[color:var(--accent)]/10"
                >
                  <Plus className="h-3 w-3 text-[color:var(--accent)]" />
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Input value={newSeed} onChange={(e) => setNewSeed(e.target.value)} placeholder="Add your own Keyword (e.g. moody trap loop 140 bpm)"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSeed(); } }} />
          <Button variant="outline" onClick={addSeed}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {payload && <Button variant="outline" size="sm" onClick={downloadCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>}
          <Button variant="outline" size="sm" onClick={() => discover.mutate("")} disabled={discover.isPending || !analysis}>
            {discover.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-1.5 h-4 w-4" />}
            Discover opportunities
          </Button>
          {failedKeywords.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => run.mutate({ keywords: failedKeywords })} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
              Retry failed Keywords
            </Button>
          )}
          <Button onClick={() => run.mutate({ keywords: seeds, forceRefresh: true })} disabled={run.isPending || seeds.length === 0}>
            {run.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            {payload ? "Re-run research" : "Run research"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This is your release's <span className="text-foreground">central keyword pool</span>. Every add, remove, opportunity pick, or row deletion is saved here automatically and flows into your title, description, tags and artwork the next time you generate.
        </p>
      </div>

      {opps.length > 0 && (
        <div className="rounded-lg border border-[color:var(--accent)]/40 bg-card/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--accent)]">New opportunities</p>
            <Button variant="ghost" size="sm" onClick={() => setOpps([])}><X className="h-3.5 w-3.5" /></Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Click any to add as a Keyword. Then re-run research.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {opps.map((o) => (
              <button key={o.term}
                onClick={() => { if (seeds.length >= keywordLimit) return toast.error(`Max ${keywordLimit} Keywords`); if (!seeds.includes(o.term)) setSeeds([...seeds, o.term]); }}
                className="group inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent)]/30 bg-background/40 px-2.5 py-1 text-xs hover:border-[color:var(--accent)] hover:bg-[color:var(--accent)]/10"
                title={o.why}>
                <Plus className="h-3 w-3 text-[color:var(--accent)]" />
                {o.term}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Re-direct composer sits BELOW the keyword pool so users curate first, then steer */}
      <DirectionComposer
        storageKey={`re:dir:keywords:${project.id}`}
        label={seeds.length ? "Re-direct Keywords" : "Direct keyword research"}
        placeholder={analysis
          ? 'e.g. "Focus on type-beat searches and sleep playlists." Sent to the AI to re-suggest Keywords from your analysis.'
          : "Run analysis first — Keywords come from the detected genre and niche."}
        busy={suggest.isPending}
        hasPayload={seeds.length > 0}
        onSubmit={(d) => analysis && suggest.mutate(d)}
      />

      {quotaHit && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <p className="font-medium">YouTube quota is blocking research</p>
          <p className="mt-1 text-rose-200/80">
              The YouTube Data API is out of Search Queries for today. It resets at midnight Pacific; retrying before then will keep failing. Any prior successful rows are preserved below.
          </p>
        </div>
      )}

      {payload && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Keyword</th>
                <th className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-1" title="0–100 blend of top-10 view counts, recency, and engagement. Higher = more proven, active demand.">
                    Demand <Info className="h-3 w-3 opacity-60" />
                  </span>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-1" title="Approximate monthly YouTube searches, estimated from top-10 views over recency using a ~6% CTR heuristic. Snapped to standard bands.">
                    Est. searches/mo <Info className="h-3 w-3 opacity-60" />
                  </span>
                </th>
                <th className="px-3 py-2 text-right">Avg views (top 10)</th>
                <th className="px-3 py-2 text-right">Top channel subs</th>
                <th className="px-3 py-2 text-center">Competition</th>
                <th className="px-3 py-2 text-right">Opportunity</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((r) => (
                <tr key={r.term} className={`border-t border-border ${r.failed ? "bg-amber-500/5 text-muted-foreground" : ""}`}>
                  <td className="px-3 py-2 font-medium">
                    <div className="flex flex-col gap-1">
                      <span className={r.failed ? "text-amber-200" : undefined}>{r.term}</span>
                      {r.failed && <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300/80">Needs retry</span>}
                      {r.failedReason?.message && (
                        <span className="max-w-xs text-xs font-normal text-muted-foreground">{r.failedReason.message}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{(r as any).demandScore ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{((r as any).estMonthlySearches ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.avgViews.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.topChannelSubs.toLocaleString()}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      r.competition === "low" ? "bg-emerald-500/15 text-emerald-300"
                      : r.competition === "medium" ? "bg-amber-500/15 text-amber-300"
                      : "bg-rose-500/15 text-rose-300"}`}>{r.competition}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[color:var(--accent)]">{r.opportunity}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.failed && (
                        <Button variant="outline" size="sm" onClick={() => run.mutate({ keywords: [r.term] })} disabled={run.isPending}>
                          Retry
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => removeRow(r.term)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* YouTube Music outlook — Distro-Kid streaming potential */}
      {payload && (payload.rows?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-border bg-card/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">YouTube Music outlook</p>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg">Distro-Kid Streaming Potential</h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#ff5500]/40 bg-[#ff5500]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ff8a3d]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#ff5500]" />
                  + SoundCloud distribution
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Measures how much of each keyword's top traffic is going through YouTube Music (Topic channels + category 10). Higher = more royalties on distribution.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => pullMusicStats.mutate()} disabled={pullMusicStats.isPending}>
              {pullMusicStats.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Music className="mr-1.5 h-4 w-4" />}
              {musicStats ? "Refresh Music stats" : "Pull Music stats"}
            </Button>
          </div>
          {musicStats && (
            <TooltipProvider delayDuration={150}>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Keyword</th>
                    <th className="px-3 py-2 text-right">
                      <Tooltip><TooltipTrigger className="inline-flex items-center gap-1 cursor-help">Music % <Info className="h-3 w-3" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">Share of the top 10 results for this keyword that YouTube classifies in the Music category. Higher means the keyword surfaces real music, not vlogs or tutorials.</TooltipContent></Tooltip>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <Tooltip><TooltipTrigger className="inline-flex items-center gap-1 cursor-help">Topic % <Info className="h-3 w-3" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">Share of top results uploaded to auto-generated "Artist - Topic" channels. These are the uploads that funnel through YouTube Music and pay distribution royalties.</TooltipContent></Tooltip>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <Tooltip><TooltipTrigger className="inline-flex items-center gap-1 cursor-help">Avg plays <Info className="h-3 w-3" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">Average lifetime view count across the music-category top 10 for this keyword. A read on how big the niche gets at the top end.</TooltipContent></Tooltip>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <Tooltip><TooltipTrigger className="inline-flex items-center gap-1 cursor-help">Est. plays/mo <Info className="h-3 w-3" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">Banded estimate of monthly YouTube Music plays this keyword can deliver, derived from the average view count and Music-category share.</TooltipContent></Tooltip>
                    </th>
                    <th className="px-3 py-2 text-center">
                      <Tooltip><TooltipTrigger className="inline-flex items-center gap-1 cursor-help">Distro-Kid payable <Info className="h-3 w-3" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">Marked Yes when at least 40% of top results are Topic-channel uploads OR the keyword is projected to generate over 500,000 monthly Music plays — both surfaces pay through distributors like DistroKid.</TooltipContent></Tooltip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {musicStats.rows.map((r) => {
                    const payable = r.distroPayable || r.estMonthlyMusicPlays >= 500_000;
                    return (
                    <tr key={r.term} className={`border-t border-border ${r.failed ? "text-muted-foreground" : ""}`}>
                      <td className="px-3 py-2 font-medium">{r.term}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.musicShare * 100)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.topicShare * 100)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.avgMusicViews.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.estMonthlyMusicPlays.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${payable ? "bg-emerald-500/15 text-emerald-300" : "bg-secondary/60 text-muted-foreground"}`}>
                          {payable ? "Yes" : "Low"}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </TooltipProvider>
          )}
        </div>
      )}

      {failedKeywords.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {failedKeywords.length} Keyword{failedKeywords.length === 1 ? "" : "s"} could not be researched yet. They are still shown in the report so nothing disappears.
            </p>
            <Button variant="outline" size="sm" onClick={() => run.mutate({ keywords: failedKeywords })} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
              Retry failed Keywords
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}

function MetadataSection({ project, refresh }: { project: any; refresh: () => void }) {
  const payload = useSection<MetadataPayload>(project.id, "metadata");
  const [draft, setDraft] = useState<MetadataPayload | null>(payload);
  useEffect(() => { setDraft(payload); }, [payload?.selectedTitle]);

  const run = useMutation({
    mutationFn: (steering: string) => generateMetadata({ data: { projectId: project.id, steering: steering || undefined } }),
    onSuccess: (d) => { toast.success("Metadata ready"); setDraft(d); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: () => updateMetadata({ data: { projectId: project.id, payload: draft! } }),
    onSuccess: () => { toast.success("Saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  useRegisterSectionSave(draft ? () => save.mutateAsync() : null);

  return (
    <div className="space-y-5">
      <GenerateFromResearchCard
        title={payload ? "Regenerate title & description from Research" : "Generate title & description from Research"}
        description="Writes 5 title candidates, a YouTube-ready description, tags and hashtags using your analysis and top-performer research."
        buttonLabel={payload ? "Regenerate from Research" : "Generate from Research"}
        busy={run.isPending}
        onClick={() => run.mutate("")}
      />
      <DirectionComposer
        storageKey={`re:dir:metadata:${project.id}`}
        label={payload ? "Re-direct title & description" : "Direct title & description"}
        placeholder='e.g. "Lean into nostalgia, mention the sample, no emojis." Description always mirrors the format of top-performing videos in your niche.'
        busy={run.isPending}
        hasPayload={!!payload}
        onSubmit={(d) => run.mutate(d)}
      />
      {draft && (
        <div className="space-y-4">
          <div>
            <h3 className="font-display text-3xl font-semibold tracking-tight bg-[image:var(--gradient-accent-text)] bg-clip-text text-transparent">
              Title Candidates
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Click one to set it as your selected title.</p>
            <div className="mt-3 space-y-2">
              {draft.titles.map((t, i) => (
                <button key={i}
                  onClick={() => setDraft({ ...draft, selectedTitle: t })}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3.5 text-left text-base font-semibold transition-colors ${
                    draft.selectedTitle === t ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10 shadow-[var(--shadow-glow)]" : "border-border hover:border-[color:var(--accent)]/60"
                  }`}>
                  <span>{t}</span>
                  {draft.selectedTitle === t && <Star className="h-4 w-4 text-[color:var(--accent)]" />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Description</Label>
              <CopyBtn text={draft.description} />
            </div>
            <Textarea rows={10} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="mt-2" />
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save edits
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TagsSection({ project, refresh }: { project: any; refresh: () => void }) {
  const payload = useSection<MetadataPayload>(project.id, "metadata");
  const keywordsPayload = useSection<KeywordsPayload>(project.id, "keywords");
  const [draft, setDraft] = useState<MetadataPayload | null>(payload);
  const [newTag, setNewTag] = useState("");
  useEffect(() => { setDraft(payload); }, [payload?.tags?.length, payload?.hashtags?.length]);

  const save = useMutation({
    mutationFn: () => updateMetadata({ data: { projectId: project.id, payload: draft! } }),
    onSuccess: () => { toast.success("Saved"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  useRegisterSectionSave(draft ? () => save.mutateAsync() : null);
  const regen = useMutation({
    mutationFn: () => generateMetadata({ data: { projectId: project.id } }),
    onSuccess: () => { toast.success("Tags refreshed from research"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!payload) {
    return (
      <GenerateFromResearchCard
        title="Generate tags from Research"
        description="Pulls the top-performing tags in your niche and the keywords you researched into a YouTube-ready tag set."
        busy={regen.isPending}
        onClick={() => regen.mutate()}
      />
    );
  }
  if (!draft) return null;

  function addTag() {
    const t = newTag.trim().toLowerCase().replace(/^#/, "");
    if (!t || draft!.tags.includes(t)) return;
    setDraft({ ...draft!, tags: [...draft!.tags, t] });
    setNewTag("");
  }

  const tagChars = draft.tags.join(",").length;
  const pool = Array.from(new Set([
    ...(keywordsPayload?.seeds ?? []),
    ...(keywordsPayload?.rows ?? []).filter((r) => !r.failed).map((r) => r.term),
  ].map((s) => s.toLowerCase().trim()).filter(Boolean)));
  const poolMissing = pool.filter((t) => !draft.tags.includes(t));
  return (
    <div className="space-y-5">
      <GenerateFromResearchCard
        eyebrow="Refresh"
        title="Regenerate tags from Research"
        description="Re-runs the AI on your latest keyword research and top performers, then merges into your existing tags."
        buttonLabel="Regenerate from Research"
        busy={regen.isPending}
        onClick={() => regen.mutate()}
      />
      {pool.length > 0 && (
        <div className="rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">From your keyword pool</p>
              <p className="text-xs text-muted-foreground">Every keyword you researched and kept. Click to add to tags, or use “Add all” to lock in the pool.</p>
            </div>
            {poolMissing.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, tags: Array.from(new Set([...draft.tags, ...poolMissing])) })}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add all {poolMissing.length}
              </Button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pool.map((t) => {
              const inTags = draft.tags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => !inTags && setDraft({ ...draft, tags: [...draft.tags, t] })}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    inTags
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-[color:var(--accent)]/40 bg-background/40 hover:border-[color:var(--accent)] hover:bg-[color:var(--accent)]/10"
                  }`}
                  disabled={inTags}
                >
                  {inTags ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3 text-[color:var(--accent)]" />}
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">YouTube tags ({tagChars}/500 chars)</Label>
          <CopyBtn text={draft.tags.join(", ")} label="Copy all" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs">
              {t}
              <button onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
          <Button variant="outline" onClick={addTag}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Hashtags</Label>
          <CopyBtn text={draft.hashtags.join(" ")} label="Copy" />
        </div>
        <Input className="mt-2" value={draft.hashtags.join(" ")} onChange={(e) =>
          setDraft({ ...draft, hashtags: e.target.value.split(/\s+/).filter(Boolean).map((h) => h.startsWith("#") ? h : `#${h}`) })} />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save edits
        </Button>
      </div>
    </div>
  );
}

async function uploadOwnImage(projectId: string, kind: "thumbnail" | "cover", file: File) {
  if (file.size > 10 * 1024 * 1024) { toast.error("Image is over 10 MB"); return; }
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) { toast.error("Not signed in"); return; }
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${uid}/${projectId}/own-${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("videos").upload(path, file, { contentType: file.type || "image/png", upsert: true });
  if (error) { toast.error(error.message); return; }
  await useOwnArtwork({ data: { projectId, kind, storagePath: path } });
  toast.success(`${kind === "cover" ? "Album cover" : "Thumbnail"} uploaded`);
}

function ArtworkSection({ project, refresh }: { project: any; refresh: () => void }) {
  const payload = useSection<ArtworkPayload>(project.id, "artwork");
  const keywords = useSection<KeywordsPayload>(project.id, "keywords");
  const refs = payload?.references ?? [];
  const refPaths = refs.map((r) => r.storagePath);

  const genPair = useMutation({
    mutationFn: ({ steering, useResearch }: { steering: string; useResearch: boolean }) =>
      generateArtworkPair({ data: { projectId: project.id, steering: steering || undefined, useResearch, referenceImagePaths: refPaths } }),
    onSuccess: () => { toast.success("Cohesive artwork pair generated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const genThumb = useMutation({
    mutationFn: (steering: string) => generateArtwork({ data: { projectId: project.id, kind: "thumbnail", steering: steering || undefined, referenceImagePaths: refPaths } }),
    onSuccess: () => { toast.success("Thumbnail generated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const genCover = useMutation({
    mutationFn: (steering: string) => generateArtwork({ data: { projectId: project.id, kind: "cover", steering: steering || undefined, referenceImagePaths: refPaths } }),
    onSuccess: () => { toast.success("Album cover generated (3000×3000)"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasResearch = !!(keywords?.rows?.length);

  return (
    <div className="space-y-8">
      {/* Big "Generate from Research" CTA */}
      <GenerateFromResearchCard
        title="Generate cohesive artwork from your Research"
        description="Builds a competitive YouTube thumbnail and a matching 3000×3000 album cover using your top-performing videos, tags, and description as references."
        buttonLabel="Generate from Research"
        busy={genPair.isPending}
        disabled={!hasResearch}
        disabledHint="Run Keyword research first — that's where the visual references come from."
        onClick={() => genPair.mutate({ steering: "", useResearch: true })}
      />

      {/* Direction composer (shared, paired) */}
      <div className="space-y-3">
        <DirectionComposer
          storageKey={`re:dir:art-pair:${project.id}`}
          label="Give your artwork direction"
          placeholder='e.g. "Late-night drive through neon Tokyo, single subject in profile, deep navy + amber palette."'
          busy={genPair.isPending}
          hasPayload={!!payload?.thumbnails?.length || !!payload?.covers?.length}
          onSubmit={(d) => genPair.mutate({ steering: d, useResearch: false })}
        />
        <ImageGenProgress
          active={genPair.isPending}
          label="Composing cohesive thumbnail + cover"
          etaSec={70}
        />
        <p className="text-xs text-muted-foreground">
          The same brief generates the cover + thumbnail together so they're visually cohesive. Use the buttons below to iterate on just one.
        </p>
      </div>

      {/* References */}
      <ArtReferences projectId={project.id} refs={refs} refresh={refresh} />

      {/* ─────────────  YouTube thumbnail (16:9)  ───────────── */}
      <section className="rounded-2xl border-2 border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-[var(--shadow-glow)]">
        <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-14 place-items-center rounded-md border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--accent)]">16:9</div>
            <div>
              <h3 className="font-display text-xl">YouTube thumbnail</h3>
              <p className="text-xs text-muted-foreground">1280×720 · the click-magnet on the YouTube video page</p>
            </div>
          </div>
        </header>
        <ArtGrid
          projectId={project.id}
          composerKey="thumbnail"
          title="Thumbnail iterations"
          variants={payload?.thumbnails ?? []}
          selectedId={payload?.selectedThumbnailId}
          onGenerate={(d) => genThumb.mutate(d)}
          pending={genThumb.isPending}
          aspect="aspect-video"
          placeholder='Iterate on the thumbnail only, e.g. "more contrast, push the subject closer."'
          onSelect={(id) => selectArtwork({ data: { projectId: project.id, kind: "thumbnail", id } }).then(refresh)}
          onUseAsReference={(path) => addArtworkReference({ data: { projectId: project.id, storagePath: path } }).then(refresh)}
          onUploadOwn={(file) => uploadOwnImage(project.id, "thumbnail", file).then(refresh)}
          uploadHint="Upload a 1280×720 (16:9) image to use as your YouTube thumbnail. JPG or PNG, up to 10 MB."
        />
      </section>

      {/* ─────────────  Album cover (1:1)  ───────────── */}
      <section className="rounded-2xl border-2 border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-[var(--shadow-glow)]">
        <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md border border-orange-400/40 bg-orange-400/10 text-[10px] font-semibold uppercase tracking-widest text-orange-300">1:1</div>
            <div>
              <h3 className="font-display text-xl">Album cover</h3>
              <p className="text-xs text-muted-foreground">3000×3000 · DistroKid / Spotify / Apple Music spec</p>
            </div>
          </div>
        </header>
        <ArtGrid
          projectId={project.id}
          composerKey="cover"
          title="Album cover iterations"
          variants={payload?.covers ?? []}
          selectedId={payload?.selectedCoverId}
          onGenerate={(d) => genCover.mutate(d)}
          pending={genCover.isPending}
          aspect="aspect-square"
          placeholder='Iterate on the cover only, e.g. "matte film grain, single subject."'
          onSelect={(id) => selectArtwork({ data: { projectId: project.id, kind: "cover", id } }).then(refresh)}
          onUseAsReference={(path) => addArtworkReference({ data: { projectId: project.id, storagePath: path } }).then(refresh)}
          onUploadOwn={(file) => uploadOwnImage(project.id, "cover", file).then(refresh)}
          uploadHint="Upload a square 3000×3000 image (DistroKid spec). JPG or PNG, up to 10 MB."
        />
      </section>
    </div>
  );
}

function ArtReferences({ projectId, refs, refresh }: { projectId: string; refs: ArtworkPayload["references"]; refresh: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(list: FileList | File[]) {
    const files = Array.from(list).slice(0, 3);
    if (!files.length) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} is over 10 MB`); continue; }
        const ext = (f.name.split(".").pop() || "png").toLowerCase();
        const path = `${uid}/${projectId}/refs/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("videos").upload(path, f, { contentType: f.type || "image/png", upsert: true });
        if (error) { toast.error(error.message); continue; }
        await addArtworkReference({ data: { projectId, storagePath: path } });
      }
      refresh();
      toast.success("References added");
    } finally { setBusy(false); }
  }

  return (
    <div className="relative rounded-2xl border-2 border-[color:var(--accent)]/40 bg-gradient-to-br from-[color:var(--accent)]/10 via-background/40 to-background/40 p-5 shadow-[0_0_40px_-12px_var(--accent)]">
      <div className="pointer-events-none absolute -inset-px rounded-2xl bg-[image:var(--gradient-accent-soft)] opacity-50 blur-xl" aria-hidden />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <h4 className="font-display text-xl font-semibold tracking-tight bg-[image:var(--gradient-accent-text)] bg-clip-text text-transparent">
            Reference Images
          </h4>
          <p className="mt-0.5 text-sm text-muted-foreground">Up to 3 — the AI uses these as visual anchors when generating.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => e.target.files && onFiles(e.target.files)}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1.5 h-4 w-4" />}
            Upload references
          </Button>
        </div>
      </div>
      {(refs?.length ?? 0) > 0 && (
        <div className="relative mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(refs ?? []).map((r) => (
            <RefTile key={r.id} v={r} onRemove={() => removeArtworkReference({ data: { projectId, id: r.id } }).then(refresh)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RefTile({ v, onRemove }: { v: { id: string; storagePath: string }; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("videos").createSignedUrl(v.storagePath, 60 * 60).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [v.storagePath]);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border border-border">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-secondary/30" />}
      <button onClick={onRemove} className="absolute right-1 top-1 rounded-full bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100" aria-label="Remove reference">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function ArtGrid({ projectId, composerKey, title, variants, selectedId, onGenerate, pending, aspect, placeholder, onSelect, onUseAsReference, onUploadOwn, uploadHint }: {
  projectId: string; composerKey: string;
  title: string; variants: ArtworkPayload["thumbnails"]; selectedId?: string;
  onGenerate: (direction: string) => void; pending: boolean;
  aspect: string; placeholder: string; onSelect: (id: string) => void;
  onUseAsReference: (path: string) => void;
  onUploadOwn: (file: File) => Promise<void>;
  uploadHint: string;
}) {
  const ownInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function handleOwnFile(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try { await onUploadOwn(f); } finally { setUploading(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
        <div className="flex items-center gap-2">
          <input
            ref={ownInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { handleOwnFile(e.target.files?.[0]); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" onClick={() => ownInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1.5 h-4 w-4" />}
            Use my own image
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{uploadHint}</p>
      <DirectionComposer
        storageKey={`re:dir:art-${composerKey}:${projectId}`}
        label={variants.length ? `Re-direct ${composerKey}` : `Direct ${composerKey}`}
        placeholder={placeholder}
        busy={pending}
        hasPayload={variants.length > 0}
        onSubmit={(d) => onGenerate(d)}
      />
      <ImageGenProgress active={pending} label={`Generating ${composerKey}`} />
      {variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No images yet — use the buttons above.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {variants.map((v) => (
            <ArtTile
              key={v.id}
              v={v}
              selected={selectedId === v.id}
              aspect={aspect}
              onSelect={() => onSelect(v.id)}
              onUseAsReference={() => onUseAsReference(v.storagePath)}
              filename={`${title.split(" ")[0].toLowerCase()}-${v.id.slice(0, 6)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtTile({ v, selected, aspect, onSelect, onUseAsReference, filename }: { v: { id: string; storagePath: string }; selected: boolean; aspect: string; onSelect: () => void; onUseAsReference: () => void; filename: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("videos").createSignedUrl(v.storagePath, 60 * 60).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [v.storagePath]);
  async function download() {
    if (!url) return;
    try {
      const r = await fetch(url); const blob = await r.blob();
      const a = document.createElement("a");
      const ext = v.storagePath.split(".").pop() || "png";
      a.href = URL.createObjectURL(blob); a.download = `${filename}.${ext}`;
      a.click(); URL.revokeObjectURL(a.href);
    } catch { toast.error("Download failed"); }
  }
  return (
    <div className={`group relative overflow-hidden rounded-lg border ${aspect} ${selected ? "border-[color:var(--accent)] ring-2 ring-[color:var(--accent)]/40" : "border-border hover:border-foreground/40"}`}>
      <button onClick={onSelect} className="block h-full w-full">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-secondary/30" />}
      </button>
      {selected && (
        <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-black">
          <Check className="h-3 w-3" /> Selected
        </span>
      )}
      <div className="absolute inset-x-2 bottom-2 flex justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="secondary" size="sm" className="h-7 text-[11px]" onClick={onUseAsReference}>
          Use as reference
        </Button>
        <Button variant="secondary" size="sm" className="h-7 text-[11px]" onClick={download}>
          <Download className="mr-1 h-3 w-3" /> Download
        </Button>
      </div>
    </div>
  );
}

/* ------------ Header: delete-draft with confirm ------------ */
function DeleteDraftButton({ projectId, title }: { projectId: string; title: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => deleteProject({ data: { id: projectId } }),
    onSuccess: () => {
      toast.success("Draft deleted");
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav({ to: "/projects" });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="mr-1.5 h-4 w-4" /> Delete draft
        </Button>
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

/* ------------ Header: inline-editable title ------------ */
function EditableTitle({ project, refresh }: { project: any; refresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.title as string);
  useEffect(() => { setValue(project.title); }, [project.id, project.title]);

  const m = useMutation({
    mutationFn: () => renameProject({ data: { id: project.id, title: value } }),
    onSuccess: () => { toast.success("Renamed"); setEditing(false); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Input
          autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); m.mutate(); } if (e.key === "Escape") { setValue(project.title); setEditing(false); } }}
          className="h-12 max-w-xl font-display text-3xl"
        />
        <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setValue(project.title); setEditing(false); }}>Cancel</Button>
      </div>
    );
  }
  return (
    <h1 className="mt-2 flex items-center gap-2 truncate font-display text-4xl">
      <span className="truncate">{project.title}</span>
      <button onClick={() => setEditing(true)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Rename track">
        <Pencil className="h-4 w-4" />
      </button>
    </h1>
  );
}

/* ------------ Header: identity picker + create-identity dialog ------------ */
function IdentityPicker({ project, refresh }: { project: any; refresh: () => void }) {
  const { data } = useQuery({ queryKey: ["identities"], queryFn: () => listIdentities() });
  const identities = data?.identities ?? [];
  const current = identities.find((i) => i.id === project.identity_id) || null;
  const [createOpen, setCreateOpen] = useState(false);

  const apply = useMutation({
    mutationFn: (identityId: string | null) => setProjectIdentity({ data: { projectId: project.id, identityId } }),
    onSuccess: () => { toast.success("Identity applied"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex items-center gap-1 rounded-full border border-border bg-card/60 p-1 pl-3 text-xs">
        <UserCircle2 className="h-3.5 w-3.5 text-[color:var(--accent)]" />
        <select
          value={current?.id ?? ""} onChange={(e) => apply.mutate(e.target.value || null)}
          className="bg-transparent text-foreground focus:outline-none"
        >
          <option value="">No identity</option>
          {identities.map((i) => <option key={i.id} value={i.id}>{i.name}{i.is_default ? " ★" : ""}</option>)}
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-1 rounded-full px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Create identity from this release">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <CreateIdentityDialog open={createOpen} onOpenChange={setCreateOpen} project={project} refresh={refresh} />
    </>
  );
}

function CreateIdentityDialog({ open, onOpenChange, project, refresh }: { open: boolean; onOpenChange: (b: boolean) => void; project: any; refresh: () => void }) {
  const [name, setName] = useState(project.title ? `${project.title} identity` : "New identity");
  const [setDefault, setSetDefault] = useState(false);
  useEffect(() => { if (open) setName(project.title ? `${project.title} identity` : "New identity"); }, [open, project.title]);

  const m = useMutation({
    mutationFn: () => createIdentityFromProject({ data: { projectId: project.id, name, setDefault } }),
    onSuccess: () => { toast.success("Identity created from this release"); onOpenChange(false); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an identity from this design or release</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Saves the current tags, description, and selected artwork as a reusable identity. Use it on future releases to prefill everything and keep your visual style consistent.
        </p>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Identity name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} />
          Use as default for new projects
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !name.trim()}>
            {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create identity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Analysis UI ----------------------------- */

function StatCard({ label, value }: { label: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > 28;
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 font-display leading-tight bg-clip-text text-transparent break-words text-2xl md:text-[1.75rem] xl:text-3xl " +
          (expanded ? "" : "line-clamp-2")
        }
        style={{ backgroundImage: "var(--gradient-accent)" }}
        title={value}
      >
        {value}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function WideStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-5">
      <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <p
        className="mt-2 font-display leading-snug bg-clip-text text-transparent break-words text-xl md:text-2xl"
        style={{ backgroundImage: "var(--gradient-accent)" }}
      >
        {value}
      </p>
    </div>
  );
}

// Streaming/UGC platform loudness targets (integrated LUFS).
const LUFS_TARGETS: Array<{ name: string; target: number }> = [
  { name: "YouTube",   target: -14 },
  { name: "Spotify",   target: -14 },
  { name: "Apple Music", target: -16 },
  { name: "Instagram", target: -14 },
  { name: "TikTok",    target: -14 },
];

function LoudnessCard({ lufs, truePeak }: { lufs: number | null; truePeak: number | null }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Streaming loudness</p>
          <h3 className="font-display text-xl">Where this track sits per platform</h3>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-border bg-background/40 px-4 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Integrated</p>
            <p
              className="font-display text-2xl leading-tight bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-accent)" }}
            >
              {lufs != null ? `${lufs.toFixed(1)} LUFS` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-4 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">True peak</p>
            <p
              className="font-display text-2xl leading-tight bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-accent)" }}
            >
              {truePeak != null && Number.isFinite(truePeak) ? `${truePeak.toFixed(1)} dBTP` : "—"}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {LUFS_TARGETS.map((t) => {
          const delta = lufs != null ? lufs - t.target : null;
          const verdict =
            delta == null ? "—"
            : Math.abs(delta) < 1 ? "On target"
            : delta > 0 ? `${delta.toFixed(1)} LU hot — will be turned down`
            : `${Math.abs(delta).toFixed(1)} LU quiet — will be turned up`;
          const tone =
            delta == null ? "text-muted-foreground"
            : Math.abs(delta) < 1 ? "text-emerald-300"
            : delta > 0 ? "text-amber-300" : "text-sky-300";
          return (
            <div key={t.name} className="rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs font-medium text-foreground">{t.name}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Target {t.target} LUFS</p>
              <p className={`mt-1 text-xs ${tone}`}>{verdict}</p>
            </div>
          );
        })}
      </div>
      {lufs == null && (
        <p className="mt-3 text-xs text-muted-foreground">
          Loudness will appear after the next upload — re-upload to refresh this card.
        </p>
      )}
    </div>
  );
}

/* ----------------------------- Longform video ----------------------------- */

function LongformSection({ project, refresh }: { project: any; refresh: () => void }) {
  const artwork = useSection<ArtworkPayload>(project.id, "artwork");
  const shorts = useSection<ShortsPayload>(project.id, "shorts");
  const shortsCount = shorts?.clips?.length ?? 0;
  const longform = useSection<{
    storagePath: string; sizeBytes: number; resolution: string;
    showWaveform: boolean; animateThumbnail: boolean; renderedAt: string;
  }>(project.id, "longform");

  const [resolution, setResolution] = useState<"1080p" | "4k">("1080p");
  const [showWaveform, setShowWaveform] = useState(true);
  const [animateThumbnail, setAnimateThumbnail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isCompilation =
    project.kind === "compilation_video" || project.kind === "compilation_playlist";

  // Warn user before navigating away mid-render — the in-browser ffmpeg job dies.
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  useEffect(() => {
    let alive = true;
    if (!longform?.storagePath) { setPreviewUrl(null); return; }
    supabase.storage.from("videos").createSignedUrl(longform.storagePath, 60 * 60).then(({ data }) => {
      if (alive) setPreviewUrl(data?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [longform?.storagePath]);

  const thumb = (() => {
    const tArr = artwork?.thumbnails ?? [];
    if (!tArr.length) return null;
    const sel = tArr.find((v) => v.id === artwork?.selectedThumbnailId);
    return sel ?? tArr[0];
  })();

  const canRender = (isCompilation || !!project.primary_audio_path) && !!thumb && !busy;

  async function render() {
    if (!canRender || !thumb) return;
    setBusy(true); setProgress(0); setPhase("Fetching assets…");
    try {
      const thumbnailBlob = await downloadAssetOrThrow("Thumbnail", "videos", thumb.storagePath);

      let audioBlob: Blob;
      let audioExt: string;
      if (isCompilation) {
        const concat = await loadCompilationConcatAudio(project.id, (m) => setPhase(m));
        audioBlob = concat.blob;
        audioExt = concat.ext;
      } else {
        audioBlob = await downloadAssetOrThrow("Audio", "audio", project.primary_audio_path);
        audioExt = (project.primary_audio_path.split(".").pop() || "mp3").toLowerCase();
      }

      setPhase("Encoding video (this stays in your browser)…");
      // Downscale the thumbnail once on the client so ffmpeg doesn't have to
      // resize a 3000×3000 album cover for every frame.
      const targetDims = resolution === "4k" ? { w: 3840, h: 2160 } : { w: 1920, h: 1080 };
      const preresized = await preresizeThumbnail(thumbnailBlob, targetDims.w, targetDims.h);
      const mp4 = await buildLongformVideo({
        thumbnailBlob: preresized.blob,
        thumbnailMime: preresized.mime,
        audioBlob,
        audioFilename: `audio.${audioExt}`,
        resolution,
        showWaveform,
        animateThumbnail,
        audioDurationSec: project.duration_sec ?? null,
        onProgress: (p) => setProgress(p),
      }).catch((e) => {
        throw new Error(`Video engine: ${(e as Error)?.message || "encode failed"}`);
      });

      setPhase("Uploading…");
      const ts = Date.now();
      const path = `${project.user_id}/${project.id}/longform_${ts}.mp4`;
      const { error: upErr } = await supabase.storage.from("videos").upload(path, mp4, {
        contentType: "video/mp4", upsert: true,
      });
      if (upErr) throw new Error(upErr.message);

      await recordLongformAsset({ data: {
        projectId: project.id,
        storagePath: path,
        sizeBytes: mp4.size,
        resolution,
        showWaveform,
        animateThumbnail,
        thumbnailVariantId: thumb.id,
      }});
      toast.success("Video rendered");
      refresh();
    } catch (e) {
      const msg = (e as Error).message || "Render failed";
      // Show first line in the toast and dump full ffmpeg tail to the console
      // for debugging.
      const [first, ...rest] = msg.split("\n");
      if (rest.length) console.error("longform render failed:\n" + msg);
      toast.error(first, rest.length ? { description: rest.slice(-6).join("\n") } : undefined);
    } finally {
      setBusy(false); setProgress(0); setPhase("");
    }
  }

  async function download() {
    if (!previewUrl) return;
    try {
      const resp = await fetch(previewUrl);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${(project.title || "release").replace(/[^\w\-]+/g, "_")}_video.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      toast.error("Download failed", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[color:var(--accent)]/30 bg-gradient-to-br from-[color:var(--accent)]/10 via-card/40 to-card/40 p-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Render video</p>
        <h3 className="font-display text-xl">Build a broadcast-quality YouTube video</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Combines your selected thumbnail and the original audio. Optional waveform overlay and a subtle Ken Burns zoom for motion. Renders entirely in your browser — no upload of the master file is needed for this step.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Resolution</p>
            <div className="mt-2 flex gap-2">
              {(["1080p", "4k"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    resolution === r
                      ? "border-[color:var(--accent)] text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r === "4k" ? "4K (3840×2160)" : "1080p (1920×1080)"}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showWaveform} onChange={(e) => setShowWaveform(e.target.checked)} />
              Waveform overlay along the bottom
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={animateThumbnail} onChange={(e) => setAnimateThumbnail(e.target.checked)} />
              Animate thumbnail (slow Ken Burns zoom)
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={render}
            disabled={!canRender}
            className="bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] text-black"
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Film className="mr-1.5 h-4 w-4" />}
            {longform ? "Re-render video" : "Render video"}
          </Button>
          {!thumb && <p className="text-xs text-amber-300">Generate a thumbnail first in the Artwork section.</p>}
          {!isCompilation && !project.primary_audio_path && <p className="text-xs text-amber-300">Upload an audio file first.</p>}
        </div>

        {busy && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-amber-300">
              Rendering in your browser — keep this tab open and don't navigate away.
            </p>
            <p className="text-xs text-muted-foreground">{phase} {progress ? `· ${progress}%` : ""}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-background">
              <div
                className="h-full transition-[width] duration-200"
                style={{
                  width: `${Math.max(2, progress)}%`,
                  backgroundImage: "var(--gradient-accent)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {longform && (
        <div className="rounded-2xl border border-border bg-card/40 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Latest render</p>
              <p className="text-sm text-muted-foreground">
                {longform.resolution.toUpperCase()} · {longform.showWaveform ? "waveform on" : "no waveform"} ·{" "}
                {longform.animateThumbnail ? "animated" : "static"} ·{" "}
                {(longform.sizeBytes / (1024 * 1024)).toFixed(1)} MB ·{" "}
                {new Date(longform.renderedAt).toLocaleString()}
              </p>
            </div>
            <Button variant="outline" onClick={download} disabled={!previewUrl}>
              <Download className="mr-1.5 h-4 w-4" /> Download MP4
            </Button>
          </div>
          {previewUrl ? (
            <video src={previewUrl} controls className="mt-4 w-full rounded-lg border border-border" />
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Loading preview…</p>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Shorts -------------------------------- */

type ShortDraft = {
  id: string;
  startSec: number;
  durationSec: number;
  showWaveform: boolean;
};

function ShortsSection({ project, refresh }: { project: any; refresh: () => void }) {
  const artwork = useSection<ArtworkPayload>(project.id, "artwork");
  const shorts = useSection<ShortsPayload>(project.id, "shorts");
  const duration = Number(project.duration_sec || 0);

  const thumb = (() => {
    const tArr = artwork?.thumbnails ?? [];
    if (!tArr.length) return null;
    const sel = tArr.find((v) => v.id === artwork?.selectedThumbnailId);
    return sel ?? tArr[0];
  })();

  // Three sensible default cutdowns: intro hook, mid, outro.
  const defaults: ShortDraft[] = (() => {
    const total = duration || 180;
    const len = Math.min(30, Math.max(15, Math.floor(total / 4)));
    const mid = Math.max(0, Math.floor(total / 2 - len / 2));
    const end = Math.max(0, Math.floor(total - len - 2));
    return [
      { id: "a", startSec: 0, durationSec: len, showWaveform: true },
      { id: "b", startSec: mid, durationSec: len, showWaveform: true },
      { id: "c", startSec: end, durationSec: len, showWaveform: true },
    ];
  })();

  const [drafts, setDrafts] = useState<ShortDraft[]>(defaults);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const isCompilation =
    project.kind === "compilation_video" || project.kind === "compilation_playlist";
  // Cache compilation concat audio between short renders.
  const concatAudioRef = useRef<{ blob: Blob; ext: string } | null>(null);

  useEffect(() => {
    if (!busyId) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busyId]);

  // Scrubber: signed audio URL + live playhead so user can pick start times.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  useEffect(() => {
    if (!project.primary_audio_path) { setAudioUrl(null); return; }
    supabase.storage.from("audio").createSignedUrl(project.primary_audio_path, 60 * 60).then(({ data }) => {
      setAudioUrl(data?.signedUrl ?? null);
    });
  }, [project.primary_audio_path]);
  function seekTo(sec: number) {
    const el = audioRef.current; if (!el) return;
    el.currentTime = Math.max(0, sec);
    el.play().catch(() => {});
  }

  // Reset drafts whenever the project duration changes (after re-analysis).
  useEffect(() => { setDrafts(defaults); /* eslint-disable-next-line */ }, [duration]);

  // Sign saved clip URLs for preview.
  useEffect(() => {
    let alive = true;
    (async () => {
      const map: Record<string, string> = {};
      for (const c of shorts?.clips ?? []) {
        const { data } = await supabase.storage.from("videos").createSignedUrl(c.storagePath, 60 * 60);
        if (data?.signedUrl) map[c.id] = data.signedUrl;
      }
      if (alive) setPreviewUrls(map);
    })();
    return () => { alive = false; };
  }, [shorts?.clips?.map((c) => c.storagePath).join("|")]);

  function updateDraft(id: string, patch: Partial<ShortDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  const canRender = (isCompilation || !!project.primary_audio_path) && !!thumb;

  async function renderOne(draft: ShortDraft, label: string) {
    if (!canRender || !thumb) return;
    setBusyId(draft.id); setProgress(0); setPhase("Fetching assets…");
    try {
      const thumbnailBlob = await downloadAssetOrThrow("Thumbnail", "videos", thumb.storagePath);

      let audioBlob: Blob;
      let audioExt: string;
      if (isCompilation) {
        if (!concatAudioRef.current) {
          const concat = await loadCompilationConcatAudio(project.id, (m) => setPhase(m));
          concatAudioRef.current = concat;
        }
        audioBlob = concatAudioRef.current.blob;
        audioExt = concatAudioRef.current.ext;
      } else {
        audioBlob = await downloadAssetOrThrow("Audio", "audio", project.primary_audio_path);
        audioExt = (project.primary_audio_path.split(".").pop() || "mp3").toLowerCase();
      }

      setPhase("Encoding short (in your browser)…");
      const preresized = await preresizeThumbnail(thumbnailBlob, 1080, 1920);
      const mp4 = await buildShortVideo({
        thumbnailBlob: preresized.blob,
        thumbnailMime: preresized.mime,
        audioBlob,
        audioFilename: `audio.${audioExt}`,
        startSec: draft.startSec,
        durationSec: draft.durationSec,
        showWaveform: draft.showWaveform,
        onProgress: (p) => setProgress(p),
      }).catch((e) => {
        throw new Error(`Video engine: ${(e as Error)?.message || "encode failed"}`);
      });

      setPhase("Uploading…");
      const ts = Date.now();
      const path = `${project.user_id}/${project.id}/short_${ts}.mp4`;
      const { error: upErr } = await supabase.storage.from("videos").upload(path, mp4, {
        contentType: "video/mp4", upsert: true,
      });
      if (upErr) throw new Error(upErr.message);

      await recordShortAsset({ data: {
        projectId: project.id,
        storagePath: path,
        sizeBytes: mp4.size,
        startSec: draft.startSec,
        durationSec: draft.durationSec,
        showWaveform: draft.showWaveform,
        thumbnailVariantId: thumb.id,
        label,
      }});
      toast.success(`Short rendered (${label})`);
      refresh();
    } catch (e) {
      const msg = (e as Error).message || "Render failed";
      const [first, ...rest] = msg.split("\n");
      if (rest.length) console.error("short render failed:\n" + msg);
      toast.error(first, rest.length ? { description: rest.slice(-6).join("\n") } : undefined);
    } finally {
      setBusyId(null); setProgress(0); setPhase("");
    }
  }

  async function downloadClip(clipId: string, url: string, label: string) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${(project.title || "release").replace(/[^\w\-]+/g, "_")}_${label}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      toast.error("Download failed", { description: (e as Error).message });
    }
  }

  async function removeClip(clipId: string) {
    try {
      await deleteShortClip({ data: { projectId: project.id, clipId } });
      refresh();
    } catch (e) {
      toast.error("Could not delete", { description: (e as Error).message });
    }
  }

  const labels = ["Hook", "Mid", "Outro"];

  async function renderAll() {
    for (let i = 0; i < drafts.length; i++) {
      await renderOne(drafts[i], labels[i]);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[color:var(--accent)]/30 bg-gradient-to-br from-[color:var(--accent)]/10 via-card/40 to-card/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Vertical cutdowns</p>
            <h3 className="font-display text-xl">Three shorts for IG Reels, TikTok and YouTube Shorts</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Picks three slices of your track — opening hook, mid-song, outro — and renders in <strong>9:16 vertical</strong> (Shorts / Reels / TikTok size) using the selected thumbnail. Scrub the player below, then set each clip's start and length.
            </p>
          </div>
          <Button
            onClick={renderAll}
            disabled={!canRender || !!busyId}
            className="shrink-0 bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] text-black"
          >
            {busyId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Smartphone className="mr-1.5 h-4 w-4" />}
            {busyId ? "Rendering all…" : "Render all 3 shorts"}
          </Button>
        </div>
        {!thumb && <p className="mt-3 text-xs text-amber-300">Generate a thumbnail first in the Thumbnail section.</p>}
        {!isCompilation && !project.primary_audio_path && (
          <p className="mt-3 text-xs text-amber-300">Upload an audio file first.</p>
        )}
        {busyId && (
          <p className="mt-3 text-xs text-amber-300">
            Rendering in your browser — keep this tab open and don't navigate away.
          </p>
        )}
        {!duration && (
          <p className="mt-3 text-xs text-muted-foreground">Track duration unknown — defaults use 3:00. Adjust start/length below.</p>
        )}
      </div>

      {/* Scrubber: pick start times by ear. */}
      {audioUrl && (
        <div className="rounded-2xl border border-border bg-card/40 p-4">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Track scrubber</p>
              <p className="truncate text-sm">{project.title}</p>
              <p className="text-xs tabular-nums text-muted-foreground">Playhead: {formatTime(playhead)}{duration ? ` / ${formatTime(duration)}` : ""}</p>
            </div>
          </div>
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            preload="metadata"
            className="mt-3 w-full"
            onTimeUpdate={(e) => setPlayhead((e.target as HTMLAudioElement).currentTime)}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {drafts.map((d, i) => {
          const busy = busyId === d.id;
          const maxStart = Math.max(0, (duration || 9999) - d.durationSec);
          return (
            <div key={d.id} className="rounded-2xl border border-border bg-card/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">{labels[i]}</p>
                <span className="text-xs text-muted-foreground">{formatTime(d.startSec)} → {formatTime(d.startSec + d.durationSec)}</span>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Start (s)</Label>
                <Input
                  type="number" min={0} max={maxStart} step={1}
                  value={d.startSec}
                  onChange={(e) => updateDraft(d.id, { startSec: Math.max(0, Math.min(maxStart, Number(e.target.value || 0))) })}
                />
                {audioUrl && (
                  <div className="mt-1.5 flex gap-1.5">
                    <Button type="button" size="sm" variant="outline" className="h-7 flex-1 text-xs"
                      onClick={() => updateDraft(d.id, { startSec: Math.max(0, Math.min(maxStart, Math.round(playhead))) })}
                    >Use playhead ({formatTime(playhead)})</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => seekTo(d.startSec)}
                    >Preview</Button>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Length (s)</Label>
                <Input
                  type="number" min={5} max={60} step={1}
                  value={d.durationSec}
                  onChange={(e) => updateDraft(d.id, { durationSec: Math.max(5, Math.min(60, Number(e.target.value || 0))) })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={d.showWaveform} onChange={(e) => updateDraft(d.id, { showWaveform: e.target.checked })} />
                Waveform overlay
              </label>

              <Button
                onClick={() => renderOne(d, labels[i])}
                disabled={!canRender || !!busyId}
                className="w-full bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-2,#f59e0b)] text-black"
              >
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Smartphone className="mr-1.5 h-4 w-4" />}
                {busy ? `${phase} ${progress ? `${progress}%` : ""}` : "Render short"}
              </Button>
              {busy && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                  <div className="h-full transition-[width] duration-200" style={{ width: `${Math.max(2, progress)}%`, backgroundImage: "var(--gradient-accent)" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!!shorts?.clips?.length && (
        <div className="rounded-2xl border border-border bg-card/40 p-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Rendered shorts</p>
            <p className="text-xs text-muted-foreground">{shorts.clips.length}/3</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {shorts.clips.map((c) => {
              const url = previewUrls[c.id];
              return (
                <div key={c.id} className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                  <p className="text-sm">
                    <span className="text-foreground">{c.label || "Short"}</span>{" "}
                    <span className="text-muted-foreground">· {formatTime(c.startSec)} · {c.durationSec}s · {(c.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                  </p>
                  {url ? (
                    <video src={url} controls className="aspect-[9/16] w-full rounded-lg border border-border bg-black object-cover" />
                  ) : (
                    <p className="text-xs text-muted-foreground">Loading preview…</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => url && downloadClip(c.id, url, c.label || "short")} disabled={!url}>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeClip(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function SoundcloudArtPicker({
  options,
  selectedPath,
  onSelect,
}: {
  options: Array<{ id: string; path: string; kind: "cover" | "thumb" }>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        options.map(async (o) => {
          const { data } = await supabase.storage.from("videos").createSignedUrl(o.path, 60 * 60);
          return [o.path, data?.signedUrl ?? ""] as const;
        }),
      );
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter(([, u]) => u)));
    })();
    return () => { cancelled = true; };
  }, [options]);
  return (
    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
      {options.map((o) => {
        const active = o.path === selectedPath;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(o.path)}
            className={`group relative aspect-square overflow-hidden rounded-md border-2 transition-all ${
              active ? "border-[color:var(--accent)] shadow-[var(--shadow-glow)]" : "border-border hover:border-foreground/40"
            }`}
            title={o.kind === "cover" ? "Album cover (1:1)" : "YouTube thumbnail (16:9 — will be cropped)"}
          >
            {urls[o.path] ? (
              <img src={urls[o.path]} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-secondary/40" />
            )}
            <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[9px] uppercase tracking-wide text-white">
              {o.kind === "cover" ? "Cover" : "Thumb"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- Publish -------------------------------- */

function PublishSection({ project }: { project: any }) {
  const qc = useQueryClient();
  const { data: yt } = useQuery({ queryKey: ["youtube-connection"], queryFn: () => getYoutubeConnection() });
  const { data: metaData } = useQuery({ queryKey: ["meta-connection"], queryFn: () => getMetaConnectionInfo() });
  const { data: ttData } = useQuery({ queryKey: ["tiktok-connection"], queryFn: () => getTiktokConnectionInfo() });
  const { data: scData } = useQuery({ queryKey: ["soundcloud-connection"], queryFn: () => getSoundcloudConnectionInfo() });
  const artwork = useSection<ArtworkPayload>(project.id, "artwork");
  const { data: jobsData } = useQuery({
    queryKey: ["publish-jobs", project.id],
    queryFn: () => listPublishJobs({ data: { projectId: project.id } }),
    refetchInterval: 5000,
  });
  const pubShorts = useSection<ShortsPayload>(project.id, "shorts");
  const shortsCount = pubShorts?.clips?.length ?? 0;
  const jobs = jobsData?.jobs ?? [];
  const ytJob = jobs.find((j: any) => j.platform === "youtube");
  const fbJob = jobs.find((j: any) => j.platform === "facebook");
  const igJob = jobs.find((j: any) => j.platform === "instagram");
  const ttJob = jobs.find((j: any) => j.platform === "tiktok");
  const scJob = jobs.find((j: any) => j.platform === "soundcloud");

  const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [ttPrivacy, setTtPrivacy] = useState<"PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY">("SELF_ONLY");
  const [scTitle, setScTitle] = useState<string>("");
  const [scSharing, setScSharing] = useState<"public" | "private">("public");
  const [scDownloadable, setScDownloadable] = useState<boolean>(false);
  const [scArtworkPath, setScArtworkPath] = useState<string | null>(null);
  const [ytVerifyOpen, setYtVerifyOpen] = useState(false);

  // Build the artwork picker options: covers first (1:1 — ideal for SoundCloud),
  // then thumbnails (16:9 — SoundCloud will crop to square).
  const scArtOptions = useMemo(() => {
    const covers = (artwork?.covers ?? []).map((c) => ({ id: c.id, path: c.storagePath, kind: "cover" as const }));
    const thumbs = (artwork?.thumbnails ?? []).map((t) => ({ id: t.id, path: t.storagePath, kind: "thumb" as const }));
    return [...covers, ...thumbs];
  }, [artwork?.covers, artwork?.thumbnails]);
  const scDefaultArt = useMemo(() => {
    const selCover = artwork?.covers?.find((c) => c.id === artwork?.selectedCoverId) ?? artwork?.covers?.[0];
    if (selCover) return selCover.storagePath;
    const selThumb = artwork?.thumbnails?.find((t) => t.id === artwork?.selectedThumbnailId) ?? artwork?.thumbnails?.[0];
    return selThumb?.storagePath ?? null;
  }, [artwork]);
  const scArtPath = scArtworkPath ?? scDefaultArt;

  const publish = useMutation({
    mutationFn: () => publishToYoutube({
      data: {
        projectId: project.id,
        privacyStatus: privacy,
        publishAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
      },
    }),
    onSuccess: (r) => {
      toast.success(`Published to YouTube — ${r.url}`);
      qc.invalidateQueries({ queryKey: ["publish-jobs", project.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishShorts = useMutation({
    mutationFn: () => publishShortsToYoutube({
      data: { projectId: project.id, privacyStatus: privacy },
    }),
    onSuccess: (r) => {
      if (r.uploaded > 0) {
        toast.success(`Posted ${r.uploaded}/${r.total} short${r.total === 1 ? "" : "s"} to YouTube Shorts`);
      } else {
        toast.error("No shorts were uploaded — see publish log.");
      }
      qc.invalidateQueries({ queryKey: ["publish-jobs", project.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pubFb = useMutation({
    mutationFn: () => publishToFacebook({ data: { projectId: project.id } }),
    onSuccess: (r) => { toast.success(`Posted to Facebook — ${r.url}`); qc.invalidateQueries({ queryKey: ["publish-jobs", project.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pubIg = useMutation({
    mutationFn: () => publishToInstagram({ data: { projectId: project.id, shortIndex: 0 } }),
    onSuccess: (r) => { toast.success(`Posted Reel — ${r.url}`); qc.invalidateQueries({ queryKey: ["publish-jobs", project.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pubTt = useMutation({
    mutationFn: () => publishToTiktok({ data: { projectId: project.id, shortIndex: 0, privacy: ttPrivacy } }),
    onSuccess: (r) => { toast.success(r.note ?? "Sent to TikTok"); qc.invalidateQueries({ queryKey: ["publish-jobs", project.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pubSc = useMutation({
    mutationFn: () => publishToSoundcloud({
      data: {
        projectId: project.id,
        overrideTitle: scTitle.trim() ? scTitle.trim() : null,
        sharing: scSharing,
        downloadable: scDownloadable,
        artworkStoragePath: scArtPath,
      },
    }),
    onSuccess: (r) => {
      toast.success(r.url ? `Posted to SoundCloud — ${r.url}` : "Posted to SoundCloud");
      qc.invalidateQueries({ queryKey: ["publish-jobs", project.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const publishAll = () => {
    if (yt?.connection) publish.mutate();
    if (yt?.connection && shortsCount > 0) publishShorts.mutate();
    if (metaData?.connection?.page_id) pubFb.mutate();
    if (metaData?.connection?.ig_user_id) pubIg.mutate();
    if (ttData?.connection) pubTt.mutate();
    if (scData?.connection) pubSc.mutate();
  };

  const ytConnected = !!yt?.connection;
  const ytChannel = yt?.connection?.channel_title;
  const fbConnected = !!metaData?.connection?.page_id;
  const igConnected = !!metaData?.connection?.ig_user_id;
  const ttConnected = !!ttData?.connection;
  const scConnected = !!scData?.connection;
  const anyConnected = ytConnected || fbConnected || igConnected || ttConnected || scConnected;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--accent)]">Post it everywhere</p>
            <h3 className="mt-1 font-display text-2xl">Publish</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              We use the title, description, tags, thumbnail and renders from the previous steps. Connect a platform once, then push from here.
            </p>
          </div>
          <Button
            size="lg"
            onClick={publishAll}
            disabled={!anyConnected || publish.isPending || pubFb.isPending || pubIg.isPending || pubTt.isPending || pubSc.isPending}
            className="bg-[image:var(--gradient-accent)] text-primary-foreground"
          >
            <Send className="mr-1.5 h-4 w-4" /> Publish to all connected
          </Button>
        </div>
      </div>

      {/* YouTube */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Youtube className="h-5 w-5 text-[#FF0033]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-display text-lg">YouTube</h4>
              {ytConnected && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </div>
            {ytConnected ? (
              <p className="text-sm text-muted-foreground">Connected as <span className="text-foreground">{ytChannel}</span></p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not connected. <Link to="/connections" className="underline text-foreground">Connect YouTube</Link> to publish.
              </p>
            )}
            <button
              type="button"
              onClick={() => setYtVerifyOpen(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-[color:var(--accent,#f59e0b)] underline hover:text-foreground transition-colors"
            >
              <Info className="h-3 w-3" />
              App Verification in Progress. You may still connect safely.
            </button>

            {ytConnected && (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">Visibility</Label>
                  <div className="mt-1 flex gap-1 rounded-md border border-border p-1">
                    {(["public", "unlisted", "private"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPrivacy(p)}
                        className={`flex-1 rounded px-2 py-1 text-xs capitalize transition-colors ${privacy === p ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >{p}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Schedule (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button
                  onClick={() => publish.mutate()}
                  disabled={publish.isPending}
                  className="bg-[image:var(--gradient-accent)] text-primary-foreground"
                >
                  {publish.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                  {scheduleAt ? "Schedule" : "Publish now"}
                </Button>
              </div>
            )}

            {ytConnected && shortsCount > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/40 p-3">
                <div className="text-sm">
                  <p className="font-medium text-foreground">YouTube Shorts</p>
                  <p className="text-xs text-muted-foreground">
                    Post {shortsCount} rendered short{shortsCount === 1 ? "" : "s"} as vertical YouTube Shorts (uses your current visibility setting).
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => publishShorts.mutate()}
                  disabled={publishShorts.isPending}
                >
                  {publishShorts.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                  Post {shortsCount} Short{shortsCount === 1 ? "" : "s"}
                </Button>
              </div>
            )}

            {ytJob && (
              <div className="mt-4 rounded-lg border border-border bg-background/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="capitalize text-foreground">{ytJob.status}</span>
                  <span className="text-xs text-muted-foreground">{new Date(ytJob.created_at).toLocaleString()}</span>
                </div>
                {ytJob.platform_url && (
                  <a href={ytJob.platform_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
                    {ytJob.platform_url} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {ytJob.error && <p className="mt-1 text-xs text-destructive">{ytJob.error}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Facebook Page */}
      <PlatformCard
        icon={<Facebook className="h-5 w-5 text-[#1877F2]" />}
        title="Facebook Page"
        connected={fbConnected}
        connectedLabel={metaData?.connection?.page_name ?? null}
        emptyHint={metaData?.connection ? "Connected account has no Facebook Page." : "Connect Facebook from the Connections page."}
        actionLabel="Post to Facebook"
        onAction={() => pubFb.mutate()}
        busy={pubFb.isPending}
        job={fbJob}
      />

      {/* Instagram Reel */}
      <PlatformCard
        icon={<Instagram className="h-5 w-5 text-[#E1306C]" />}
        title="Instagram Reel"
        connected={igConnected}
        connectedLabel={metaData?.connection?.ig_username ? `@${metaData.connection.ig_username}` : null}
        emptyHint={metaData?.connection ? "No Instagram Business account linked to that Page." : "Connect Instagram via Facebook from the Connections page."}
        actionLabel="Post Reel from short #1"
        onAction={() => pubIg.mutate()}
        busy={pubIg.isPending}
        job={igJob}
      />

      {/* TikTok */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <span className="font-display text-base">TT</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-display text-lg">TikTok</h4>
              {ttConnected && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </div>
            {ttConnected ? (
              <p className="text-sm text-muted-foreground">Connected as <span className="text-foreground">{ttData?.connection?.display_name ?? "TikTok"}</span></p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not connected. <Link to="/connections" className="underline text-foreground">Connect TikTok</Link>.
              </p>
            )}
            {ttConnected && (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">Privacy</Label>
                  <div className="mt-1 flex gap-1 rounded-md border border-border p-1">
                    {([
                      ["SELF_ONLY", "Private"],
                      ["MUTUAL_FOLLOW_FRIENDS", "Friends"],
                      ["PUBLIC_TO_EVERYONE", "Public"],
                    ] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setTtPrivacy(val)}
                        className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${ttPrivacy === val ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={() => pubTt.mutate()}
                  disabled={pubTt.isPending}
                  className="bg-[image:var(--gradient-accent)] text-primary-foreground"
                >
                  {pubTt.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                  Upload short #1 to TikTok
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              While the TikTok app is in review, posts land in your TikTok inbox as a draft — finalize from the app.
            </p>
            {ttJob && (
              <div className="mt-4 rounded-lg border border-border bg-background/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="capitalize text-foreground">{ttJob.status}</span>
                  <span className="text-xs text-muted-foreground">{new Date(ttJob.created_at).toLocaleString()}</span>
                </div>
                {ttJob.error && <p className="mt-1 text-xs text-destructive">{ttJob.error}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SoundCloud */}
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <span className="font-display text-base text-[#ff5500]">SC</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-display text-lg">SoundCloud</h4>
              {scConnected && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
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
            {scConnected ? (
              <p className="text-sm text-muted-foreground">
                Connected as <span className="text-foreground">{scData?.connection?.display_name ?? scData?.connection?.username ?? "SoundCloud"}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not connected. <Link to="/connections" className="underline text-foreground">Connect SoundCloud</Link> to publish your audio.
              </p>
            )}

            {scConnected && (
              <div className="mt-4 grid gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">SoundCloud title (override)</Label>
                  <Input
                    placeholder="Leave blank to reuse your YouTube title"
                    value={scTitle}
                    onChange={(e) => setScTitle(e.target.value.slice(0, 100))}
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    A great SoundCloud title is usually shorter than a YouTube title — e.g. "Artist — Track Name".
                  </p>
                </div>
                {scArtOptions.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Cover image for SoundCloud</Label>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Album covers (1:1) are uploaded as-is. YouTube thumbnails (16:9) will be cropped to square by SoundCloud.
                    </p>
                    <SoundcloudArtPicker
                      options={scArtOptions}
                      selectedPath={scArtPath}
                      onSelect={(p) => setScArtworkPath(p)}
                    />
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div>
                    <Label className="text-xs text-muted-foreground">Visibility</Label>
                    <div className="mt-1 flex gap-1 rounded-md border border-border p-1">
                      {(["public", "private"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setScSharing(p)}
                          className={`flex-1 rounded px-2 py-1 text-xs capitalize transition-colors ${scSharing === p ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >{p}</button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={scDownloadable}
                      onChange={(e) => setScDownloadable(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Allow downloads
                  </label>
                  <Button
                    onClick={() => pubSc.mutate()}
                    disabled={pubSc.isPending}
                    className="bg-[image:var(--gradient-accent)] text-primary-foreground"
                  >
                    {pubSc.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                    Upload to SoundCloud
                  </Button>
                </div>
              </div>
            )}

            {scJob && (
              <div className="mt-4 rounded-lg border border-border bg-background/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="capitalize text-foreground">{scJob.status}</span>
                  <span className="text-xs text-muted-foreground">{new Date(scJob.created_at).toLocaleString()}</span>
                </div>
                {scJob.platform_url && (
                  <a href={scJob.platform_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
                    {scJob.platform_url} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {scJob.error && <p className="mt-1 text-xs text-destructive">{scJob.error}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

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
    </div>
  );
}

function PlatformCard({ icon, title, connected, connectedLabel, emptyHint, actionLabel, onAction, busy, job }: {
  icon: React.ReactNode;
  title: string;
  connected: boolean;
  connectedLabel: string | null;
  emptyHint: string;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
  job: any;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-display text-lg">{title}</h4>
            {connected && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          </div>
          {connected ? (
            <p className="text-sm text-muted-foreground">Posting to <span className="text-foreground">{connectedLabel ?? "—"}</span></p>
          ) : (
            <p className="text-sm text-muted-foreground">{emptyHint} <Link to="/connections" className="underline text-foreground">Manage connections</Link>.</p>
          )}
          {connected && (
            <Button
              onClick={onAction}
              disabled={busy}
              className="mt-4 bg-[image:var(--gradient-accent)] text-primary-foreground"
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              {actionLabel}
            </Button>
          )}
          {job && (
            <div className="mt-4 rounded-lg border border-border bg-background/40 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="capitalize text-foreground">{job.status}</span>
                <span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span>
              </div>
              {job.platform_url && (
                <a href={job.platform_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
                  {job.platform_url} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
