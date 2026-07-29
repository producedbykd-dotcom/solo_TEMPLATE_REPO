/**
 * Public 45-second preview stream for a storefront product.
 *
 * Only the first slice of the master is ever sent (capped at 45s of 320kbps
 * audio), so the full file can never be pulled from this endpoint. Access is
 * limited to active products belonging to a published store.
 */
import { createFileRoute } from "@tanstack/react-router";

const PREVIEW_SECONDS = 45;
const MAX_BYTES = Math.ceil((320_000 / 8) * PREVIEW_SECONDS); // ~1.8 MB

export const Route = createFileRoute("/api/public/store/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("p") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("bad request", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: product } = await supabaseAdmin
          .from("store_products")
          .select("audio_path, audio_bucket, active, store_id")
          .eq("id", id)
          .maybeSingle();
        const p = product as Record<string, any> | null;
        if (!p?.active || !p.audio_path) return new Response("not found", { status: 404 });

        const { data: store } = await supabaseAdmin
          .from("stores").select("published").eq("id", p.store_id).maybeSingle();
        if (!(store as any)?.published) return new Response("not found", { status: 404 });

        const { data: blob, error } = await supabaseAdmin.storage
          .from(p.audio_bucket || "audio").download(p.audio_path);
        if (error || !blob) return new Response("not found", { status: 404 });

        const bytes = new Uint8Array(await blob.arrayBuffer()).slice(0, MAX_BYTES);
        return new Response(bytes, {
          headers: {
            "Content-Type": blob.type || "audio/mpeg",
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "public, max-age=3600",
            "Accept-Ranges": "none",
          },
        });
      },
    },
  },
});
