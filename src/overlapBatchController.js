/** @param {NS} ns **/
export async function main(ns) {
  const manualTarget = String(ns.args[0] ?? "");
  const hackPct = clamp(Number(ns.args[1] ?? 0.02), 0.005, 0.08);
  const spacer = Math.max(100, Number(ns.args[2] ?? 200));
  const homeReserve = Math.max(16, Number(ns.args[3] ?? 64));

  // High default ceiling. Real limiting is done dynamically each cycle.
  const maxBatches = Math.max(1, Number(ns.args[4] ?? 500));

  const scripts = ["batchHack.js", "batchGrow.js", "batchWeaken.js"];
  for (const script of scripts) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`Missing ${script} on home`);
      return;
    }
  }

  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(420, 220);
  ns.ui.moveTail(1180, 60);

  let target = "";
  let nextLanding = 0;
  let prepStart = 0;

  while (true) {
    const hosts = await getUsableHosts(ns, scripts, homeReserve);
    if (hosts.length === 0) {
      ns.print("No usable rooted hosts.");
      await ns.sleep(2000);
      continue;
    }

    const picked = manualTarget || pickBestTarget(ns);
    if (!picked) {
      ns.print("No valid target found.");
      await ns.sleep(5000);
      continue;
    }

    if (picked !== target) {
      target = picked;
      nextLanding = Date.now() + ns.getWeakenTime(target) + 2000;
      prepStart = 0;
      ns.tprint(`[overlapBatchController.js] Target selected: ${target}`);
    }

    const sec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const weakenTime = ns.getWeakenTime(target);

    const needsWeaken = sec > minSec + 1.0;
    const needsGrow = money < maxMoney * 0.95;
    const inPrep = needsWeaken || needsGrow;

    if (inPrep) {
      if (prepStart === 0) prepStart = Date.now();

      if (!manualTarget && Date.now() - prepStart > Math.max(180000, weakenTime * 2)) {
        ns.tprint(`[overlapBatchController.js] Prep timeout on ${target}, re-evaluating target`);
        target = "";
        prepStart = 0;
        await ns.sleep(500);
        continue;
      }

      if (needsWeaken) {
        if (!hasPrepWeakenRunning(ns, hosts, target)) {
          runPrepWeaken(ns, hosts, target, homeReserve);
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_WEAKEN");
        } else {
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_WEAKEN_WAIT");
        }
        await ns.sleep(1000);
        continue;
      }

      if (needsGrow) {
        if (!hasPrepGrowRunning(ns, hosts, target)) {
          runPrepGrow(ns, hosts, target, homeReserve);
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_GROW");
        } else {
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_GROW_WAIT");
        }
        await ns.sleep(1000);
        continue;
      }
    } else {
      prepStart = 0;
    }

    const template = buildBatchTemplate(ns, target, hackPct);
    if (!template) {
      ns.print("Could not build batch template.");
      await ns.sleep(3000);
      continue;
    }

    const availableBatches = countFittableBatches(ns, hosts, template, homeReserve);
    const fleetLaunchCap = estimateFleetLaunchCap(ns, hosts, template, homeReserve);
    const timingCap = estimateTimingCap(ns, target, spacer);

    const batchesToLaunch = Math.min(
      maxBatches,
      availableBatches,
      fleetLaunchCap,
      timingCap
    );

    if (batchesToLaunch < 1) {
      showStatus(
        ns,
        target,
        money,
        maxMoney,
        sec,
        minSec,
        `WAIT_RAM avail:${availableBatches} fleet:${fleetLaunchCap} time:${timingCap}`,
        template
      );
      await ns.sleep(1000);
      continue;
    }

    let launched = 0;
    for (let i = 0; i < batchesToLaunch; i++) {
      const landing = nextLanding + i * spacer * 4;
      const jobs = materializeBatch(ns, target, template, landing, spacer, i);
      const ok = deployBatch(ns, hosts, jobs, homeReserve);
      if (!ok) break;
      launched++;
    }

    if (launched > 0) {
      nextLanding += launched * spacer * 4;
    } else {
      nextLanding = Math.max(nextLanding, Date.now() + weakenTime + spacer * 4);
    }

    showStatus(
      ns,
      target,
      money,
      maxMoney,
      sec,
      minSec,
      `BATCH x${launched} avail:${availableBatches} fleet:${fleetLaunchCap} time:${timingCap}`,
      template
    );

    await ns.sleep(Math.max(200, spacer));
  }
}

