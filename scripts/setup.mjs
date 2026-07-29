#!/usr/bin/env node
/**
 * Release Engine — Solo Edition installer.
 *
 * Interactive, one command: `npm run setup`.
 * Checks tools, collects and verifies credentials, writes .env, pushes the
 * database schema, creates storage buckets, and optionally deploys.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const rl = createInterface({ input: stdin, output: stdout });

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const ok = (s) => console.log(`${c.green("✓")} ${s}`);
const warn = (s) => console.log(`${c.yellow("!")} ${s}`);
const fail = (s) => console.log(`${c.red("✗")} ${s}`);

function heading(title) {
  console.log(`\n${c.bold(title)}\n${c.dim("─".repeat(Math.max(title.length, 24)))}`);
}

async function ask(question, { required = true, secret = false, defaultValue = "" } = {}) {
  for (;;) {
    const suffix = defaultValue ? c.dim(` (${defaultValue})`) : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim() || defaultValue;
    if (answer || !required) return answer;
    fail("That one is required.");
  }
}

async function confirm(question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const a = (await rl.question(`${question} ${c.dim(`[${hint}]`)} `)).trim().toLowerCase();
  if (!a) return defaultYes;
  return a.startsWith("y");
}

function has(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, { allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (res.status !== 0 && !allowFail) {
    fail(`\`${cmd} ${args.join(" ")}\` failed.`);
    return false;
  }
  return res.status === 0;
}

async function verifySupabase(url, serviceKey) {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function verifyLicense(key) {
  try {
    const res = await fetch("https://release-engine.pro/api/public/license/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json();
    if (body.valid) return { ok: true, offline: false };
    return {
      ok: false,
      error: body.reason === "revoked" ? "This licence key has been revoked." : "That licence key was not recognised.",
    };
  } catch {
    // Your install never depends on our servers being up.
    return { ok: true, offline: true };
  }
}

async function verifyGemini(key) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    if (res.status === 429) {
      warn("Gemini key is valid but its quota is exhausted — enable billing in Google Cloud.");
      return true;
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`
${c.bold("Release Engine — Solo Edition")}
${c.dim("One-time setup. Takes about ten minutes.")}
`);

  // ── Tools ────────────────────────────────────────────────────────────────
  heading("1. Checking your tools");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) {
    fail(`Node ${process.versions.node} found — you need Node 20 or newer.`);
    exit(1);
  }
  ok(`Node ${process.versions.node}`);

  if (!existsSync(resolve("node_modules"))) {
    warn("Dependencies are not installed. Running npm install…");
    if (!run("npm", ["install"])) exit(1);
  }
  ok("Dependencies installed");

  // ── Licence ──────────────────────────────────────────────────────────────
  heading("2. Your licence key");
  console.log(c.dim("The key emailed to you after purchase. Checked once, right now.\n"));

  for (;;) {
    const key = (await ask("Licence key")).trim();
    if (!/^SOLO-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/.test(key)) {
      fail("That does not look like a Release Engine licence key.");
      continue;
    }
    process.stdout.write("Verifying… ");
    const res = await verifyLicense(key);
    console.log("");
    if (res.ok) {
      ok(res.offline ? "Licence accepted (offline check)" : "Licence verified");
      break;
    }
    fail(res.error);
  }

  // ── Credentials ──────────────────────────────────────────────────────────
  heading("3. Your database (Supabase)");
  console.log(
    c.dim("Create a free project at https://supabase.com, then open Settings → API.\n"),
  );

  let supabaseUrl, publishableKey, serviceRoleKey;
  for (;;) {
    supabaseUrl = await ask("Project URL");
    publishableKey = await ask("Publishable (anon) key");
    serviceRoleKey = await ask("Service role key");
    process.stdout.write("Verifying… ");
    if (await verifySupabase(supabaseUrl, serviceRoleKey)) {
      console.log("");
      ok("Database connected");
      break;
    }
    console.log("");
    fail("Those credentials were rejected. Let's try again.");
  }

  heading("4. Your AI key (Google Gemini)");
  console.log(c.dim("Get one at https://aistudio.google.com/apikey — billing must be enabled.\n"));

  let geminiKey;
  for (;;) {
    geminiKey = await ask("Gemini API key");
    process.stdout.write("Verifying… ");
    if (await verifyGemini(geminiKey)) {
      console.log("");
      ok("AI key verified");
      break;
    }
    console.log("");
    fail("Google rejected that key. Let's try again.");
  }

  heading("5. Optional platform connections");
  console.log(
    c.dim("Skip any of these by pressing Enter. You can add them to .env later.\n"),
  );

  const optional = {};
  if (await confirm("Set up YouTube publishing now?", false)) {
    optional.YOUTUBE_OAUTH_CLIENT_ID = await ask("YouTube OAuth client ID", { required: false });
    optional.YOUTUBE_OAUTH_CLIENT_SECRET = await ask("YouTube OAuth client secret", { required: false });
    optional.YOUTUBE_API_KEY = await ask("YouTube API key", { required: false });
  }
  if (await confirm("Set up Instagram / Facebook posting now?", false)) {
    optional.META_APP_ID = await ask("Meta app ID", { required: false });
    optional.META_APP_SECRET = await ask("Meta app secret", { required: false });
  }
  if (await confirm("Set up TikTok posting now?", false)) {
    optional.TIKTOK_CLIENT_KEY = await ask("TikTok client key", { required: false });
    optional.TIKTOK_CLIENT_SECRET = await ask("TikTok client secret", { required: false });
  }
  if (await confirm("Set up SoundCloud uploads now?", false)) {
    optional.SOUNDCLOUD_CLIENT_ID = await ask("SoundCloud client ID", { required: false });
    optional.SOUNDCLOUD_CLIENT_SECRET = await ask("SoundCloud client secret", { required: false });
  }

  // ── .env ─────────────────────────────────────────────────────────────────
  heading("6. Writing your configuration");

  const stateSecret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const lines = [
    "# Release Engine — Solo Edition",
    "# Generated by npm run setup. Keep this file private.",
    "",
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `VITE_SUPABASE_URL=${supabaseUrl}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
    "",
    `GOOGLE_GENERATIVE_AI_API_KEY=${geminiKey}`,
    "",
    `YOUTUBE_OAUTH_STATE_SECRET=${stateSecret}`,
    ...Object.entries(optional)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`),
    "",
  ];

  if (existsSync(".env")) {
    writeFileSync(".env.backup", readFileSync(".env"));
    warn("Existing .env backed up to .env.backup");
  }
  writeFileSync(".env", lines.join("\n"));
  ok("Wrote .env");

  // ── Schema ───────────────────────────────────────────────────────────────
  heading("7. Setting up your database schema");

  const ref = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
  if (await confirm(`Push the schema to project ${c.cyan(ref)} now?`)) {
    if (!has("npx supabase")) warn("Supabase CLI will be fetched via npx.");
    run("npx", ["supabase", "link", "--project-ref", ref], { allowFail: true });
    if (run("npx", ["supabase", "db", "push"], { allowFail: true })) {
      ok("Schema applied");
    } else {
      warn("Schema push did not complete. Run `npx supabase db push` yourself once linked.");
    }
  } else {
    warn("Skipped. Run `npx supabase db push` before using the app.");
  }

  // ── Buckets ──────────────────────────────────────────────────────────────
  heading("8. Creating storage buckets");

  for (const name of ["audio", "videos", "store"]) {
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/storage/v1/bucket`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, id: name, public: false }),
      });
      if (res.ok) ok(`Bucket "${name}" created`);
      else if (res.status === 409) ok(`Bucket "${name}" already exists`);
      else warn(`Could not create bucket "${name}" — create it manually (private).`);
    } catch {
      warn(`Could not reach storage to create "${name}".`);
    }
  }

  // ── Deploy ───────────────────────────────────────────────────────────────
  heading("9. Deploy");

  if (await confirm("Build and deploy to Cloudflare Workers now?", false)) {
    if (run("npm", ["run", "build"])) {
      console.log(c.dim("\nPushing your secrets to Cloudflare…"));
      for (const key of [
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "YOUTUBE_OAUTH_STATE_SECRET",
        ...Object.keys(optional).filter((k) => optional[k]),
      ]) {
        const value =
          key === "YOUTUBE_OAUTH_STATE_SECRET"
            ? stateSecret
            : { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey, GOOGLE_GENERATIVE_AI_API_KEY: geminiKey }[key] ??
              optional[key];
        spawnSync("npx", ["wrangler", "secret", "put", key], {
          input: `${value}\n`,
          stdio: ["pipe", "inherit", "inherit"],
          shell: true,
        });
      }
      run("npx", ["wrangler", "deploy"], { allowFail: true });
    }
  } else {
    console.log(c.dim("\nWhen you're ready:  npm run build && npx wrangler deploy"));
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log(`
${c.green(c.bold("Setup complete."))}

Next: open your site at ${c.cyan("/setup")} and create your owner login.
That page locks itself the moment your account exists.

Local preview:  ${c.cyan("npm run dev")}
Docs:           ${c.cyan("README-SOLO.md")}
Licence:        ${c.cyan("LICENSE-SOLO.md")}
`);

  rl.close();
}

main().catch((err) => {
  fail(err?.message || String(err));
  rl.close();
  exit(1);
});