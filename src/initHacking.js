const baseUrl = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src/";

// Toggle which hacking system to run
const USE_OVERLAP_BATCH = true;

// Default overlap controller startup args.
// These are just starting values. overlapBatchController.js auto-tunes from here.
const OVERLAP_ARGS = [0.03, 150, 128];

// Home-upgrade coordination for non-Singularity play.
// Update these after each manual home purchase.
const HOME_RAM_TARGET = 316.788e9;
const HOME_CORE_TARGET = 421.875e9;
const PREFER_HOME_RAM = true;
const CORE_COST_VS_RAM_COST_THRESHOLD = 0.6;
const HOME_RESERVE_BUFFER = 1.1;

function stockApiUnlocked(ns) {
  try {
    return !!(ns.stock && ns.stock.hasTIXAPIAccess && ns.stock.hasTIXAPIAccess());
  } catch {
    return false;
  }
}

function getFilesToDownload(ns) {
  const files = [
    "common.js",
    "spider.js",
    "find.js",
    "backdoorHelper.js",
    "mainHack.js",
    "grow.js",
    "hack.js",
    "weaken.js",
    "runHacking.js",
    "killAll.js",
    "playerServers.js",
    "prepTarget.js",
    "batchHack.js",
    "batchGrow.js",
    "batchWeaken.js",
    "batchController.js",
    "overlapBatchController.js",
    "stopXpGrind.js",
    "fleetfree.js",
    "setSpendMode.js",
  ];

  if (stockApiUnlocked(ns)) {
    files.push("stockTrader.js");
  }

  return files;
}

function getHomeUpgradeTarget() {
  if (!PREFER_HOME_RAM) {
    return Math.min(HOME_RAM_TARGET, HOME_CORE_TARGET);
  }

  if (HOME_CORE_TARGET < HOME_RAM_TARGET * CORE_COST_VS_RAM_COST_THRESHOLD) {
    return HOME_CORE_TARGET;
  }

  return HOME_RAM_TARGET;
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
  const nextArgs = USE_OVERLAP_BATCH ? OVERLAP_ARGS : [];

  ns.tprint(
    `[${localeHHMMSS()}] Starting killAll.js -> ${nextScript}${nextArgs.length ? ` ${nextArgs.join(" ")}` : ""}`
  );

  ns.run("killAll.js", 1, nextScript, ...nextArgs);

  await ns.sleep(15000);

  if (!ns.isRunning("playerServers.js", "home")) {
    ns.tprint(`[${localeHHMMSS()}] Starting playerServers.js`);
    ns.run("playerServers.js", 1);
  }

  if (stockEnabled) {
    ns.tprint(
      `[${localeHHMMSS()}] Stock API detected, but stockTrader.js auto-start is disabled for now`
    );
  }
}