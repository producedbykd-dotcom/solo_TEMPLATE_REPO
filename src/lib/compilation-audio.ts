// Browser-only helpers for compilation projects in the wizard. The wizard's
// longform + shorts steps treat compilation projects as if they had a single
// concatenated audio file built from member tracks.
import { supabase } from "@/integrations/supabase/client";
import { concatAudioToMp3 } from "@/lib/compilation-render";

/** Fetch ordered member tracks for a compilation-backed project. */
export async function loadCompilationOrderedTracks(projectId: string) {
  const { data: comp, error } = await supabase
    .from("release_compilations")
    .select("ordered_track_ids")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const ids: string[] = (comp as any)?.ordered_track_ids ?? [];
  if (!ids.length) throw new Error("Compilation has no member tracks");
  const { data: rows, error: pErr } = await supabase
    .from("projects")
    .select("id,title,primary_audio_path")
    .in("id", ids);
  if (pErr) throw new Error(pErr.message);
  const byId = new Map((rows ?? []).map((r: any) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as Array<{
    id: string; title: string; primary_audio_path: string;
  }>;
}

/** Build a single concatenated mp3 blob for a compilation project, ready to
 *  hand to buildLongformVideo / buildShortVideo. */
export async function loadCompilationConcatAudio(
  projectId: string,
  onProgress?: (msg: string) => void,
): Promise<{ blob: Blob; ext: "mp3" }> {
  const tracks = await loadCompilationOrderedTracks(projectId);
  const audios: Array<{ blob: Blob; ext: string }> = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    onProgress?.(`Fetching track ${i + 1}/${tracks.length}: ${t.title}`);
    const { data: signed, error } = await supabase.storage
      .from("audio")
      .createSignedUrl(t.primary_audio_path, 60 * 60);
    if (error || !signed?.signedUrl) {
      throw new Error(`Failed to sign audio for "${t.title}": ${error?.message || "unknown"}`);
    }
    const res = await fetch(signed.signedUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to download "${t.title}" (HTTP ${res.status})`);
    const blob = await res.blob();
    const ext = (t.primary_audio_path.split(".").pop() || "mp3").toLowerCase();
    audios.push({ blob, ext });
  }
  onProgress?.("Stitching tracks together…");
  const blob = await concatAudioToMp3(audios);
  return { blob, ext: "mp3" };
}