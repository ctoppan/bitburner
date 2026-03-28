/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const DEFAULT_HACK_PCT = 0.03;
  const DEFAULT_SPACING = -1;
  const DEFAULT_HOME_RESERVE = 1024;
  const DEFAULT_TARGET_WINDOW = 30;

  let desiredHackPct = Number(ns.args[0] ?? DEFAULT_HACK_PCT);
  let spacingMs = Number(ns.args[1] ?? DEFAULT_SPACING);
  const homeReserveGb = Number(ns.args[2] ?? DEFAULT_HOME_RESERVE);
  const targetWindow = Math.max(5, Number(ns.args[3] ?? DEFAULT_TARGET_WINDOW));

  if (!Number.isFinite(desiredHackPct) || desiredHackPct <= 0) desiredHackPct = DEFAULT_HACK_PCT;
  if (!Number.isFinite(spacingMs)) spacingMs = DEFAULT_SPACING;

  const hackScript = "/hacking/batch/batchHack.js";
  const growScript = "/hacking/batch/batchGrow.js";
  const weakenScript = "/hacking/batch/batchWeaken.js";

  const workerScripts = [hackScript, growScript, weakenScript];

  for (const script of workerScripts) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`[overlap] ERROR: Missing ${script} on home`);
      return;
    }
  }

  while (true) {
    try {
      const hosts = getUsableHosts(ns, homeReserveGb);

      await syncWorkersToHosts(ns, hosts, workerScripts);

      const target = chooseBestTarget(ns, targetWindow);
      if (!target) {
        ns.print("[overlap] No valid target found. Sleeping 10s.");
        await ns.sleep(10000);
        continue;
      }

      const maxMoney = ns.getServerMaxMoney(target);
      const minSec = ns.getServerMinSecurityLevel(target);
      const moneyNow = ns.getServerMoneyAvailable(target);
      const secNow = ns.getServerSecurityLevel(target);

      const prepNeeded = moneyNow < maxMoney * 0.95 || secNow > minSec + 1;

      if (prepNeeded) {
        ns.clearLog();
        ns.print(
          `[overlap] Prep needed for ${target}. money=${formatMoney(ns, moneyNow)}/${formatMoney(ns, maxMoney)} sec=${secNow.toFixed(2)}/${minSec.toFixed(2)}`
        );

        const waitMs = await runPrepCycle(ns, hosts, target, weakenScript, growScript);
        await ns.sleep(waitMs);
        continue;
      }

      const weakenTime = ns.getWeakenTime(target);
      const growTime = ns.getGrowTime(target);
      const hackTime = ns.getHackTime(target);

      const effectiveSpacing = spacingMs < 0
        ? Math.max(20, Math.ceil(weakenTime / 200))
        : spacingMs;

      const hackPctPerThread = ns.hackAnalyze(target);
      if (hackPctPerThread <= 0) {
        ns.print(`[overlap] hackAnalyze(${target}) returned ${hackPctPerThread}. Sleeping 10s.`);
        await ns.sleep(10000);
        continue;
      }

      const hackThreads = Math.max(1, Math.floor(desiredHackPct / hackPctPerThread));
      const actualHackPct = hackThreads * hackPctPerThread;

      const growThreads = Math.max(
        1,
        Math.ceil(ns.growthAnalyze(target, 1 / Math.max(0.0001, 1 - actualHackPct)))
      );
      const weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
      const weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));

      const ramPerBatch =
        hackThreads * ns.getScriptRam(hackScript, "home") +
        growThreads * ns.getScriptRam(growScript, "home") +
        (weakenHackThreads + weakenGrowThreads) * ns.getScriptRam(weakenScript, "home");

      const totalFreeRam = hosts.reduce((sum, h) => sum + h.freeRam, 0);
      const maxConcurrentBatches = Math.max(1, Math.floor(totalFreeRam / ramPerBatch));

      const cycleLength = effectiveSpacing * 4;
      const theoreticalMax = Math.max(1, Math.floor(weakenTime / cycleLength));
      const concurrentBatches = Math.max(1, Math.min(maxConcurrentBatches, theoreticalMax));

      ns.clearLog();
      ns.print(`[overlap] Target: ${target}`);
      ns.print(`[overlap] Hack pct requested: ${pct(desiredHackPct)} | actual: ${pct(actualHackPct)}`);
      ns.print(`[overlap] Threads H:${hackThreads} G:${growThreads} W1:${weakenHackThreads} W2:${weakenGrowThreads}`);
      ns.print(`[overlap] Hosts: ${hosts.length} | Free RAM: ${formatRam(totalFreeRam)} | Batch RAM: ${formatRam(ramPerBatch)}`);
      ns.print(`[overlap] Concurrent batches: ${concurrentBatches} | spacing=${effectiveSpacing}ms`);

      killExistingBatchWorkers(ns, hosts, workerScripts);

      let batchId = 0;
      for (let i = 0; i < concurrentBatches; i++) {
        const baseDelay = i * cycleLength;

        const weaken1Delay = baseDelay;
        const hackDelay = Math.max(0, baseDelay + weakenTime - hackTime - effectiveSpacing * 2);
        const growDelay = Math.max(0, baseDelay + weakenTime - growTime - effectiveSpacing);
        const weaken2Delay = baseDelay + effectiveSpacing * 3;

        if (!dispatch(ns, hosts, weakenScript, weakenHackThreads, target, weaken1Delay, `w1-${batchId}`)) break;
        if (!dispatch(ns, hosts, hackScript, hackThreads, target, hackDelay, `h-${batchId}`)) break;
        if (!dispatch(ns, hosts, growScript, growThreads, target, growDelay, `g-${batchId}`)) break;
        if (!dispatch(ns, hosts, weakenScript, weakenGrowThreads, target, weaken2Delay, `w2-${batchId}`)) break;

        batchId++;
      }

      await ns.sleep(Math.max(5000, Math.floor(weakenTime / 4)));
    } catch (err) {
      ns.tprint(`[overlap] ERROR: ${String(err)}`);
      await ns.sleep(5000);
    }
  }
}

