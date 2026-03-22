const baseUrl = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src/";

// Toggle which hacking system to run
const USE_OVERLAP_BATCH = true;

function stockApiUnlocked(ns) {
  try {
    return !!(ns.stock && ns.stock.hasTIXAPIAccess && ns.stock.hasTIXAPIAccess());
  } catch {
    return false;
  }
}

function getFilesToDownload(ns) {
  const files = [
    // core
    "common.js",
    "spider.js",
    "find.js",
    "backdoorHelper.js",

    // legacy system (kept for fallback)
    "mainHack.js",
    "grow.js",
    "hack.js",
    "weaken.js",
    "runHacking.js",

    // management
    "killAll.js",
    "playerServers.js",

    // batch system
    "prepTarget.js",
    "batchHack.js",
    "batchGrow.js",
    "batchWeaken.js",
    "batchController.js",
    "overlapBatchController.js",
  ];

  if (stockApiUnlocked(ns)) {
    files.push("stockTrader.js");
  }

  return files;
}

const valuesToRemove = ["BB_SERVER_MAP"];

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting initHacking.js`);

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const stockEnabled = stockApiUnlocked(ns);
  const filesToDownload = getFilesToDownload(ns);

  ns.tprint(
    `[${localeHHMMSS()}] Stock API ${stockEnabled ? "detected, including stockTrader.js" : "not unlocked, skipping stockTrader.js"}`
  );

  for (const filename of filesToDownload) {
    const path = `${baseUrl}${filename}?ts=${Date.now()}`;

    try {
      await ns.scriptKill(filename, "home");
    } catch {}

    try {
      await ns.rm(filename, "home");
    } catch {}

    await ns.sleep(50);

    ns.tprint(`[${localeHHMMSS()}] Downloading ${filename}`);
    const ok = await ns.wget(path, filename);

    if (!ok) {
      ns.tprint(`[WARN ${localeHHMMSS()}] Failed to download ${filename}`);
    }
  }

  for (const key of valuesToRemove) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  const nextScript = USE_OVERLAP_BATCH ? "overlapBatchController.js" : "runHacking.js";

  ns.tprint(`[${localeHHMMSS()}] Starting killAll.js -> ${nextScript}`);
  ns.run("killAll.js", 1, nextScript);

  // Let the reset + spider chain finish.
  await ns.sleep(15000);

  if (!ns.isRunning("playerServers.js", "home")) {
    ns.tprint(`[${localeHHMMSS()}] Starting playerServers.js`);
    ns.run("playerServers.js", 1);
  }

  if (stockEnabled && !ns.isRunning("stockTrader.js", "home")) {
    ns.tprint(`[${localeHHMMSS()}] Starting stockTrader.js`);
    ns.run("stockTrader.js", 1);
  }
}