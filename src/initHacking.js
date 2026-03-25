const REPO_OWNER = "ctoppan";
const REPO_NAME = "bitburner";
const REPO_REF = "master";
const REPO_SRC_DIR = "src/";

const baseUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_REF}/${REPO_SRC_DIR}`;
const treeApiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_REF}?recursive=1`;

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

const REPO_TREE_CACHE_FILE = "/Temp/initHacking.repoTree.json";

function stockApiUnlocked(ns) {
  try {
    return !!(ns.stock && ns.stock.hasTIXAPIAccess && ns.stock.hasTIXAPIAccess());
  } catch {
    return false;
  }
}

function getFallbackFiles() {
  return [
    "backdoorHelper.js",
    "batchController.js",
    "batchGrow.js",
    "batchHack.js",
    "batchWeaken.js",
    "browserAutoHack.js",
    "commitCrime.js",
    "common.js",
    "contracter.js",
    "factionChecklist.js",
    "find.js",
    "fleetfree.js",
    "gangFastAscender.js",
    "gangManager.js",
    "getCrimesData.js",
    "getCrimesData2.js",
    "grow.js",
    "hack.js",
    "hackingMission.js",
    "karmaReducer.js",
    "killAll.js",
    "mainHack.js",
    "overlapBatchController.js",
    "playerServers.js",
    "prepareGang.js",
    "prepTarget.js",
    "progressionManager.js",
    "runHacking.js",
    "sellAllStock.js",
    "setSpendMode.js",
    "share-home.js",
    "share-manager.js",
    "share-worker.js",
    "spider.js",
    "start.js",
    "stockMarketer.js",
    "stockMarketer4S.js",
    "stockTrader.js",
    "stopXpGrind.js",
    "weaken.js",
    "xpDistributor.js",
    "xpGrind.js",
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
      .filter((path) => path && path !== "initHacking.js")
      .sort((a, b) => a.localeCompare(b));

    if (!files.length) {
      throw new Error("repo tree returned zero script files");
    }

    return files;
  } catch (error) {
    ns.tprint(
      `[WARN ${localeHHMMSS()}] Falling back to built-in file list: ${String(error)}`
    );
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
  const filesToDownload = await getFilesToDownload(ns);

  ns.tprint(
    `[${localeHHMMSS()}] Refreshing ${filesToDownload.length} repo scripts${stockEnabled ? " (stock API detected)" : ""}`
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
