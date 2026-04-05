/** @param {NS} ns **/
export async function main(ns) {
  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const repoBase = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src";
  const downloader = "bootstrap/start-download-only.js";
  const nextScript = "/bootstrap/initHacking.js";
  const url = `${repoBase}/${downloader}?ts=${Date.now()}`;

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
