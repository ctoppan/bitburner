/** @param {NS} ns **/
export async function main(ns) {
  const nextScript = String(ns.args[0] ?? "");
  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const owner = "ctoppan";
  const repo = "bitburner-automation";
  const branch = "sf4-starter";
  const srcPrefix = "src/";

  const treeApi = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const manifestFile = "/temp/github-tree.json";

  printBanner(ns, owner, repo, branch, "start-download-only.js");
  ns.tprint(`[downloader] Fetching repo tree from GitHub...`);

  if (ns.fileExists(manifestFile, "home")) {
    ns.rm(manifestFile, "home");
  }

  const manifestOk = await ns.wget(`${treeApi}&ts=${Date.now()}`, manifestFile);
  if (!manifestOk || !ns.fileExists(manifestFile, "home")) {
    ns.tprint("[downloader] Failed to fetch repo tree.");
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(ns.read(manifestFile));
  } catch (e) {
    ns.tprint(`[downloader] Failed to parse repo tree JSON: ${String(e)}`);
    return;
  }

  if (!manifest?.tree || !Array.isArray(manifest.tree)) {
    ns.tprint("[downloader] Repo tree response did not contain a tree array.");
    return;
  }

  if (manifest.truncated) {
    ns.tprint("[downloader] Warning: GitHub tree response was truncated.");
    ns.tprint("[downloader] For huge repos, you may need a narrower path strategy.");
  }

  const files = manifest.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(srcPrefix) &&
        entry.path.endsWith(".js")
    )
    .map((entry) => entry.path)
    .sort();

  if (files.length === 0) {
    ns.tprint("[downloader] No .js files found under src/.");
    return;
  }

  ns.tprint(`[downloader] Found ${files.length} .js files under src/.`);

  let okCount = 0;
  let failCount = 0;

  for (const path of files) {
    const relativePath = path.slice(srcPrefix.length);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?ts=${Date.now()}`;

    if (ns.fileExists(relativePath, "home")) {
      ns.rm(relativePath, "home");
    }

    ns.tprint(`[downloader] Downloading ${path} -> ${relativePath}`);

    const ok = await ns.wget(rawUrl, relativePath);

    if (ok && ns.fileExists(relativePath, "home")) {
      okCount++;
    } else {
      failCount++;
      ns.tprint(`[downloader] Failed: ${path}`);
    }

    await ns.sleep(50);
  }

  ns.tprint(`[downloader] Done. Success: ${okCount}, Failed: ${failCount}`);

  if (nextScript) {
    if (ns.fileExists(nextScript, "home")) {
      ns.tprint(`[downloader] Launching ${nextScript}...`);
      ns.spawn(nextScript, 1);
    } else {
      ns.tprint(`[downloader] Skipping launch. Missing ${nextScript}`);
    }
  }
}

function printBanner(ns, owner, repo, branch, source) {
  ns.tprint("=".repeat(60));
  ns.tprint(`[bootstrap] ${source}`);
  ns.tprint(`[bootstrap] repo   : ${owner}/${repo}`);
  ns.tprint(`[bootstrap] branch : ${branch}`);
  ns.tprint("=".repeat(60));
}