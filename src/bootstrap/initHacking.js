const REPO_OWNER = "ctoppan";
const REPO_NAME = "bitburner";
const REPO_REF = "master";
const REPO_SRC_DIR = "src/";

const baseUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_REF}/${REPO_SRC_DIR}`;
const treeApiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_REF}?recursive=1`;

// Toggle which hacking system to run
const USE_OVERLAP_BATCH = true;

// Modern overlap args:
// [hackPct, homeReserveGb, maxBatches, spacer]
// Use -1 to enable auto home reserve.
const OVERLAP_ARGS = [0.03, -1, 1024, 30];

// Set growth mode automatically on fresh starts unless user already picked something.
const AUTO_SET_SPEND_MODE_IF_MISSING = true;
const DEFAULT_SPEND_MODE = "growth";

// Home-upgrade coordination for non-Singularity play.
const HOME_RAM_TARGET = 316.788e9;
const HOME_CORE_TARGET = 421.875e9;
const PREFER_HOME_RAM = true;
const CORE_COST_VS_RAM_COST_THRESHOLD = 0.6;
const HOME_RESERVE_BUFFER = 1.1;

const REPO_TREE_CACHE_FILE = "/Temp/initHacking.repoTree.json";
const valuesToRemove = ["BB_SERVER_MAP"];

function stockApiUnlocked(ns) {
  try {
    return !!(ns.stock && ns.stock.hasTIXAPIAccess && ns.stock.hasTIXAPIAccess());
  } catch {
    return false;
  }
}

function getFallbackFiles() {
  return [
    "bootstrap/cleanup.js",
    "bootstrap/start-download-only.js",
    "bootstrap/start.js",
    "crime/check-karma.js",
    "crime/commitCrime.js",
    "crime/getCrimesData.js",
    "crime/getCrimesData2.js",
    "crime/karmaReducer.js",
    "gang/gangFastAscender_v2.js",
    "gang/gangManager_v2.js",
    "gang/prepareGang.js",
    "hacking/batch/batchController.js",
    "hacking/batch/batchGrow.js",
    "hacking/batch/batchHack.js",
    "hacking/batch/batchWeaken.js",
    "hacking/batch/overlapBatchController.js",
    "hacking/main/backdoorHelper.js",
    "hacking/main/find.js",
    "hacking/main/fleetfree.js",
    "hacking/main/grow.js",
    "hacking/main/hack.js",
    "hacking/main/killAll.js",
    "hacking/main/mainHack.js",
    "hacking/main/network-status.js",
    "hacking/main/playerServers.js",
    "hacking/main/prepTarget.js",
    "hacking/main/runHacking.js",
    "hacking/main/spider.js",
    "hacking/main/spread-hack.js",
    "hacking/main/weaken.js",
    "manual/browser/browserAutoHack.js",
    "manual/browser/hackingMission.js",
    "share/share-home.js",
    "share/share-manager.js",
    "share/share-worker.js",
    "stockmarket/sellAllStock.js",
    "stockmarket/stockMarketer.js",
    "stockmarket/stockMarketer4S.js",
    "stockmarket/stockTrader.js",
    "utils/common.js",
    "utils/contracter.js",
    "utils/factionChecklist.js",
    "utils/setSpendMode.js",
    "xp/stopXpGrind.js",
    "xp/xpDistributor.js",
    "xp/xpGrind.js",
  ];
}

async function getFilesToDownload(ns) {
  try {
    if (ns.fileExists(REPO_TREE_CACHE_FILE, "home")) {
      ns.rm(REPO_TREE_CACHE_FILE, "home");
    }

    const ok = await ns.wget(`${treeApiUrl}&ts=${Date.now()}`, REPO_TREE_CACHE_FILE);

    if (!ok || !ns.fileExists(REPO_TREE_CACHE_FILE, "home")) {
      throw new Error("repo tree download failed");
    }

    const raw = ns.read(REPO_TREE_CACHE_FILE);
    const parsed = JSON.parse(raw);
    const files = (parsed.tree || [])
      .filter((entry) => entry && entry.type === "blob")
      .map((entry) => entry.path)
      .filter((path) => typeof path === "string")
      .filter((path) => path.startsWith(REPO_SRC_DIR) && path.endsWith(".js"))
      .map((path) => path.slice(REPO_SRC_DIR.length))
      .filter((path) => path && path !== "bootstrap/initHacking.js")
      .sort((a, b) => a.localeCompare(b));

    if (!files.length) {
      throw new Error("repo tree returned zero script files");
    }

    return files;
  } catch (error) {
    ns.tprint(`[WARN ${localeHHMMSS()}] Falling back to built-in file list: ${String(error)}`);
    return getFallbackFiles();
  } finally {
    try {
      if (ns.fileExists(REPO_TREE_CACHE_FILE, "home")) {
        ns.rm(REPO_TREE_CACHE_FILE, "home");
      }
    } catch {}
  }
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

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

function ensureSpendMode(ns) {
  if (!AUTO_SET_SPEND_MODE_IF_MISSING) return;

  try {
    const key = "bb_spend_mode_v1";
    const existing = localStorage.getItem(key);
    if (!existing) {
      localStorage.setItem(key, JSON.stringify(DEFAULT_SPEND_MODE));
      ns.tprint(`[${localeHHMMSS()}] Default spend mode set to ${DEFAULT_SPEND_MODE}`);
    }
  } catch {}
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting initHacking.js`);

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const stockEnabled = stockApiUnlocked(ns);
  const filesToDownload = await getFilesToDownload(ns);

  ns.tprint(
    `[${localeHHMMSS()}] Refreshing ${filesToDownload.length} repo scripts${stockEnabled ? " (stock API detected)" : ""}`
  );

  for (const filename of filesToDownload) {
    const path = `${baseUrl}${filename}?ts=${Date.now()}`;

    try { await ns.scriptKill(filename, "home"); } catch {}
    try { await ns.rm(filename, "home"); } catch {}

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

  ensureSpendMode(ns);

  const nextScript = USE_OVERLAP_BATCH ? "/hacking/batch/overlapBatchController.js" : "/hacking/main/runHacking.js";
  const nextArgs = USE_OVERLAP_BATCH ? OVERLAP_ARGS : [];

  ns.tprint(
    `[${localeHHMMSS()}] Starting killAll.js -> ${nextScript}${nextArgs.length ? ` ${nextArgs.join(" ")}` : ""}`
  );

  ns.run("/hacking/main/killAll.js", 1, nextScript, ...nextArgs);

  await ns.sleep(15000);

  if (!ns.isRunning("/hacking/main/playerServers.js", "home")) {
    ns.tprint(`[${localeHHMMSS()}] Starting playerServers.js`);
    ns.run("/hacking/main/playerServers.js", 1);
  }

  if (stockEnabled) {
    ns.tprint(
      `[${localeHHMMSS()}] Stock API detected, but stockTrader.js auto-start is disabled for now`
    );
  }

  // Keep the constants referenced so they are easy to tweak later.
  void getHomeUpgradeTarget();
  void HOME_RESERVE_BUFFER;
}