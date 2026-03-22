const scriptsToKillOnHome = [
  // legacy
  "mainHack.js",
  "spider.js",
  "grow.js",
  "hack.js",
  "weaken.js",
  "runHacking.js",
  "initHacking.js",
  "start.js",
  "find.js",

  // batch
  "prepTarget.js",
  "batchHack.js",
  "batchGrow.js",
  "batchWeaken.js",
  "batchController.js",
  "overlapBatchController.js",
];

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting killAll.js`);

  const scriptToRunAfter = String(ns.args[0] ?? "");
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

  // Always rebuild the map after a reset so purchased server changes are reflected.
  const nextScript = scriptToRunAfter || "overlapBatchController.js";
  ns.tprint(`[${localeHHMMSS()}] Spawning spider.js -> ${nextScript}`);
  ns.spawn("spider.js", 1, nextScript);
}