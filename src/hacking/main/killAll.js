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
  "/hacking/main/backdoorHelper.js",
  "/xp/xpGrind.js",
  "/xp/xpDistributor.js",
  "/xp/stopXpGrind.js",
];

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

/** @param {NS} ns **/
export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting killAll.js`);

  const scriptToRunAfter = String(ns.args[0] ?? "/hacking/batch/overlapBatchController.js");
  const scriptArgs = ns.args.slice(1);

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  for (const script of scriptsToKillOnHome) {
    try {
      ns.kill(script, "home");
    } catch {}
  }

  const seen = new Set(["home"]);
  const queue = ["home"];
  const servers = [];

  while (queue.length > 0) {
    const host = queue.shift();
    servers.push(host);

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  for (const host of servers) {
    if (host === "home") continue;
    if (!ns.serverExists(host)) continue;

    try {
      ns.killall(host);
    } catch {}
  }

  ns.tprint(`[${localeHHMMSS()}] All remote processes killed`);

  if (!ns.fileExists(scriptToRunAfter, "home")) {
    ns.tprint(`[${localeHHMMSS()}] ERROR: Missing ${scriptToRunAfter}`);
    return;
  }

  ns.tprint(
    `[${localeHHMMSS()}] Spawning ${scriptToRunAfter}${scriptArgs.length ? ` ${scriptArgs.join(" ")}` : ""}`
  );

  ns.spawn(scriptToRunAfter, 1, ...scriptArgs);
}