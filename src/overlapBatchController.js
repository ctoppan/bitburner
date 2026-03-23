/** @param {NS} ns **/
export async function main(ns) {
  const manualTarget = String(ns.args[0] ?? "");
  const baseHackPct = clamp(Number(ns.args[1] ?? 0.01), 0.005, 0.08);
  const baseSpacer = clamp(Number(ns.args[2] ?? 300), 80, 500);
  const homeReserve = Math.max(64, Number(ns.args[3] ?? 128));

  // Keep this conservative. The old default of 500 could create thousands of queued jobs.
  const baseMaxBatches = Math.max(1, Number(ns.args[4] ?? 24));
  const maxActiveJobs = Math.max(20, Number(ns.args[5] ?? 160));
  const maxActiveBatches = Math.max(4, Number(ns.args[6] ?? 40));

  const tuner = createTuner(baseHackPct, baseSpacer, baseMaxBatches, maxActiveJobs, maxActiveBatches);

  const scripts = ["batchHack.js", "batchGrow.js", "batchWeaken.js"];
  for (const script of scripts) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`Missing ${script} on home`);
      return;
    }
  }

  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(460, 300);
  ns.ui.moveTail(1140, 40);

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
      tuner.noteTargetChange(target);
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
      tuner.notePrep();

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
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_WEAKEN", null, tuner, hosts, homeReserve);
        } else {
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_WEAKEN_WAIT", null, tuner, hosts, homeReserve);
        }
        await ns.sleep(1000);
        continue;
      }

      if (needsGrow) {
        if (!hasPrepGrowRunning(ns, hosts, target)) {
          runPrepGrow(ns, hosts, target, homeReserve);
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_GROW", null, tuner, hosts, homeReserve);
        } else {
          showStatus(ns, target, money, maxMoney, sec, minSec, "PREP_GROW_WAIT", null, tuner, hosts, homeReserve);
        }
        await ns.sleep(1000);
        continue;
      }
    } else {
      prepStart = 0;
    }

    const template = buildBatchTemplate(ns, target, tuner.hackPct);
    if (!template) {
      ns.print("Could not build batch template.");
      await ns.sleep(3000);
      continue;
    }

    const activeSummary = summarizeActiveBatches(ns, hosts, target);
    const ramStats = getFleetRamStats(ns, hosts, homeReserve);

    const availableBatches = countFittableBatches(ns, hosts, template, homeReserve);
    const fleetLaunchCap = estimateFleetLaunchCap(ns, hosts, template, homeReserve);
    const timingCap = estimateTimingCap(ns, target, tuner.spacer);
    const jobCap = Math.max(0, Math.floor((maxActiveJobs - activeSummary.activeJobs) / 4));
    const activeBatchCap = Math.max(0, maxActiveBatches - activeSummary.activeBatches);

    const batchesToLaunch = Math.min(
      tuner.maxBatches,
      availableBatches,
      fleetLaunchCap,
      timingCap,
      jobCap,
      activeBatchCap
    );

    if (batchesToLaunch < 1) {
      const stallReason = determineStallReason(
        availableBatches,
        fleetLaunchCap,
        timingCap,
        jobCap,
        activeBatchCap,
        activeSummary,
        maxActiveJobs,
        maxActiveBatches
      );
      tuner.observe({
        launched: 0,
        activeSummary: { ...activeSummary, maxJobs: maxActiveJobs, maxBatches: maxActiveBatches },
        ramStats,
        stallReason,
        inPrep: false,
      });
      showStatus(
        ns,
        target,
        money,
        maxMoney,
        sec,
        minSec,
        `WAIT_${stallReason} avail:${availableBatches} fleet:${fleetLaunchCap} time:${timingCap} jobs:${activeSummary.activeJobs}/${maxActiveJobs} batches:${activeSummary.activeBatches}/${maxActiveBatches}`,
        template,
        tuner,
        hosts,
        homeReserve
      );
      await ns.sleep(1000);
      continue;
    }

    let launched = 0;
    for (let i = 0; i < batchesToLaunch; i++) {
      const landing = nextLanding + i * tuner.spacer * 4;
      const jobs = materializeBatch(ns, target, template, landing, tuner.spacer, i);
      const ok = deployBatch(ns, hosts, jobs, homeReserve);
      if (!ok) break;
      launched++;
    }

    if (launched > 0) {
      nextLanding += launched * tuner.spacer * 4;
    } else {
      nextLanding = Math.max(nextLanding, Date.now() + weakenTime + tuner.spacer * 4);
    }

    const stallReason = launched < batchesToLaunch ? "PARTIAL_RAM" : "NONE";
    tuner.observe({
      launched,
      requested: batchesToLaunch,
      activeSummary: { ...activeSummary, maxJobs: maxActiveJobs, maxBatches: maxActiveBatches },
      ramStats,
      stallReason,
      inPrep: false,
    });

    showStatus(
      ns,
      target,
      money,
      maxMoney,
      sec,
      minSec,
      `BATCH x${launched} avail:${availableBatches} fleet:${fleetLaunchCap} time:${timingCap} jobs:${activeSummary.activeJobs}/${maxActiveJobs} batches:${activeSummary.activeBatches}/${maxActiveBatches}`,
      template,
      tuner,
      hosts,
      homeReserve
    );

    await ns.sleep(Math.max(250, tuner.spacer));
  }
}

