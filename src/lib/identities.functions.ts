import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IdentityLinks = Partial<{
  spotify: string;
  apple: string;
  youtube: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  website: string;
  bandcamp: string;
  soundcloud: string;
}>;

export type Identity = {
  id: string;
  name: string;
  artist_name: string | null;
  links: IdentityLinks;
  default_tags: string[];
  description_template: string | null;
  image_style_prompt: string | null;
  reference_image_paths: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type UpsertInput = {
  id?: string;
  name: string;
  artist_name?: string | null;
  links?: IdentityLinks;
  default_tags?: string[];
  description_template?: string | null;
  image_style_prompt?: string | null;
  reference_image_paths?: string[];
  is_default?: boolean;
};

export const listIdentities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("identities")
      .select("*")
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { identities: (data ?? []) as Identity[] };
  });

export const upsertIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: UpsertInput) => {
    if (!d?.name || typeof d.name !== "string") throw new Error("Name required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: any = {
      name: data.name,
      artist_name: data.artist_name ?? null,
      links: data.links ?? {},
      default_tags: data.default_tags ?? [],
      description_template: data.description_template ?? null,
      image_style_prompt: data.image_style_prompt ?? null,
      reference_image_paths: data.reference_image_paths ?? [],
      is_default: !!data.is_default,
    };
    if (data.is_default) {
      // Clear any other default for this user.
      await (supabase.from("identities") as any).update({ is_default: false }).eq("user_id", userId);
    }
    if (data.id) {
      const { data: updated, error } = await (supabase.from("identities") as any)
        .update(patch).eq("id", data.id).select("*").maybeSingle();
      if (error) throw new Error(error.message);
      return { identity: updated as Identity };
    }
    const { data: inserted, error } = await supabase
      .from("identities").insert({ ...patch, user_id: userId }).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return { identity: inserted as Identity };
  });

export const deleteIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("identities").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Attach (or detach) an identity to a project; the identity then prefills
 *  description/tags and steers artwork generation. */
export const setProjectIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; identityId: string | null }) => {
    if (!d?.projectId) throw new Error("projectId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("projects") as any)
      .update({ identity_id: data.identityId }).eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Create an identity prefilled from a project (current metadata, tags, refs). */
export const createIdentityFromProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { projectId: string; name: string; setDefault?: boolean }) => {
    if (!d?.projectId || !d?.name) throw new Error("projectId and name required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase
      .from("project_sections").select("section, data").eq("project_id", data.projectId)
      .in("section", ["metadata", "artwork"]);
    const meta = rows?.find((r) => r.section === "metadata")?.data as any;
    const art = rows?.find((r) => r.section === "artwork")?.data as any;
    const referencePaths: string[] = [];
    if (art?.selectedCoverId) {
      const c = art.covers?.find((x: any) => x.id === art.selectedCoverId);
      if (c?.storagePath) referencePaths.push(c.storagePath);
    }
    if (art?.selectedThumbnailId) {
      const t = art.thumbnails?.find((x: any) => x.id === art.selectedThumbnailId);
      if (t?.storagePath) referencePaths.push(t.storagePath);
    }
    if (data.setDefault) {
      await (supabase.from("identities") as any).update({ is_default: false }).eq("user_id", userId);
    }
    const { data: inserted, error } = await supabase.from("identities").insert({
      user_id: userId,
      name: data.name,
      artist_name: null,
      links: {},
      default_tags: Array.isArray(meta?.tags) ? meta.tags.slice(0, 20) : [],
      description_template: meta?.description ?? null,
      image_style_prompt: null,
      reference_image_paths: referencePaths,
      is_default: !!data.setDefault,
    }).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    // Auto-link this identity to the source project.
    await (supabase.from("projects") as any).update({ identity_id: inserted!.id }).eq("id", data.projectId);
    return { identity: inserted as Identity };
  });