async function syncWorkersToHosts(ns, hosts, workerScripts) {
  for (const h of hosts) {
    if (h.host === "home") continue;
    try {
      await ns.scp(workerScripts, h.host, "home");
    } catch {}
  }
}

function getUsableHosts(ns, homeReserveGb) {
  const all = scanAll(ns);
  const rooted = all.filter(h => ns.hasRootAccess(h));

  const hosts = [];
  for (const host of rooted) {
    const maxRam = ns.getServerMaxRam(host);
    if (maxRam <= 0) continue;

    const usedRam = ns.getServerUsedRam(host);
    const reserve = host === "home" ? homeReserveGb : 0;
    const freeRam = Math.max(0, maxRam - usedRam - reserve);
    if (freeRam <= 1.6) continue;

    hosts.push({ host, freeRam });
  }

  hosts.sort((a, b) => b.freeRam - a.freeRam);
  return hosts;
}

function scanAll(ns) {
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

function chooseBestTarget(ns, targetWindow) {
  const level = ns.getHackingLevel();

  const candidates = scanAll(ns).filter(host => {
    if (host === "home") return false;
    if (host.startsWith("pserv-")) return false;
    if (host.startsWith("hacknet-node-")) return false;
    if (!ns.hasRootAccess(host)) return false;
    if (ns.getServerRequiredHackingLevel(host) > level) return false;
    if (ns.getServerMaxMoney(host) <= 0) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const scored = candidates.map(host => {
    const maxMoney = ns.getServerMaxMoney(host);
    const minSec = ns.getServerMinSecurityLevel(host);
    const growth = ns.getServerGrowth(host);
    const hackChance = ns.hackAnalyzeChance(host);
    const score = (maxMoney * Math.max(1, growth) * Math.max(0.01, hackChance)) / Math.max(1, minSec);
    return { host, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, targetWindow)[0]?.host ?? null;
}

async function runPrepCycle(ns, hosts, target, weakenScript, growScript) {
  const minSec = ns.getServerMinSecurityLevel(target);
  const sec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const money = ns.getServerMoneyAvailable(target);

  let weakenThreads = 0;
  let growThreads = 0;
  let waitMs = 2000;

  if (sec > minSec + 1) {
    weakenThreads = Math.ceil((sec - minSec) / 0.05);
    dispatch(ns, hosts, weakenScript, weakenThreads, target, 0, "prep-w");
    waitMs = Math.ceil(ns.getWeakenTime(target) + 250);
  } else if (money < maxMoney * 0.95) {
    const ratio = maxMoney / Math.max(1, money);
    growThreads = Math.ceil(ns.growthAnalyze(target, ratio));
    weakenThreads = Math.ceil((growThreads * 0.004) / 0.05);

    dispatch(ns, hosts, growScript, growThreads, target, 0, "prep-g");
    dispatch(ns, hosts, weakenScript, weakenThreads, target, 0, "prep-w");

    waitMs = Math.ceil(Math.max(ns.getGrowTime(target), ns.getWeakenTime(target)) + 250);
  }

  return waitMs;
}

function dispatch(ns, hosts, script, totalThreads, target, delay, tag) {
  let remaining = totalThreads;

  for (const h of hosts) {
    const scriptRam = ns.getScriptRam(script, h.host);
    if (scriptRam <= 0) continue;

    const fit = Math.floor(h.freeRam / scriptRam);
    if (fit <= 0) continue;

    const threads = Math.min(fit, remaining);
    const pid = ns.exec(script, h.host, threads, target, delay, tag);
    if (pid !== 0) {
      h.freeRam -= threads * scriptRam;
      remaining -= threads;
      if (remaining <= 0) return true;
    }
  }

  return remaining <= 0;
}

function killExistingBatchWorkers(ns, hosts, workerScripts) {
  const names = workerScripts.map(normalizeScriptName);

  for (const h of hosts) {
    for (const proc of ns.ps(h.host)) {
      if (scriptNameMatches(proc.filename, names)) {
        ns.kill(proc.pid);
      }
    }
  }
}

function formatMoney(ns, n) {
  return ns.formatNumber(n, 2);
}

function formatRam(n) {
  if (n >= 1024) return `${(n / 1024).toFixed(2)}TB`;
  return `${n.toFixed(2)}GB`;
}

function pct(v) {
  return `${(v * 100).toFixed(0)}%`;
}

function normalizeScriptName(name) {
  return String(name || "").replace(/^\/+/, "");
}

function scriptNameMatches(name, candidates) {
  const normalized = normalizeScriptName(name);
  return candidates.some(candidate => normalizeScriptName(candidate) === normalized);
}