function createTuner(baseHackPct, baseSpacer, baseMaxBatches, maxActiveJobs, maxActiveBatches) {
  return {
    enabled: true,
    target: "",
    hackPct: baseHackPct,
    spacer: baseSpacer,
    maxBatches: baseMaxBatches,
    minHackPct: Math.max(0.005, Math.min(baseHackPct, 0.01)),
    maxHackPct: Math.max(0.04, Math.min(0.1, baseHackPct * 4)),
    minSpacer: 80,
    maxSpacer: Math.max(300, baseSpacer + 150),
    minMaxBatches: Math.max(8, Math.min(baseMaxBatches, 16)),
    maxMaxBatches: Math.max(48, Math.min(160, baseMaxBatches * 4)),
    maxActiveJobs,
    maxActiveBatches,
    lastTuneAt: 0,
    lastChange: "init",
    recent: [],
    lastReason: "starting",
    noteTargetChange(target) {
      this.target = target;
      this.recent = [];
      this.lastReason = `target ${target}`;
    },
    notePrep() {
      this.lastReason = "prep";
    },
    observe(sample) {
      this.recent.push({ ...sample, ts: Date.now() });
      while (this.recent.length > 24) this.recent.shift();
      this.maybeTune();
    },
    maybeTune() {
      if (!this.enabled) return;
      if (Date.now() - this.lastTuneAt < 30000) return;
      if (this.recent.length < 6) return;

      const usable = this.recent.filter((x) => !x.inPrep);
      if (usable.length < 4) return;

      const avg = averageSamples(usable);
      let changed = false;

      const jobPressure = avg.jobRatio > 0.92;
      const batchPressure = avg.batchRatio > 0.92;
      const ramPressure = avg.freeRamRatio < 0.08;
      const lotsOfHeadroom = avg.freeRamRatio > 0.35 && avg.jobRatio < 0.75 && avg.batchRatio < 0.75;
      const ramWait = avg.stallReasons.RAM > 0.4;
      const concurrencyWait = avg.stallReasons.CONCURRENCY > 0.35;
      const partialRam = avg.stallReasons.PARTIAL_RAM > 0.25;

      if (jobPressure || batchPressure || concurrencyWait) {
        this.hackPct = clamp(this.hackPct - 0.0025, this.minHackPct, this.maxHackPct);
        this.spacer = clamp(this.spacer + 20, this.minSpacer, this.maxSpacer);
        this.maxBatches = Math.max(this.minMaxBatches, this.maxBatches - 2);
        this.lastChange = `backoff concurrency jobs:${pct(avg.jobRatio)} batches:${pct(avg.batchRatio)}`;
        changed = true;
      } else if (ramPressure || ramWait || partialRam) {
        this.hackPct = clamp(this.hackPct - 0.002, this.minHackPct, this.maxHackPct);
        this.spacer = clamp(this.spacer + 10, this.minSpacer, this.maxSpacer);
        this.maxBatches = Math.max(this.minMaxBatches, this.maxBatches - 1);
        this.lastChange = `backoff ram free:${pct(avg.freeRamRatio)}`;
        changed = true;
      } else if (lotsOfHeadroom && avg.avgLaunched > 0.75 && avg.successRatio > 0.85) {
        this.hackPct = clamp(this.hackPct + 0.0025, this.minHackPct, this.maxHackPct);
        this.spacer = clamp(this.spacer - 10, this.minSpacer, this.maxSpacer);
        this.maxBatches = Math.min(this.maxMaxBatches, this.maxBatches + 2);
        this.lastChange = `push headroom free:${pct(avg.freeRamRatio)}`;
        changed = true;
      } else {
        this.lastChange = `hold free:${pct(avg.freeRamRatio)} jobs:${pct(avg.jobRatio)} batches:${pct(avg.batchRatio)}`;
      }

      this.lastTuneAt = Date.now();
      this.recent = [];

      if (changed) {
        this.lastReason = this.lastChange;
      }
    },
  };
}