function buildBatchTemplate(ns, target, hackPct) {
  const maxMoney = ns.getServerMaxMoney(target);
  if (maxMoney <= 0) return null;

  let hackThreads = ns.hackAnalyzeThreads(target, maxMoney * hackPct);
  if (!isFinite(hackThreads) || hackThreads <= 0) return null;
  hackThreads = Math.max(1, Math.floor(hackThreads));

  const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / (1 - hackPct))));
  const hackSec = ns.hackAnalyzeSecurity(hackThreads, target);
  const growSec = ns.growthAnalyzeSecurity(growThreads, target);
  const weaken1Threads = Math.max(1, Math.ceil(hackSec / 0.05));
  const weaken2Threads = Math.max(1, Math.ceil(growSec / 0.05));

  return [
    { script: "batchHack.js", threads: hackThreads },
    { script: "batchWeaken.js", threads: weaken1Threads },
    { script: "batchGrow.js", threads: growThreads },
    { script: "batchWeaken.js", threads: weaken2Threads },
  ];
}

function materializeBatch(ns, target, template, landing, spacer, idx) {
  const hackTime = ns.getHackTime(target);
  const growTime = ns.getGrowTime(target);
  const weakenTime = ns.getWeakenTime(target);
  const tag = `${Date.now()}-${idx}`;

  return [
    {
      script: "batchHack.js",
      threads: template[0].threads,
      args: [target, Math.max(0, landing - spacer * 3 - Date.now() - hackTime), `${tag}-H`],
    },
    {
      script: "batchWeaken.js",
      threads: template[1].threads,
      args: [target, Math.max(0, landing - spacer * 2 - Date.now() - weakenTime), `${tag}-W1`],
    },
    {
      script: "batchGrow.js",
      threads: template[2].threads,
      args: [target, Math.max(0, landing - spacer - Date.now() - growTime), `${tag}-G`],
    },
    {
      script: "batchWeaken.js",
      threads: template[3].threads,
      args: [target, Math.max(0, landing - Date.now() - weakenTime), `${tag}-W2`],
    },
  ];
}

async function getUsableHosts(ns, scripts, homeReserve) {
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
    if (ns.getServerMaxRam(host) < 2) continue;

    for (const script of scripts) {
      await ns.scp(script, host, "home");
    }

    hosts.push(host);
  }

  hosts.sort((a, b) => freeRam(ns, b, homeReserve) - freeRam(ns, a, homeReserve));
  return hosts;
}

function tryRoot(ns, host) {
  if (host === "home" || ns.hasRootAccess(host)) return;

  let ports = 0;
  if (ns.fileExists("BruteSSH.exe", "home")) { try { ns.brutessh(host); } catch {} ports++; }
  if (ns.fileExists("FTPCrack.exe", "home")) { try { ns.ftpcrack(host); } catch {} ports++; }
  if (ns.fileExists("relaySMTP.exe", "home")) { try { ns.relaysmtp(host); } catch {} ports++; }
  if (ns.fileExists("HTTPWorm.exe", "home")) { try { ns.httpworm(host); } catch {} ports++; }
  if (ns.fileExists("SQLInject.exe", "home")) { try { ns.sqlinject(host); } catch {} ports++; }

  if (
    ports >= ns.getServerNumPortsRequired(host) &&
    ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host)
  ) {
    try { ns.nuke(host); } catch {}
  }
}

