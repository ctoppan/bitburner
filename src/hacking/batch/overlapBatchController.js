/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");
  ns.clearLog();
  try {
    ns.ui.openTail();
    ns.ui.resizeTail(620, 420);
    ns.ui.moveTail(900, 80);
  } catch {}

  const CFG = {
    defaultHackPct: Number(ns.args[0] ?? 0.03),
    defaultSpacing: Number(ns.args[1] ?? -1),
    homeReserveGb: Number(ns.args[2] ?? 1024),
    targetWindow: Math.max(5, Number(ns.args[3] ?? 30)),

    maxParallelPrepTargets: 3,
    minMoneyRatioToBatch: 0.85,
    maxSecAboveMinToBatch: 3.0,
    maxPrepWavesBeforeDowngrade: 4,
    minFleetFreeForBatchGb: 24,
    xpScript: "/xp/xpGrind.js",
    xpDistributor: "/xp/xpDistributor.js",
  };

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

  let lastMode = "";
  let lastTarget = "";
  const prepWaveCounts = new Map();

  while (true) {
    try {
      const hosts = getUsableHosts(ns, CFG.homeReserveGb);
      await syncWorkersToHosts(ns, hosts, workerScripts);

      const fleetFreeRam = hosts.reduce((sum, h) => sum + h.freeRam, 0);
      const ranked = rankTargets(ns, CFG.targetWindow);
      const candidateInfos = ranked.map(host => analyzeTarget(ns, host, fleetFreeRam));

      const batchable = candidateInfos.filter(t => canBatchNow(t, CFG));
      const prepable = candidateInfos.filter(t => t.maxMoney > 0);

      if (batchable.length > 0 && fleetFreeRam >= CFG.minFleetFreeForBatchGb) {
        stopXpMode(ns, CFG.xpScript, CFG.xpDistributor);

        const chosen = chooseBatchTarget(batchable, prepWaveCounts, CFG);
        const spacingMs = CFG.defaultSpacing < 0
          ? Math.max(20, Math.ceil(ns.getWeakenTime(chosen.host) / 200))
          : CFG.defaultSpacing;

        if (lastMode !== "BATCH" || lastTarget !== chosen.host) {
          ns.tprint(`[overlap] BATCH mode -> ${chosen.host}`);
          lastMode = "BATCH";
          lastTarget = chosen.host;
        }

        killExistingBatchWorkers(ns, hosts, workerScripts);
        runBatchWave(ns, hosts, chosen.host, CFG.defaultHackPct, spacingMs, hackScript, growScript, weakenScript, candidateInfos);

        await ns.sleep(Math.max(5000, Math.floor(ns.getWeakenTime(chosen.host) / 4)));
        continue;
      }

      const prepTargets = choosePrepTargets(prepable, prepWaveCounts, CFG, fleetFreeRam);

      if (prepTargets.length > 0) {
        stopXpMode(ns, CFG.xpScript, CFG.xpDistributor);

        if (lastMode !== "PREP" || lastTarget !== prepTargets.map(t => t.host).join(",")) {
          ns.tprint(`[overlap] PREP mode -> ${prepTargets.map(t => t.host).join(", ")}`);
          lastMode = "PREP";
          lastTarget = prepTargets.map(t => t.host).join(",");
        }

        ns.clearLog();
        ns.print(`[overlap] PREP mode | targets=${prepTargets.map(t => t.host).join(", ")} | fleetFree=${formatRam(fleetFreeRam)}`);
        for (const t of candidateInfos.slice(0, 6)) {
          const wavesDone = prepWaveCounts.get(t.host) ?? 0;
          ns.print(
            `[overlap] cand ${t.host.padEnd(16)} money=${pct(t.moneyRatio).padStart(4)} sec+${t.secAboveMin.toFixed(2).padStart(6)} estWaves=${String(t.prepWaves).padStart(3)} seen=${String(wavesDone).padStart(2)}`
          );
        }

        const waitMs = await runParallelPrep(ns, hosts, prepTargets, growScript, weakenScript, prepWaveCounts);
        await ns.sleep(waitMs);
        continue;
      }

      if (lastMode !== "XP") {
        ns.tprint(`[overlap] XP mode -> no worthwhile money target ready`);
        lastMode = "XP";
        lastTarget = "";
      }

      ns.clearLog();
      ns.print(`[overlap] XP mode`);
      ns.print(`[overlap] No batchable or worthwhile prep targets right now.`);
      startXpMode(ns, CFG.xpScript, CFG.xpDistributor);
      await ns.sleep(15000);
    } catch (err) {
      ns.tprint(`[overlap] ERROR: ${String(err)}`);
      await ns.sleep(5000);
    }
  }
}

