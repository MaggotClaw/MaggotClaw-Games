// Publish a build to the author's own Dropbox.
//
// Uploads the installer, writes the small version file the app reads, and
// prints the two links: the one friends download from, and the one the app
// checks. Keeps the newest two installers and clears out older ones so the
// folder never grows without limit.
//
// Usage:  node scripts/publish-to-dropbox.mjs [--notes "what changed"]
// Reads the Dropbox keys from the bridge's .env.

import { readFileSync, statSync, createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ENV_PATH = path.join(os.homedir(), "the-long-rot-mcp", ".env");
const NSIS_DIR = path.join(process.cwd(), "src-tauri", "target", "release", "bundle", "nsis");
const RELEASE_FOLDER = "/MaggotClaw Games/App Releases";
const MANIFEST_PATH = `${RELEASE_FOLDER}/latest-version.json`;
const KEEP = 2;

function readEnv() {
  const text = readFileSync(ENV_PATH, "utf8");
  const get = (key) => {
    const line = text.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  };
  return { key: get("DROPBOX_APP_KEY"), secret: get("DROPBOX_APP_SECRET"), refresh: get("DROPBOX_REFRESH_TOKEN") };
}

let token = "";
async function auth(env) {
  if (token) return token;
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: env.refresh,
    client_id: env.key, client_secret: env.secret
  });
  const res = await fetch("https://api.dropbox.com/oauth2/token", { method: "POST", body });
  const json = await res.json();
  if (!json.access_token) throw new Error("Dropbox sign-in failed: " + JSON.stringify(json));
  token = json.access_token;
  return token;
}

async function api(env, endpoint, body) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { authorization: `Bearer ${await auth(env)}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function upload(env, localPath, dropboxPath) {
  const size = statSync(localPath).size;
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await auth(env)}`,
      "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath, mode: "overwrite", autorename: false, mute: true }),
      "content-type": "application/octet-stream",
      "content-length": String(size)
    },
    body: createReadStream(localPath),
    duplex: "half"
  });
  const json = await res.json();
  if (!json.path_display) throw new Error("Upload failed: " + JSON.stringify(json).slice(0, 300));
  return json.path_display;
}

// A direct-download link: dl=1 hands over the file rather than a preview page.
async function shareLink(env, dropboxPath) {
  let made = await api(env, "sharing/create_shared_link_with_settings", { path: dropboxPath });
  if (!made.url) {
    const listed = await api(env, "sharing/list_shared_links", { path: dropboxPath, direct_only: true });
    made = listed?.links?.[0] ?? {};
  }
  if (!made.url) throw new Error("Could not make a share link for " + dropboxPath);
  return made.url.replace(/([?&])dl=0/, "$1dl=1") + (made.url.includes("dl=") ? "" : "?dl=1");
}

const notesIndex = process.argv.indexOf("--notes");
const notes = notesIndex > -1 ? process.argv[notesIndex + 1] ?? "" : "";

const env = readEnv();
const files = (await readdir(NSIS_DIR)).filter((f) => f.endsWith("-setup.exe"));
if (!files.length) throw new Error("No installer found in " + NSIS_DIR);

// Newest by version in the filename.
const versionOf = (f) => (f.match(/_([0-9][^_]*)_x64-setup\.exe$/) ?? [])[1] ?? "0";
files.sort((a, b) => statSync(path.join(NSIS_DIR, b)).mtimeMs - statSync(path.join(NSIS_DIR, a)).mtimeMs);
const newest = files[0];
const version = versionOf(newest);
const sizeMb = (statSync(path.join(NSIS_DIR, newest)).size / 1048576).toFixed(0);

console.log(`Publishing ${newest} (version ${version}, ${sizeMb} MB)…`);
await api(env, "files/create_folder_v2", { path: RELEASE_FOLDER });
const uploaded = await upload(env, path.join(NSIS_DIR, newest), `${RELEASE_FOLDER}/${newest}`);
const installerUrl = await shareLink(env, uploaded);

const manifest = { version, installerUrl, notes, publishedAt: new Date().toISOString() };
await fetch("https://content.dropboxapi.com/2/files/upload", {
  method: "POST",
  headers: {
    authorization: `Bearer ${await auth(env)}`,
    "Dropbox-API-Arg": JSON.stringify({ path: MANIFEST_PATH, mode: "overwrite", autorename: false, mute: true }),
    "content-type": "application/octet-stream"
  },
  body: JSON.stringify(manifest, null, 2)
});
const manifestUrl = await shareLink(env, MANIFEST_PATH);

// Tidy: keep only the newest few installers on Dropbox.
const listed = await api(env, "files/list_folder", { path: RELEASE_FOLDER });
const olds = (listed.entries ?? [])
  .filter((e) => e[".tag"] === "file" && e.name.endsWith("-setup.exe") && e.name !== newest)
  .sort((a, b) => new Date(b.server_modified) - new Date(a.server_modified))
  .slice(KEEP - 1);
for (const old of olds) {
  await api(env, "files/delete_v2", { path: old.path_display });
  console.log("  removed older build:", old.name);
}

console.log("\nPublished.");
console.log("  Download link (send this to people):");
console.log("   ", installerUrl);
console.log("  Update file (this goes in the app's update setting):");
console.log("   ", manifestUrl);
