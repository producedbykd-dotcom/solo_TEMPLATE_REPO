/**
 * Canonical public origin used for OAuth redirect URIs.
 *
 * OAuth providers (Google/YouTube, Meta, TikTok) require the redirect_uri to
 * match an entry in their allowlist exactly. To avoid having to whitelist
 * every preview / lovable.app subdomain, we always send users through the
 * production domain. Override with PUBLIC_APP_URL if needed.
 */
export function getPublicOrigin(): string {
  const override = process.env.PUBLIC_APP_URL;
  if (override) return override.replace(/\/$/, "");
  return "https://release-engine.pro";
}