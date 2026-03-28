/** @param {NS} ns **/
export async function main(ns) {
  const worker = "/share/share-worker.js";
  const refreshMs = 10000;
  const homeReserve = 64;

  ns.disableLog("ALL");

  const scriptRam = ns.getScriptRam(worker);
  if (scriptRam <= 0) {
    ns.tprint(`ERROR: ${worker} not found.`);
    return;
  }

  while (true) {
    await deployShareAcrossNetwork(ns, worker, scriptRam, homeReserve);
    const stats = getShareStats(ns, worker);

    ns.clearLog();
    ns.print("=== SHARE MANAGER ===");
    ns.print("Mode: MANUAL");
    ns.print("Auto faction detection: UNAVAILABLE");
    ns.print("Reason: Requires Source-File 4 / Singularity");
    ns.print("");
    ns.print(`Servers running share: ${stats.servers}`);
    ns.print(`Total share threads: ${stats.threads}`);
    ns.print(`Share multiplier: x${formatNum(stats.multiplier)}`);
    ns.print("");
    ns.print("To verify faction boost:");
    ns.print("1. Start faction work manually");
    ns.print("2. Note rep/sec on faction screen");
    ns.print("3. Leave this running");
    ns.print("4. Rep/sec should be higher");
    ns.print("");
    ns.print(`Next refresh: ${Math.floor(refreshMs / 1000)}s`);

    await ns.sleep(refreshMs);
  }
}

/** @param {NS} ns **/
async function deployShareAcrossNetwork(ns, worker, scriptRam, homeReserve) {
  const servers = getAllServers(ns)
    .filter(host => ns.hasRootAccess(host))
    .sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a));

  for (const host of servers) {
    if (host !== "home") {
      await ns.scp(worker, host, "home");
    }

    ns.scriptKill(worker, host);

    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const reserve = host === "home" ? homeReserve : 0;
    const freeRam = Math.max(0, maxRam - usedRam - reserve);
    const threads = Math.floor(freeRam / scriptRam);

    if (threads > 0) {
      ns.exec(worker, host, threads);
    }
  }
}

/** @param {NS} ns **/
function getShareStats(ns, worker) {
  let totalThreads = 0;
  let activeServers = 0;

  for (const host of getAllServers(ns)) {
    if (!ns.hasRootAccess(host)) continue;

    const procs = ns.ps(host).filter(p => p.filename === worker);
    if (procs.length > 0) {
      activeServers++;
      for (const p of procs) {
        totalThreads += p.threads;
      }
    }
  }

  return {
    threads: totalThreads,
    servers: activeServers,
    multiplier: calcShareMultiplier(ns, worker, totalThreads),
  };
}

/** @param {NS} ns **/
function calcShareMultiplier(ns, worker, totalThreads) {
  if (totalThreads <= 0) return 1;

  try {
    if (ns.formulas && ns.fileExists("Formulas.exe", "home")) {
      let power = 0;

      for (const host of getAllServers(ns)) {
        if (!ns.hasRootAccess(host)) continue;

        const procs = ns.ps(host).filter(p => p.filename === worker);
        if (procs.length === 0) continue;

        const threads = procs.reduce((sum, p) => sum + p.threads, 0);
        const server = ns.getServer(host);
        const cores = Math.max(1, server.cpuCores || 1);

        power += ns.formulas.reputation.sharePower(threads, cores);
      }

      return 1 + power;
    }
  } catch {}

  return 1 + Math.log(totalThreads + 1) / 8;
}

/** @param {NS} ns **/
function getAllServers(ns) {
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

  return [...seen];
}

function formatNum(n) {
  if (typeof n !== "number" || !isFinite(n)) return "0";
  return n >= 100 ? n.toFixed(1) : n.toFixed(3);
}