function pickBestTarget(ns) {
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

    const req = ns.getServerRequiredHackingLevel(host);
    if (req > playerLevel) continue;
    if (req > playerLevel * 0.75) continue;

    const maxMoney = ns.getServerMaxMoney(host);
    if (maxMoney <= 0) continue;

    const minSec = Math.max(1, ns.getServerMinSecurityLevel(host));
    const weakenTime = ns.getWeakenTime(host);
    const hackChance = ns.hackAnalyzeChance(host);

    if (weakenTime > 15 * 60 * 1000) continue;
    if (hackChance < 0.6) continue;

    const score =
      (maxMoney / minSec) *
      hackChance *
      (1 / Math.max(1, weakenTime / 60000)) *
      (1 - req / Math.max(1, playerLevel * 1.2));

    candidates.push({ host, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].host : "";
}

function deployBatch(ns, hosts, jobs, homeReserve) {
  const ramByScript = {
    "batchHack.js": ns.getScriptRam("batchHack.js", "home"),
    "batchGrow.js": ns.getScriptRam("batchGrow.js", "home"),
    "batchWeaken.js": ns.getScriptRam("batchWeaken.js", "home"),
  };

  for (const job of jobs) {
    let remaining = job.threads;

    for (const host of hosts) {
      const available = Math.floor(freeRam(ns, host, homeReserve) / ramByScript[job.script]);
      if (available <= 0) continue;

      const run = Math.min(remaining, available);
      if (run <= 0) continue;

      const pid = ns.exec(job.script, host, run, ...job.args);
      if (pid !== 0) {
        remaining -= run;
      }

      if (remaining <= 0) break;
    }

    if (remaining > 0) return false;
  }

  return true;
}

function countFittableBatches(ns, hosts, template, homeReserve) {
  let totalFree = 0;
  for (const host of hosts) {
    totalFree += freeRam(ns, host, homeReserve);
  }

  const batchRam = batchRamCost(ns, template);
  return Math.floor(totalFree / Math.max(1, batchRam));
}

function batchRamCost(ns, template) {
  return (
    template[0].threads * ns.getScriptRam(template[0].script, "home") +
    template[1].threads * ns.getScriptRam(template[1].script, "home") +
    template[2].threads * ns.getScriptRam(template[2].script, "home") +
    template[3].threads * ns.getScriptRam(template[3].script, "home")
  );
}

function estimateFleetLaunchCap(ns, hosts, template, homeReserve) {
  const batchRam = batchRamCost(ns, template);
  if (batchRam <= 0) return 1;

  let totalFree = 0;
  let largeHostCount = 0;

  for (const host of hosts) {
    const free = freeRam(ns, host, homeReserve);
    totalFree += free;
    if (free >= batchRam) largeHostCount++;
  }

  const ramBased = Math.floor(totalFree / batchRam);
  const hostBased = Math.max(1, largeHostCount * 8);

  return Math.max(1, Math.min(ramBased, hostBased));
}

function estimateTimingCap(ns, target, spacer) {
  const weakenTime = ns.getWeakenTime(target);
  const spacingWindow = Math.max(1, spacer * 4);
  return Math.max(20, Math.floor(weakenTime / spacingWindow));
}

function runPrepWeaken(ns, hosts, target, homeReserve) {
  const ram = ns.getScriptRam("batchWeaken.js", "home");
  const tag = `prepW-${Date.now()}`;

  for (const host of hosts) {
    const threads = Math.floor(freeRam(ns, host, homeReserve) / ram);
    if (threads > 0) ns.exec("batchWeaken.js", host, threads, target, 0, tag);
  }
}

function runPrepGrow(ns, hosts, target, homeReserve) {
  const growRam = ns.getScriptRam("batchGrow.js", "home");
  const weakenRam = ns.getScriptRam("batchWeaken.js", "home");
  const tag = `prepG-${Date.now()}`;

  for (const host of hosts) {
    const free = freeRam(ns, host, homeReserve);
    const growThreads = Math.floor((free * 0.8) / growRam);
    const weakenThreads = Math.floor((free * 0.2) / weakenRam);

    if (growThreads > 0) ns.exec("batchGrow.js", host, growThreads, target, 0, `${tag}-g`);
    if (weakenThreads > 0) ns.exec("batchWeaken.js", host, weakenThreads, target, 0, `${tag}-w`);
  }
}

function hasPrepWeakenRunning(ns, hosts, target) {
  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (
        proc.filename === "batchWeaken.js" &&
        proc.args?.[0] === target &&
        typeof proc.args?.[2] === "string" &&
        String(proc.args[2]).startsWith("prepW-")
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasPrepGrowRunning(ns, hosts, target) {
  let hasGrow = false;
  let hasWeaken = false;

  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (proc.args?.[0] !== target) continue;
      if (typeof proc.args?.[2] !== "string") continue;

      const tag = String(proc.args[2]);
      if (proc.filename === "batchGrow.js" && tag.startsWith("prepG-")) hasGrow = true;
      if (proc.filename === "batchWeaken.js" && tag.startsWith("prepG-")) hasWeaken = true;

      if (hasGrow && hasWeaken) return true;
    }
  }

  return false;
}

function freeRam(ns, host, homeReserve) {
  const reserve = host === "home" ? homeReserve : 0;
  return Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve);
}

function showStatus(ns, target, money, maxMoney, sec, minSec, mode, template = null) {
  ns.clearLog();
  ns.print(`Mode: ${mode}`);
  ns.print(`Target: ${target}`);
  ns.print(`Money: ${ns.formatNumber(money, 2)} / ${ns.formatNumber(maxMoney, 2)}`);
  ns.print(`Security: ${sec.toFixed(2)} / ${minSec.toFixed(2)}`);
  if (template) {
    ns.print(
      `Threads: H ${template[0].threads} | W1 ${template[1].threads} | G ${template[2].threads} | W2 ${template[3].threads}`
    );
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}