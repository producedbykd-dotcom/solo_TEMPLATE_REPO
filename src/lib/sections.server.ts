import type { SupabaseClient } from "@supabase/supabase-js";

export async function upsertSection(
  supabase: SupabaseClient,
  projectId: string,
  section: string,
  data: unknown,
) {
  const { data: existing } = await supabase
    .from("project_sections")
    .select("id")
    .eq("project_id", projectId)
    .eq("section", section)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await (supabase.from("project_sections") as any)
      .update({ data, status: "ready", updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("project_sections")
      .insert({ project_id: projectId, section, status: "ready", data });
    if (error) throw new Error(error.message);
  }
}