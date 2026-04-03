const scriptsToKillOnHome = [
  "/hacking/main/mainHack.js",
  "/hacking/main/spider.js",
  "/hacking/main/grow.js",
  "/hacking/main/hack.js",
  "/hacking/main/weaken.js",
  "/hacking/main/runHacking.js",
  "/hacking/main/find.js",
  "/hacking/main/prepTarget.js",
  "/hacking/batch/batchHack.js",
  "/hacking/batch/batchGrow.js",
  "/hacking/batch/batchWeaken.js",
  "/hacking/batch/batchController.js",
  "/hacking/batch/overlapBatchController.js",
  "/bootstrap/hackOrchestrator.js", // 🔥 also kill orchestrator
  "/utils/backdoorHelper.js",
  "/xp/xpGrind.js",
  "/xp/xpDistributor.js",
  "/xp/stopXpGrind.js",
];

function ts() {
  return new Date().toLocaleTimeString();
}

/** @param {NS} ns **/
export async function main(ns) {
  ns.tprint(`[${ts()}] Starting killAll.js`);

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  // 🔥 Kill specific scripts on home
  for (const script of scriptsToKillOnHome) {
    try {
      ns.scriptKill(script, "home");
    } catch {}
  }

  // 🔥 Also kill ANY leftover processes on home (safety net)
  for (const proc of ns.ps("home")) {
    try {
      ns.kill(proc.pid);
    } catch {}
  }

  // 🔥 Kill everything on all servers
  const seen = new Set(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  for (const host of seen) {
    if (host === "home") continue;
    if (!ns.serverExists(host)) continue;

    try {
      ns.killall(host);
    } catch {}
  }

  ns.tprint(`[${ts()}] All processes killed`);
}