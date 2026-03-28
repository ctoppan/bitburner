/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const HOME_RESERVED_RAM = 32; // keep some RAM free on home
  const WORKER = "/tmp/spread-worker.js";

  const workerCode = `
/** @param {NS} ns **/
export async function main(ns) {
  const target = ns.args[0];
  if (!target) {
    ns.tprint("No target provided.");
    return;
  }

  ns.disableLog("ALL");

  while (true) {
    const minSec = ns.getServerMinSecurityLevel(target);
    const sec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const money = ns.getServerMoneyAvailable(target);

    if (sec > minSec + 5) {
      await ns.weaken(target);
    } else if (money < maxMoney * 0.75) {
      await ns.grow(target);
    } else {
      await ns.hack(target);
    }
  }
}
`.trim() + "\n";

  ns.write(WORKER, workerCode, "w");

  while (true) {
    const allServers = discoverAllServers(ns);
    const myHackLevel = ns.getHackingLevel();
    const openers = getAvailableOpeners(ns);

    // Try to root everything currently possible
    for (const host of allServers) {
      if (host === "home") continue;
      tryRoot(ns, host, openers, myHackLevel);
    }

    const rooted = allServers.filter((s) => ns.hasRootAccess(s));
    const target = chooseBestTarget(ns, rooted, myHackLevel);

    if (!target) {
      ns.clearLog();
      ns.print("No viable money target yet. Sleeping 30s...");
      await ns.sleep(30000);
      continue;
    }

    ns.clearLog();
    ns.print(`Best target: ${target}`);
    ns.print(`Hack level: ${myHackLevel}`);
    ns.print(`Openers available: ${openers.count}`);

    const usableHosts = rooted.filter((s) => {
      if (ns.getServerMaxRam(s) <= 0) return false;
      if (s.startsWith("hacknet-node")) return false; // optional, remove if you want to use them
      return true;
    });

    for (const host of usableHosts) {
      await ns.scp(WORKER, host);

      // Kill old worker(s) so target can be updated as your stats improve
      ns.scriptKill(WORKER, host);

      const maxRam = ns.getServerMaxRam(host);
      const usedRam = ns.getServerUsedRam(host);
      const freeRam = host === "home"
        ? Math.max(0, maxRam - usedRam - HOME_RESERVED_RAM)
        : Math.max(0, maxRam - usedRam);

      const scriptRam = ns.getScriptRam(WORKER, host);
      const threads = Math.floor(freeRam / scriptRam);

      if (threads > 0) {
        ns.exec(WORKER, host, threads, target);
      }
    }

    printSummary(ns, rooted, usableHosts, target);

    // Re-evaluate periodically as hack level/exes improve
    await ns.sleep(60000);
  }
}

function discoverAllServers(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();
    for (const neighbor of ns.scan(host)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return [...seen];
}

function getAvailableOpeners(ns) {
  const exes = [
    ["BruteSSH.exe", (host) => ns.brutessh(host)],
    ["FTPCrack.exe", (host) => ns.ftpcrack(host)],
    ["relaySMTP.exe", (host) => ns.relaysmtp(host)],
    ["HTTPWorm.exe", (host) => ns.httpworm(host)],
    ["SQLInject.exe", (host) => ns.sqlinject(host)],
  ];

  const available = exes.filter(([file]) => ns.fileExists(file, "home"));

  return {
    count: available.length,
    run: (host) => {
      for (const [, fn] of available) {
        try { fn(host); } catch {}
      }
    },
  };
}

function tryRoot(ns, host, openers, myHackLevel) {
  if (ns.hasRootAccess(host)) return true;
  if (!ns.serverExists(host)) return false;

  const reqHack = ns.getServerRequiredHackingLevel(host);
  const reqPorts = ns.getServerNumPortsRequired(host);

  if (reqHack > myHackLevel) return false;
  if (reqPorts > openers.count) return false;

  try {
    openers.run(host);
    ns.nuke(host);
    return ns.hasRootAccess(host);
  } catch {
    return false;
  }
}

function chooseBestTarget(ns, servers, myHackLevel) {
  const candidates = servers.filter((host) => {
    if (host === "home") return false;
    if (host.startsWith("pserv-")) return false;
    if (host.startsWith("hacknet-node")) return false;
    if (!ns.hasRootAccess(host)) return false;
    if (ns.getServerRequiredHackingLevel(host) > myHackLevel) return false;
    if (ns.getServerMaxMoney(host) <= 0) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scoreTarget(ns, b) - scoreTarget(ns, a));
  return candidates[0];
}

function scoreTarget(ns, host) {
  const maxMoney = ns.getServerMaxMoney(host);
  const minSec = ns.getServerMinSecurityLevel(host);
  const growth = ns.getServerGrowth(host);

  // Simple early/mid-game heuristic
  return (maxMoney * growth) / Math.max(1, minSec);
}

function printSummary(ns, rooted, usableHosts, target) {
  let totalThreads = 0;
  for (const host of usableHosts) {
    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const freeRam = Math.max(0, maxRam - usedRam);
    const scriptRam = ns.getScriptRam("/tmp/spread-worker.js", host);
    totalThreads += Math.floor(freeRam / Math.max(scriptRam, 0.0001));
  }

  ns.print(`Rooted servers: ${rooted.length}`);
  ns.print(`Usable hosts: ${usableHosts.length}`);
  ns.print(`Current target: ${target}`);
  ns.print(`Approx free-thread capacity: ${totalThreads}`);
}