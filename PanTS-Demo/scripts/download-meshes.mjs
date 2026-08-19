// Capture-only helper for the launch video (branch: demo/cinematic-capture).
//
// Pulls one case's mesh manifest and every organ GLB to public/meshes/<caseId>/,
// rewriting the manifest's urls to those local paths. After this runs, /cinematic
// can shoot the cold open with no backend at all — same trick as download-thumbs.mjs
// does for /wall.
//
//   node scripts/download-meshes.mjs --api http://localhost:8000 --case 17
//
// Re-runnable: already-downloaded GLBs are skipped. Use --session for an uploaded
// scan (session id) rather than a dataset case.
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = 4;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const API = String(arg("api", "http://localhost:8000")).replace(/\/$/, "");
const CASE_ID = arg("case", "");
const IS_SESSION = process.argv.includes("--session");

if (!CASE_ID) {
  console.error("usage: node scripts/download-meshes.mjs --api <url> --case <id> [--session]");
  process.exit(1);
}

const OUT_DIR = join(HERE, "..", "public", "meshes", String(CASE_ID));

/**
 * The server bakes fully-qualified urls into the manifest, pointing at the public
 * hostname. Always fetch via --api instead: that host may be unreachable (broken
 * proxy, no DNS, off-network) while the backend behind an SSH tunnel is fine.
 * Keep only the path and re-root it.
 */
function resolveUrl(url) {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // already relative
  }
  return `${API}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Stable local filename for an organ's GLB. */
function localName(organ) {
  const fromUrl = basename(String(organ.url).split("?")[0]);
  if (fromUrl && fromUrl.toLowerCase().endsWith(".glb")) return fromUrl;
  return `${organ.key ?? organ.id}.glb`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const manifestUrl = IS_SESSION
    ? `${API}/api/sessions/${CASE_ID}/mesh-manifest`
    : `${API}/api/cases/${CASE_ID}/mesh-manifest`;

  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`manifest failed (${res.status}) at ${manifestUrl}`);
  const manifest = await res.json();

  const organs = manifest.organs ?? [];
  if (!organs.length) throw new Error("manifest has no organs");
  console.log(`case ${CASE_ID}: ${organs.length} organs`);

  let done = 0;
  let failed = 0;
  const queue = [...organs];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const organ = queue.shift();
      const name = localName(organ);
      const dest = join(OUT_DIR, name);
      try {
        if (!(await exists(dest))) {
          const r = await fetch(resolveUrl(organ.url));
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          await writeFile(dest, Buffer.from(await r.arrayBuffer()));
        }
        // Point the saved manifest at the local copy. Vite serves public/ at the
        // web root, so /meshes/<case>/<file>.glb resolves with no API involved.
        organ.url = `/meshes/${CASE_ID}/${name}`;
        console.log(`  ${++done}/${organs.length} ${organ.name ?? organ.key ?? organ.id}`);
      } catch (e) {
        failed++;
        console.warn(`  ${organ.name ?? organ.id}: ${e.message}`);
      }
    }
  });

  await Promise.all(workers);

  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest));

  console.log(`\ndone — ${done} meshes, ${failed} failed`);
  if (failed) console.log("some organs missing; the assemble will skip them");
  console.log(`open /cinematic/${CASE_ID}?local=1`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
