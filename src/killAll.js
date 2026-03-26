const scriptsToKillOnHome = [
  "mainHack.js",
  "spider.js",
  "grow.js",
  "hack.js",
  "weaken.js",
  "runHacking.js",
  "find.js",
  "prepTarget.js",
  "batchHack.js",
  "batchGrow.js",
  "batchWeaken.js",
  "batchController.js",
  "overlapBatchController.js",
  "backdoorHelper.js",
  "xpGrind.js",
  "xpDistributor.js",
  "stopXpGrind.js",
];

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

/** @param {NS} ns **/
export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting killAll.js`);

  const scriptToRunAfter = String(ns.args[0] ?? "");
  const scriptArgs = ns.args.slice(1);
  const hostname = ns.getHostname();

  if (hostname !== "home") {
    throw new Error("Run the script from home");
  }

  for (const script of scriptsToKillOnHome) {
    try {
      await ns.scriptKill(script, "home");
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
      await ns.killall(host);
    } catch {}
  }

  ns.tprint(`[${localeHHMMSS()}] All remote processes killed`);

  const nextScript = scriptToRunAfter || "overlapBatchController.js";
  ns.tprint(
    `[${localeHHMMSS()}] Spawning spider.js -> ${nextScript}${scriptArgs.length ? ` ${scriptArgs.join(" ")}` : ""}`
  );

  ns.spawn("spider.js", 1, nextScript, ...scriptArgs);
}