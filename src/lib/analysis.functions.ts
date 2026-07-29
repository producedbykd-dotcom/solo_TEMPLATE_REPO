import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiChatRaw } from "@/lib/ai/provider";

type AnalysisResult = {
  genre: string;
  niche: string;
  key: string;
  bpm: number | null;
  mood: string;
  productionNotes: string;
  vocalNotes: string;
};

function extractJson(text: string): AnalysisResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as AnalysisResult;
  } catch {
    return null;
  }
}

export const analyzeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; steering?: string }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;


    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, title, primary_audio_path, analysis_audio_path, duration_sec")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!project?.primary_audio_path) throw new Error("No audio on project");

    // Prefer the small analysis preview when present; original release file is never altered.
    const audioPath = (project as { analysis_audio_path?: string | null }).analysis_audio_path
      || project.primary_audio_path;

    // Signed URL so Gemini can fetch the audio directly.
    const { data: signed, error: sErr } = await supabase.storage
      .from("audio")
      .createSignedUrl(audioPath, 60 * 60);
    if (sErr || !signed?.signedUrl) throw new Error(sErr?.message || "Sign failed");

    // Download + base64 (Gemini via Lovable AI Gateway accepts input_audio).
    const audioRes = await fetch(signed.signedUrl);
    if (!audioRes.ok) throw new Error(`Audio fetch failed (${audioRes.status})`);
    const buf = new Uint8Array(await audioRes.arrayBuffer());
    // No size cap. aiChatDirect auto-uploads via Files API when the inline
    // payload would exceed Gemini's ~20MB wire limit.
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const ext = audioPath.split(".").pop()?.toLowerCase() || "mp3";
    const fmt = ext === "wav" ? "wav" : ext === "flac" ? "flac" : ext === "m4a" ? "m4a" : "mp3";

    const system = `You are a senior A&R + mixing engineer. Listen to the audio and return STRICT JSON only — no prose, no code fence — matching this shape:
{"genre":string,"niche":string,"key":string,"bpm":number,"mood":string,"productionNotes":string,"vocalNotes":string}
- genre: broad genre (e.g. "Hip-Hop", "Lo-fi", "House")
- niche: specific subgenre / scene (e.g. "Boom bap", "Jersey club", "Afro house")
- key: musical key with mode (e.g. "F# minor")
- bpm: integer tempo
- mood: 3-6 word vibe summary
- productionNotes: 1-2 sentences on mix, instrumentation, sound design
- vocalNotes: 1-2 sentences on vocal performance/processing, or "Instrumental" if none`;

    const userPrompt = `Track title: "${project.title}". Duration: ${project.duration_sec ?? "unknown"}s.${
      data.steering ? `\nUser direction: ${data.steering}` : ""
    }\nReturn the JSON now.`;

    let payload: any;
    try {
      payload = await aiChatRaw({
        model: "gemini-flash",
        generationConfig: { responseMimeType: "application/json" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "input_audio", input_audio: { data: b64, format: fmt } },
            ],
          },
        ],
      });
    } catch (e: any) {
      console.error("[analyzeAudio] Gemini call failed", {
        model: "gemini-flash",
        audioBytes: buf.byteLength,
        fmt,
        status: e?.status,
        bodyPreview: e?.bodyPreview,
        message: String(e?.message ?? e),
      });
      throw new Error(`Analysis failed: ${e?.message ?? "unknown error"}`);
    }
    const text: string = payload?.choices?.[0]?.message?.content ?? "";
    let parsed: AnalysisResult | null = null;
    try { parsed = JSON.parse(text) as AnalysisResult; } catch { parsed = extractJson(text); }
    if (!parsed) {
      console.error("[analyzeAudio] could not parse response", {
        finishReason: payload?.finishReason,
        blockReason: payload?.blockReason,
        textPreview: text.slice(0, 300),
        audioBytes: buf.byteLength,
        fmt,
      });
      const reason = payload?.finishReason && payload.finishReason !== "STOP"
        ? ` (finishReason=${payload.finishReason}${payload?.blockReason ? `, blockReason=${payload.blockReason}` : ""})`
        : "";
      throw new Error(`Could not parse analysis response${reason}`);
    }

    // Upsert section.
    const { data: existing } = await supabase
      .from("project_sections")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("section", "analysis")
      .maybeSingle();

    if (existing?.id) {
      const { error } = await (supabase.from("project_sections") as any)
        .update({ data: parsed, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("project_sections")
        .insert({ project_id: data.projectId, section: "analysis", status: "ready", data: parsed });
      if (error) throw new Error(error.message);
    }

    // Touch userId to satisfy noUnusedLocals
    void userId;

    return { analysis: parsed };
  });

export const updateAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; patch: Partial<AnalysisResult> }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: existing } = await supabase
      .from("project_sections")
      .select("id, data")
      .eq("project_id", data.projectId)
      .eq("section", "analysis")
      .maybeSingle();
    const current = (existing?.data as Partial<AnalysisResult>) ?? {};
    const merged = { ...current, ...data.patch };
    if (existing?.id) {
      const { error } = await (supabase.from("project_sections") as any)
        .update({ data: merged, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("project_sections")
        .insert({ project_id: data.projectId, section: "analysis", status: "ready", data: merged });
      if (error) throw new Error(error.message);
    }
    return { analysis: merged };
  });