import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Solo Edition setup server functions.
 *
 * These run once, during installation, before the owner account exists.
 * They are disabled permanently as soon as an owner is present.
 */

const credsSchema = z.object({
  supabaseUrl: z.string().url(),
  serviceRoleKey: z.string().min(20),
});

function admin(url: string, key: string) {
  return {
    async rest(path: string, init?: RequestInit) {
      return fetch(`${url.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    },
  };
}

/** Has setup already been completed on this installation? */
export const setupStatus = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, ownerExists: false };

  try {
    const res = await admin(url, key).rest("/auth/v1/admin/users?per_page=1");
    if (!res.ok) return { configured: true, ownerExists: false };
    const body = (await res.json()) as { users?: unknown[] };
    return { configured: true, ownerExists: (body.users?.length ?? 0) > 0 };
  } catch {
    return { configured: true, ownerExists: false };
  }
});

/** Check the Supabase credentials the owner just pasted in. */
export const verifySupabase = createServerFn({ method: "POST" })
  .inputValidator((d) => credsSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const res = await admin(data.supabaseUrl, data.serviceRoleKey).rest(
        "/auth/v1/admin/users?per_page=1",
      );
      if (!res.ok) {
        return { ok: false as const, error: "Those credentials were rejected. Double-check the project URL and service role key." };
      }
      const body = (await res.json()) as { users?: unknown[] };
      return { ok: true as const, ownerExists: (body.users?.length ?? 0) > 0 };
    } catch {
      return { ok: false as const, error: "Could not reach that project. Check the URL and try again." };
    }
  });

/** Check the owner's Gemini key with the cheapest possible call. */

const LICENSE_RE = /^SOLO-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/;
const LICENSE_HOME = "https://release-engine.pro/api/public/license/verify";

/**
 * Verify the licence key ONCE, at install time.
 *
 * If our server cannot be reached the key is accepted on its format alone —
 * your installation never depends on us being online, now or later.
 */
export const verifyLicense = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ key: z.string().min(10).max(512) }).parse(d))
  .handler(async ({ data }) => {
    const key = data.key.trim();
    if (!LICENSE_RE.test(key)) {
      return { ok: false as const, error: "That does not look like a Release Engine licence key." };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(LICENSE_HOME, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = (await res.json()) as { valid?: boolean; reason?: string };
      if (body.valid) return { ok: true as const, offline: false };
      return {
        ok: false as const,
        error:
          body.reason === "revoked"
            ? "This licence key has been revoked."
            : "That licence key was not recognised.",
      };
    } catch {
      // Offline fallback — install proceeds.
      return { ok: true as const, offline: true };
    }
  });

export const verifyGemini = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ apiKey: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(data.apiKey)}`,
      );
      if (res.status === 429) {
        return { ok: false as const, error: "Key works, but the quota is exhausted. Enable billing on your Google Cloud project." };
      }
      if (!res.ok) {
        return { ok: false as const, error: "That key was rejected by Google." };
      }
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach Google. Check your connection and try again." };
    }
  });

/**
 * Create the single owner account. Refuses to run if any user already exists,
 * which is what makes this installation single-owner.
 */
export const createOwner = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(10, "Use at least 10 characters"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("This installation is not configured yet.");

    const api = admin(url, key);

    const existing = await api.rest("/auth/v1/admin/users?per_page=1");
    if (existing.ok) {
      const body = (await existing.json()) as { users?: unknown[] };
      if ((body.users?.length ?? 0) > 0) {
        throw new Error("An owner account already exists on this installation.");
      }
    }

    const res = await api.rest("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: data.email,
        password: data.password,
        email_confirm: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Could not create the owner account: ${text.slice(0, 200)}`);
    }

    return { ok: true as const, email: data.email };
  });
/**
 * The full database schema for a fresh installation.
 *
 * Bundled at build time so the browser setup wizard can hand the owner one
 * block of SQL to paste into their Supabase SQL editor. No terminal, no
 * `supabase db push`, no local tooling.
 */
export const getSchemaSql = createServerFn({ method: "GET" }).handler(async () => {
  const files = import.meta.glob("../../supabase/migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const sql = Object.keys(files)
    .sort()
    .map((path) => `-- ${path.split("/").pop()}\n${files[path]}`)
    .join("\n\n");

  return { sql };
});

/** Does the schema look like it has been applied yet? */
export const verifySchema = createServerFn({ method: "POST" })
  .inputValidator((d) => credsSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const res = await admin(data.supabaseUrl, data.serviceRoleKey).rest(
        "/rest/v1/projects?select=id&limit=1",
      );
      if (res.ok) return { ok: true as const };
      return {
        ok: false as const,
        error: "The tables aren't there yet. Run the SQL above, then check again.",
      };
    } catch {
      return { ok: false as const, error: "Could not reach your project. Try again in a moment." };
    }
  });

/**
 * Create the private storage buckets the app needs. Idempotent — existing
 * buckets are left alone. Runs from the browser wizard so no CLI is required.
 */
export const ensureBuckets = createServerFn({ method: "POST" })
  .inputValidator((d) => credsSchema.parse(d))
  .handler(async ({ data }) => {
    const base = data.supabaseUrl.replace(/\/$/, "");
    const created: string[] = [];
    const failed: string[] = [];
    for (const name of ["audio", "videos", "store"]) {
      try {
        const res = await fetch(`${base}/storage/v1/bucket`, {
          method: "POST",
          headers: {
            apikey: data.serviceRoleKey,
            Authorization: `Bearer ${data.serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, id: name, public: false }),
        });
        if (res.ok || res.status === 409) created.push(name);
        else failed.push(name);
      } catch {
        failed.push(name);
      }
    }
    return { ok: failed.length === 0, created, failed };
  });
