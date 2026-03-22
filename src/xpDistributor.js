/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const requestedTarget = String(ns.args[0] ?? "");
  const homeReserve = Math.max(16, Number(ns.args[1] ?? 64));
  const includeHome = String(ns.args[2] ?? "true").toLowerCase() !== "false";
  const worker = "xpGrind.js";

  if (!ns.fileExists(worker, "home")) {
    ns.tprint(`Missing ${worker} on home`);
    return;
  }

  const hosts = getUsableHosts(ns, includeHome);
  if (hosts.length === 0) {
    ns.tprint("No usable rooted hosts found.");
    return;
  }

  const target = requestedTarget || pickBestXpTarget(ns);
  if (!target) {
    ns.tprint("No valid XP target found.");
    return;
  }

  let totalThreads = 0;
  let usedHosts = 0;

  for (const host of hosts) {
    if (!ns.serverExists(host)) continue;
    if (!ns.hasRootAccess(host)) continue;

    const maxRam = ns.getServerMaxRam(host);
    if (maxRam < 2) continue;

    const reserve = host === "home" ? homeReserve : 0;
    const freeRam = Math.max(0, maxRam - ns.getServerUsedRam(host) - reserve);
    const scriptRam = ns.getScriptRam(worker, "home");
    const threads = Math.floor(freeRam / scriptRam);

    if (threads <= 0) continue;

    await ns.scp(worker, host, "home");
    killMatchingWorker(ns, host, worker);

    const pid = ns.exec(worker, host, threads, target);
    if (pid !== 0) {
      totalThreads += threads;
      usedHosts++;
    }
  }

  ns.tprint(
    `XP grind launched on ${usedHosts} hosts with ${totalThreads} total threads targeting ${target}.`
  );

  printTargetSummary(ns, target);
  printDistributionSummary(ns, hosts, worker, target, homeReserve);
}

function getUsableHosts(ns, includeHome) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  const hosts = [];

  while (queue.length > 0) {
    const host = queue.shift();

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }

    tryRoot(ns, host);

    if (!ns.hasRootAccess(host)) continue;
    if (!includeHome && host === "home") continue;

    hosts.push(host);
  }

  hosts.sort((a, b) => {
    const ramDiff = ns.getServerMaxRam(b) - ns.getServerMaxRam(a);
    if (ramDiff !== 0) return ramDiff;
    return a.localeCompare(b);
  });

  return hosts;
}

function pickBestXpTarget(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  const playerLevel = ns.getHackingLevel();
  const candidates = [];

  while (queue.length > 0) {
    const host = queue.shift();

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }

    if (host === "home") continue;
    if (!ns.hasRootAccess(host)) continue;

    const reqHack = ns.getServerRequiredHackingLevel(host);
    if (reqHack > playerLevel) continue;

    const maxMoney = ns.getServerMaxMoney(host);
    const minSec = Math.max(1, ns.getServerMinSecurityLevel(host));
    const weakenTime = ns.getWeakenTime(host);
    const growTime = ns.getGrowTime(host);
    const chance = ns.hackAnalyzeChance(host);

    // Skip very slow or junk targets
    if (weakenTime > 10 * 60 * 1000) continue;
    if (chance < 0.5) continue;

    // XP-first scoring:
    // shorter times are better
    // some money helps because grow can fire
    // lower security is better
    // near-player-level targets get a slight boost but not too hard
    const moneyFactor = Math.max(1, Math.log10(Math.max(1, maxMoney)));
    const timeFactor = 1 / Math.max(1, weakenTime / 60000);
    const growFactor = 1 / Math.max(1, growTime / 60000);
    const secFactor = 1 / minSec;
    const levelFactor = 1 + Math.min(1, reqHack / Math.max(1, playerLevel));

    const score =
      moneyFactor * 0.8 +
      timeFactor * 6 +
      growFactor * 3 +
      secFactor * 4 +
      levelFactor * 2;

    candidates.push({
      host,
      score,
      reqHack,
      weakenTime,
      growTime,
      minSec,
      maxMoney,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return "";

  return candidates[0].host;
}

function tryRoot(ns, host) {
  if (host === "home" || ns.hasRootAccess(host)) return;

  let opened = 0;

  if (ns.fileExists("BruteSSH.exe", "home")) {
    try { ns.brutessh(host); } catch {}
    opened++;
  }
  if (ns.fileExists("FTPCrack.exe", "home")) {
    try { ns.ftpcrack(host); } catch {}
    opened++;
  }
  if (ns.fileExists("relaySMTP.exe", "home")) {
    try { ns.relaysmtp(host); } catch {}
    opened++;
  }
  if (ns.fileExists("HTTPWorm.exe", "home")) {
    try { ns.httpworm(host); } catch {}
    opened++;
  }
  if (ns.fileExists("SQLInject.exe", "home")) {
    try { ns.sqlinject(host); } catch {}
    opened++;
  }

  if (
    opened >= ns.getServerNumPortsRequired(host) &&
    ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host)
  ) {
    try { ns.nuke(host); } catch {}
  }
}

function killMatchingWorker(ns, host, worker) {
  for (const proc of ns.ps(host)) {
    if (proc.filename === worker) {
      try {
        ns.kill(proc.pid);
      } catch {}
    }
  }
}

function printTargetSummary(ns, target) {
  ns.tprint("\n=== XP TARGET ===");
  ns.tprint(`Target: ${target}`);
  ns.tprint(`Required hack: ${ns.getServerRequiredHackingLevel(target)}`);
  ns.tprint(`Min security: ${ns.getServerMinSecurityLevel(target).toFixed(2)}`);
  ns.tprint(`Max money: ${formatMoney(ns.getServerMaxMoney(target))}`);
  ns.tprint(`Weaken time: ${formatMs(ns.getWeakenTime(target))}`);
  ns.tprint(`Grow time: ${formatMs(ns.getGrowTime(target))}`);
  ns.tprint(`Hack chance: ${(ns.hackAnalyzeChance(target) * 100).toFixed(2)}%`);
}

function printDistributionSummary(ns, hosts, worker, target, homeReserve) {
  const rows = [];

  for (const host of hosts) {
    const reserve = host === "home" ? homeReserve : 0;
    const maxRam = ns.getServerMaxRam(host);
    const usedRam = ns.getServerUsedRam(host);
    const freeRam = Math.max(0, maxRam - usedRam - reserve);

    let workerThreads = 0;
    for (const proc of ns.ps(host)) {
      if (proc.filename === worker && proc.args?.[0] === target) {
        workerThreads += proc.threads;
      }
    }

    if (workerThreads > 0) {
      rows.push({
        host,
        threads: workerThreads,
        maxRam,
        freeRam,
      });
    }
  }

  rows.sort((a, b) => b.threads - a.threads);

  ns.tprint("\n=== XP DISTRIBUTION ===");
  for (const row of rows) {
    ns.tprint(
      `${row.host}: ${row.threads} threads | RAM ${formatRam(row.maxRam)} | Free ${formatRam(row.freeRam)}`
    );
  }
}

function formatRam(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} PB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} TB`;
  return `${n.toFixed(2)} GB`;
}

function formatMoney(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}t`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return `${n.toFixed(2)}`;
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}