function getUsableHosts(ns, homeReserveGb) {
  const rooted = scanAll(ns).filter(h => ns.hasRootAccess(h));

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

async function syncWorkersToHosts(ns, hosts, workerScripts) {
  for (const h of hosts) {
    if (h.host === "home") continue;
    try {
      await ns.scp(workerScripts, h.host, "home");
    } catch {}
  }
}

function rankTargets(ns, targetWindow) {
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

  const scored = candidates.map(host => {
    const maxMoney = ns.getServerMaxMoney(host);
    const minSec = Math.max(1, ns.getServerMinSecurityLevel(host));
    const curSec = Math.max(minSec, ns.getServerSecurityLevel(host));
    const growth = Math.max(1, ns.getServerGrowth(host));
    const chance = Math.max(0.01, ns.hackAnalyzeChance(host));
    const weakenTime = Math.max(1, ns.getWeakenTime(host));
    const moneyRatio = maxMoney > 0 ? ns.getServerMoneyAvailable(host) / maxMoney : 0;
    const prepPenalty = (moneyRatio < 0.85 || (curSec - minSec) > 3) ? 0.6 : 1.0;
    const score = (maxMoney * growth * chance * prepPenalty) / (minSec * Math.sqrt(weakenTime));
    return { host, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, targetWindow).map(x => x.host);
}

function analyzeTarget(ns, host, fleetFreeRam) {
  const maxMoney = ns.getServerMaxMoney(host);
  const money = ns.getServerMoneyAvailable(host);
  const minSec = ns.getServerMinSecurityLevel(host);
  const sec = ns.getServerSecurityLevel(host);
  const secAboveMin = Math.max(0, sec - minSec);
  const moneyRatio = maxMoney > 0 ? money / maxMoney : 0;

  const weakenThreadsNeeded = Math.ceil(secAboveMin / 0.05);
  const growThreadsNeeded = moneyRatio >= 0.995
    ? 0
    : Math.ceil(ns.growthAnalyze(host, Math.max(1.03, 1 / Math.max(0.01, moneyRatio))) || 0);

  const weakenForGrow = Math.ceil((growThreadsNeeded * 0.004) / 0.05);

  const weakenRam = ns.getScriptRam("/hacking/batch/batchWeaken.js", "home");
  const growRam = ns.getScriptRam("/hacking/batch/batchGrow.js", "home");

  const prepRamNeed = weakenThreadsNeeded * weakenRam + growThreadsNeeded * growRam + weakenForGrow * weakenRam;
  const prepWaves = fleetFreeRam > 0 ? Math.ceil(prepRamNeed / fleetFreeRam) : 9999;

  return {
    host,
    maxMoney,
    money,
    minSec,
    sec,
    secAboveMin,
    moneyRatio,
    prepRamNeed,
    prepWaves,
    weakenThreadsNeeded,
    growThreadsNeeded,
    score: scoreTargetForBatching(ns, host),
  };
}

function scoreTargetForBatching(ns, host) {
  const maxMoney = ns.getServerMaxMoney(host);
  const minSec = Math.max(1, ns.getServerMinSecurityLevel(host));
  const chance = Math.max(0.01, ns.hackAnalyzeChance(host));
  const weakenTime = Math.max(1, ns.getWeakenTime(host));
  return (maxMoney * chance) / (minSec * Math.sqrt(weakenTime));
}

function canBatchNow(t, cfg) {
  return t.moneyRatio >= cfg.minMoneyRatioToBatch && t.secAboveMin <= cfg.maxSecAboveMinToBatch;
}

function chooseBatchTarget(batchable, prepWaveCounts, cfg) {
  const sorted = [...batchable].sort((a, b) => b.score - a.score);

  for (const t of sorted) {
    const waves = prepWaveCounts.get(t.host) ?? 0;
    if (waves <= cfg.maxPrepWavesBeforeDowngrade) return t;
  }

  return sorted[0];
}

function choosePrepTargets(prepable, prepWaveCounts, cfg, fleetFreeRam) {
  const sorted = [...prepable]
    .filter(t => t.prepWaves < 9999)
    .sort((a, b) => {
      const aWaves = prepWaveCounts.get(a.host) ?? 0;
      const bWaves = prepWaveCounts.get(b.host) ?? 0;

      const aTooSlow = a.prepWaves > cfg.maxPrepWavesBeforeDowngrade || aWaves > cfg.maxPrepWavesBeforeDowngrade;
      const bTooSlow = b.prepWaves > cfg.maxPrepWavesBeforeDowngrade || bWaves > cfg.maxPrepWavesBeforeDowngrade;

      if (aTooSlow !== bTooSlow) return aTooSlow ? 1 : -1;
      if (a.prepWaves !== b.prepWaves) return a.prepWaves - b.prepWaves;
      return b.score - a.score;
    });

  const chosen = [];
  let estimatedBudget = fleetFreeRam * 0.85;

  for (const t of sorted) {
    if (chosen.length >= cfg.maxParallelPrepTargets) break;

    const wavesDone = prepWaveCounts.get(t.host) ?? 0;
    if (t.prepWaves > cfg.maxPrepWavesBeforeDowngrade && wavesDone > cfg.maxPrepWavesBeforeDowngrade) {
      continue;
    }

    const budgetNeed = Math.min(t.prepRamNeed, fleetFreeRam * 0.5);
    if (budgetNeed <= estimatedBudget || chosen.length === 0) {
      chosen.push(t);
      estimatedBudget -= Math.max(8, budgetNeed);
    }
  }

  return chosen;
}

async function runParallelPrep(ns, hosts, targets, growScript, weakenScript, prepWaveCounts) {
  let longestWait = 3000;

  const budgets = splitPrepBudgets(hosts, targets.length);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const budgetHosts = budgets[i];
    if (budgetHosts.length === 0) continue;

    const waitMs = runPrepWave(ns, budgetHosts, target, growScript, weakenScript);
    longestWait = Math.max(longestWait, waitMs);
    prepWaveCounts.set(target.host, (prepWaveCounts.get(target.host) ?? 0) + 1);

    ns.print(
      `[overlap] prep ${target.host} | money=${pct(target.moneyRatio)} sec+${target.secAboveMin.toFixed(2)} waves=${prepWaveCounts.get(target.host)}`
    );
  }

  return longestWait;
}

function splitPrepBudgets(hosts, buckets) {
  const split = Array.from({ length: buckets }, () => []);
  for (let i = 0; i < hosts.length; i++) {
    split[i % buckets].push({ ...hosts[i] });
  }
  return split;
}

function runPrepWave(ns, hosts, targetInfo, growScript, weakenScript) {
  const target = targetInfo.host;

  let weakenThreads = 0;
  let growThreads = 0;
  let waitMs = 3000;

  if (targetInfo.secAboveMin > 0.25) {
    weakenThreads += Math.ceil(targetInfo.secAboveMin / 0.05);
    waitMs = Math.max(waitMs, Math.ceil(ns.getWeakenTime(target) + 250));
  }

  if (targetInfo.moneyRatio < 0.995) {
    growThreads = Math.ceil(ns.growthAnalyze(target, Math.max(1.03, 1 / Math.max(0.01, targetInfo.moneyRatio))) || 0);
    weakenThreads += Math.ceil((growThreads * 0.004) / 0.05);
    waitMs = Math.max(waitMs, Math.ceil(Math.max(ns.getGrowTime(target), ns.getWeakenTime(target)) + 250));
  }

  if (weakenThreads > 0) {
    dispatch(ns, hosts, weakenScript, weakenThreads, target, 0, `prep-w-${Date.now()}`);
  }
  if (growThreads > 0) {
    dispatch(ns, hosts, growScript, growThreads, target, 100, `prep-g-${Date.now()}`);
  }

  return waitMs;
}

function runBatchWave(ns, hosts, target, desiredHackPct, spacingMs, hackScript, growScript, weakenScript, candidateInfos) {
  const hackPctPerThread = ns.hackAnalyze(target);
  if (!Number.isFinite(hackPctPerThread) || hackPctPerThread <= 0) return false;

  const hackThreads = Math.max(1, Math.floor(desiredHackPct / hackPctPerThread));
  const actualHackPct = hackThreads * hackPctPerThread;

  const growThreads = Math.max(
    1,
    Math.ceil(ns.growthAnalyze(target, 1 / Math.max(0.0001, 1 - actualHackPct)))
  );
  const weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
  const weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));

  const weakenTime = ns.getWeakenTime(target);
  const growTime = ns.getGrowTime(target);
  const hackTime = ns.getHackTime(target);

  const totalFreeRam = hosts.reduce((sum, h) => sum + h.freeRam, 0);
  const ramPerBatch =
    hackThreads * ns.getScriptRam(hackScript, "home") +
    growThreads * ns.getScriptRam(growScript, "home") +
    (weakenHackThreads + weakenGrowThreads) * ns.getScriptRam(weakenScript, "home");

  const cycleLength = spacingMs * 4;
  const maxConcurrentBatches = Math.max(1, Math.floor(totalFreeRam / ramPerBatch));
  const theoreticalMax = Math.max(1, Math.floor(weakenTime / cycleLength));
  const concurrentBatches = Math.max(1, Math.min(maxConcurrentBatches, theoreticalMax));

  ns.clearLog();
  ns.print(`[overlap] BATCH ${target}`);
  ns.print(`[overlap] H:${hackThreads} G:${growThreads} W1:${weakenHackThreads} W2:${weakenGrowThreads}`);
  ns.print(`[overlap] Hosts:${hosts.length} Free:${formatRam(totalFreeRam)} BatchRAM:${formatRam(ramPerBatch)} Concurrency:${concurrentBatches}`);

  if (Array.isArray(candidateInfos)) {
    for (const t of candidateInfos.slice(0, 6)) {
      ns.print(
        `[overlap] cand ${t.host.padEnd(16)} money=${pct(t.moneyRatio).padStart(4)} sec+${t.secAboveMin.toFixed(2).padStart(6)} estWaves=${String(t.prepWaves).padStart(3)}`
      );
    }
  }

  let batchId = 0;
  for (let i = 0; i < concurrentBatches; i++) {
    const baseDelay = i * cycleLength;
    const weaken1Delay = baseDelay;
    const growDelay = Math.max(0, baseDelay + weakenTime - growTime - spacingMs);
    const hackDelay = Math.max(0, baseDelay + weakenTime - hackTime - spacingMs * 2);
    const weaken2Delay = baseDelay + spacingMs * 3;

    if (!dispatch(ns, hosts, weakenScript, weakenHackThreads, target, weaken1Delay, `w1-${batchId}`)) break;
    if (!dispatch(ns, hosts, growScript, growThreads, target, growDelay, `g-${batchId}`)) break;
    if (!dispatch(ns, hosts, hackScript, hackThreads, target, hackDelay, `h-${batchId}`)) break;
    if (!dispatch(ns, hosts, weakenScript, weakenGrowThreads, target, weaken2Delay, `w2-${batchId}`)) break;

    batchId++;
  }

  return batchId > 0;
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

function startXpMode(ns, xpScript, xpDistributor) {
  if (!ns.fileExists(xpDistributor, "home")) return;

  if (ns.isRunning(xpDistributor, "home")) return;

  if (ns.isRunning(xpScript, "home")) {
    ns.kill(xpScript, "home");
  }

  ns.tprint("[overlap] Starting XP distributor...");
  ns.run(xpDistributor, 1);
}

function stopXpMode(ns, xpScript, xpDistributor) {
  if (ns.isRunning(xpDistributor, "home")) {
    ns.kill(xpDistributor, "home");
  }

  if (ns.isRunning(xpScript, "home")) {
    ns.kill(xpScript, "home");
  }
}

function normalizeScriptName(name) {
  return String(name || "").replace(/^\/+/, "");
}

function scriptNameMatches(name, candidates) {
  const normalized = normalizeScriptName(name);
  return candidates.some(candidate => normalizeScriptName(candidate) === normalized);
}

function formatRam(n) {
  if (n >= 1024) return `${(n / 1024).toFixed(2)}TB`;
  return `${n.toFixed(2)}GB`;
}

function pct(v) {
  return `${(v * 100).toFixed(0)}%`;
}