function averageSamples(samples) {
  let freeRamRatio = 0;
  let jobRatio = 0;
  let batchRatio = 0;
  let avgLaunched = 0;
  let successRatio = 0;
  const stallReasons = { RAM: 0, CONCURRENCY: 0, PARTIAL_RAM: 0, NONE: 0 };

  for (const sample of samples) {
    freeRamRatio += sample.ramStats.freeRatio;
    jobRatio += sample.activeSummary.activeJobs / Math.max(1, sample.activeSummary.maxJobs ?? 1);
    batchRatio += sample.activeSummary.activeBatches / Math.max(1, sample.activeSummary.maxBatches ?? 1);
    avgLaunched += sample.launched > 0 ? 1 : 0;
    successRatio += sample.requested ? sample.launched / Math.max(1, sample.requested) : (sample.launched > 0 ? 1 : 0);

    if (sample.stallReason === "RAM") stallReasons.RAM++;
    else if (sample.stallReason === "CONCURRENCY") stallReasons.CONCURRENCY++;
    else if (sample.stallReason === "PARTIAL_RAM") stallReasons.PARTIAL_RAM++;
    else stallReasons.NONE++;
  }

  const count = samples.length;
  return {
    freeRamRatio: freeRamRatio / count,
    jobRatio: jobRatio / count,
    batchRatio: batchRatio / count,
    avgLaunched: avgLaunched / count,
    successRatio: successRatio / count,
    stallReasons: {
      RAM: stallReasons.RAM / count,
      CONCURRENCY: stallReasons.CONCURRENCY / count,
      PARTIAL_RAM: stallReasons.PARTIAL_RAM / count,
      NONE: stallReasons.NONE / count,
    },
  };
}

function determineStallReason(availableBatches, fleetLaunchCap, timingCap, jobCap, activeBatchCap, activeSummary, maxActiveJobs, maxActiveBatches) {
  if (availableBatches <= 0 || fleetLaunchCap <= 0) return "RAM";
  if (jobCap <= 0 || activeBatchCap <= 0) return "CONCURRENCY";
  if (activeSummary.activeJobs >= maxActiveJobs || activeSummary.activeBatches >= maxActiveBatches) return "CONCURRENCY";
  if (timingCap <= 0) return "CONCURRENCY";
  return "RAM";
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
  const hostBased = Math.max(1, largeHostCount * 4);

  return Math.max(1, Math.min(ramBased, hostBased));
}

function estimateTimingCap(ns, target, spacer) {
  const weakenTime = ns.getWeakenTime(target);
  const spacingWindow = Math.max(1, spacer * 4);
  return Math.max(8, Math.floor(weakenTime / spacingWindow));
}

function summarizeActiveBatches(ns, hosts, target) {
  const tags = new Set();
  let activeJobs = 0;

  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (!isBatchScript(proc.filename)) continue;
      if (proc.args?.[0] !== target) continue;

      activeJobs++;

      const tag = String(proc.args?.[2] ?? '');
      if (!tag.startsWith('prep')) {
        const parts = tag.split('-');
        if (parts.length >= 2) {
          tags.add(`${parts[0]}-${parts[1]}`);
        } else if (tag) {
          tags.add(tag);
        }
      }
    }
  }

  return {
    activeJobs,
    activeBatches: tags.size,
  };
}

function isBatchScript(filename) {
  return filename === 'batchHack.js' || filename === 'batchGrow.js' || filename === 'batchWeaken.js';
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
    const growThreads = Math.floor((free * 0.7) / growRam);
    const weakenThreads = Math.floor((free * 0.3) / weakenRam);

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

function getFleetRamStats(ns, hosts, homeReserve) {
  let total = 0;
  let free = 0;

  for (const host of hosts) {
    total += Math.max(0, ns.getServerMaxRam(host) - (host === "home" ? homeReserve : 0));
    free += freeRam(ns, host, homeReserve);
  }

  return {
    total,
    free,
    used: Math.max(0, total - free),
    freeRatio: total > 0 ? free / total : 0,
  };
}

function showStatus(ns, target, money, maxMoney, sec, minSec, mode, template = null, tuner = null, hosts = null, homeReserve = 0) {
  ns.clearLog();
  ns.print(`Mode: ${mode}`);
  if (tuner) {
    ns.print(`Tune: ${tuner.enabled ? 'dynamic' : 'off'} hpct:${(tuner.hackPct * 100).toFixed(2)} spacer:${Math.round(tuner.spacer)} maxB:${Math.round(tuner.maxBatches)}`);
    ns.print(`Tune note: ${tuner.lastReason}`);
  }
  if (hosts) {
    const ramStats = getFleetRamStats(ns, hosts, homeReserve);
    ns.print(`Fleet RAM: ${ns.formatRam(ramStats.free)} free / ${ns.formatRam(ramStats.total)} total`);
  }
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

function pct(n) {
  return `${(n * 100).toFixed(0)}%`;
}
