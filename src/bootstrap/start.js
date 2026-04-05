/** @param {NS} ns **/
export async function main(ns) {
  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const owner = "ctoppan";
  const repo = "bitburner-automation";
  const branch = "sf4-starter";

  const repoBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/src`;
  const downloader = "bootstrap/start-download-only.js";
  const nextScript = "/bootstrap/initHacking.js";
  const url = `${repoBase}/${downloader}?ts=${Date.now()}`;

  printBanner(ns, owner, repo, branch, "start.js");

  ns.tprint(`[start.js] Refreshing ${downloader}...`);

  if (ns.fileExists(downloader, "home")) {
    ns.rm(downloader, "home");
  }

  const ok = await ns.wget(url, downloader);

  if (!ok || !ns.fileExists(downloader, "home")) {
    ns.tprint(`[start.js] Failed to download ${downloader}`);
    return;
  }

  ns.tprint(`[start.js] Launching ${downloader} -> ${nextScript}...`);
  ns.spawn(downloader, 1, nextScript);
}

function printBanner(ns, owner, repo, branch, source) {
  ns.tprint("=".repeat(60));
  ns.tprint(`[bootstrap] ${source}`);
  ns.tprint(`[bootstrap] repo   : ${owner}/${repo}`);
  ns.tprint(`[bootstrap] branch : ${branch}`);
  ns.tprint("=".repeat(60));
}