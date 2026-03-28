/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const now = () => new Date().toLocaleTimeString();

  const overlapArgs = [0.03, -1, 1024, 30];
  const killAllScript = "/hacking/main/killAll.js";
  const overlapScript = "/hacking/batch/overlapBatchController.js";
  const playerServersScript = "/hacking/main/playerServers.js";

  ns.tprint(`[${now()}] Starting initHacking.js`);
  ns.tprint(`[${now()}] Repo sync already completed by start-download-only.js`);
  ns.tprint(`[${now()}] Starting killAll.js -> ${overlapScript} ${overlapArgs.join(" ")}`);

  if (!ns.fileExists(killAllScript, "home")) {
    ns.tprint(`[${now()}] ERROR: Missing ${killAllScript}`);
    return;
  }

  ns.spawn(killAllScript, 1, overlapScript, ...overlapArgs);
}