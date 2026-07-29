// Same-origin storage proxy. The browser calls this server function; the
// server (Cloudflare Worker) fetches the object from Supabase Storage via
// the user's authenticated Supabase client (RLS applies) and returns the
// bytes as base64. This avoids direct browser -> *.supabase.co requests
// that can be blocked by ad-blockers / privacy extensions, causing an
// instant "Failed to fetch" before any request hits the network.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const downloadStorageObject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { bucket: string; path: string }) => {
    if (!d?.bucket) throw new Error("bucket required");
    if (!d?.path) throw new Error("path required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: blob, error } = await supabase.storage
      .from(data.bucket)
      .download(data.path);
    if (error) throw new Error(error.message);
    if (!blob) throw new Error("empty response");
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Base64-encode in chunks to avoid call-stack overflow on large files.
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
    }
    const base64 = btoa(bin);
    return {
      base64,
      contentType: blob.type || "application/octet-stream",
      size: buf.length,
    };
  });
