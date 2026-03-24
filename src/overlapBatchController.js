/** @param {NS} ns **/
export async function main(ns) {
  const opts = parseArgs(ns.args);
  const scripts = ["batchHack.js", "batchGrow.js", "batchWeaken.js"];

  for (const script of scripts) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`Missing ${script} on home`);
      return;
    }
  }

  ns.disableLog("ALL");
  try { ns.ui.openTail(); } catch {}
  try { ns.ui.resizeTail(620, 360); } catch {}

  const state = {
    hackPct: opts.hackPct,
    spacer: opts.spacer,
    homeReserve: opts.homeReserve,
    maxBatches: opts.maxBatches,
    maxJobs: 3200,
    invest: "balanced",
    tuneNote: "init",
    lastTuneAt: 0,
    targetStates: new Map(),
  };

  const TUNE_INTERVAL = 30000;
  const LOOP_SLEEP = 1200;
  const TARGET_HOLD_MS = 60000;
  const TARGET_SWITCH_MULTIPLIER = 1.08;
  const TUNER_KEY = "bb_tuner_state_v1";

  while (true) {
    try {
      const hosts = await getUsableHosts(ns, scripts, state.homeReserve);
      if (!hosts.length) {
        ns.print("No usable rooted hosts.");
        await ns.sleep(2000);
        continue;
      }

      const fleet = getFleetStats(ns, hosts, state.homeReserve);
      const rankedTargets = opts.manualTarget
        ? [{ target: opts.manualTarget, score: scoreSingleTarget(ns, opts.manualTarget, fleet) }]
        : rankTargets(ns, fleet).slice(0, 10);

      const activeTargets = selectActiveTargets(ns, state, rankedTargets, fleet, TARGET_HOLD_MS, TARGET_SWITCH_MULTIPLIER, opts.manualTarget);
      const focusTarget = activeTargets[0]?.target || rankedTargets[0]?.target || opts.manualTarget || "";
      const focusInfo = focusTarget ? getTargetInfo(ns, focusTarget) : emptyTargetInfo();

      const activeJobs = countActiveBatchJobs(ns, hosts);
      const batchCounts = countActiveBatches(ns, hosts);
      const activeBatches = batchCounts.total;

      if (Date.now() - state.lastTuneAt >= TUNE_INTERVAL) {
        tuneState(state, fleet, activeJobs, activeBatches, focusInfo);
        state.lastTuneAt = Date.now();
      }

      const targetInfos = new Map();
      for (const row of activeTargets) {
        targetInfos.set(row.target, getTargetInfo(ns, row.target));
      }

      let remainingBatchBudget = Math.max(0, state.maxBatches - activeBatches);
      let launchedTotal = 0;

      const readyTargets = [];
      const prepTargets = [];
      for (const row of activeTargets) {
        const info = targetInfos.get(row.target) || emptyTargetInfo();
        if (needsPrep(info)) prepTargets.push({ ...row, info });
        else readyTargets.push({ ...row, info });
      }

      if (prepTargets.length) {
        const totalPrepScore = Math.max(1, prepTargets.reduce((sum, row) => sum + Math.max(1, row.score), 0));
        for (const row of prepTargets) {
          const share = Math.max(0.15, row.score / totalPrepScore);
          const prepRamBudget = Math.max(64, fleet.free * Math.min(0.5, share));
          launchedTotal += handlePrepTarget(ns, hosts, row.target, row.info, state.homeReserve, prepRamBudget);
        }
      }

      if (readyTargets.length && remainingBatchBudget > 0) {
        const totalReadyScore = Math.max(1, readyTargets.reduce((sum, row) => sum + Math.max(1, row.score), 0));

        for (const row of readyTargets) {
          if (remainingBatchBudget <= 0) break;

          const target = row.target;
          const info = row.info;
          const targetState = getOrCreateTargetState(state, target, ns);
          const template = buildBatchTemplate(ns, target, state.hackPct);
          if (!template) continue;

          const share = Math.max(0.10, row.score / totalReadyScore);
          const timingCap = estimateTimingCap(ns, target, state.spacer);
          const targetBatchCount = batchCounts.byTarget.get(target) || 0;
          const targetCap = Math.max(2, Math.floor(state.maxBatches * share * 1.25));
          const allowedForTarget = Math.max(0, Math.min(targetCap, timingCap) - targetBatchCount);
          if (allowedForTarget <= 0) continue;

          const availableBatches = countFittableBatches(ns, hosts, template, state.homeReserve);
          const perLoopCap = Math.max(1, Math.min(24, Math.ceil(share * 40)));
          const toLaunch = Math.max(0, Math.min(remainingBatchBudget, allowedForTarget, availableBatches, perLoopCap));
          if (toLaunch <= 0) continue;

          let launchedForTarget = 0;
          for (let i = 0; i < toLaunch; i++) {
            const landing = targetState.nextLanding + i * state.spacer * 4;
            const jobs = materializeBatch(ns, target, template, landing, state.spacer, i);
            if (!deployBatch(ns, hosts, jobs, state.homeReserve)) break;
            launchedForTarget++;
          }

          if (launchedForTarget > 0) {
            targetState.nextLanding += launchedForTarget * state.spacer * 4;
            remainingBatchBudget -= launchedForTarget;
            launchedTotal += launchedForTarget;
          } else {
            targetState.nextLanding = Math.max(targetState.nextLanding, Date.now() + ns.getWeakenTime(target) + state.spacer * 4);
          }
        }
      }

      publishTunerState(TUNER_KEY, {
        ts: Date.now(),
        invest: state.invest,
        tuneNote: state.tuneNote,
        target: focusTarget,
        targets: activeTargets.map(t => t.target),
        fleetFreeRam: fleet.free,
        fleetTotalRam: fleet.total,
        ramFreeRatio: fleet.total > 0 ? fleet.free / fleet.total : 0,
        activeJobs,
        maxJobs: state.maxJobs,
        activeBatches,
        maxBatches: state.maxBatches,
        hackPct: state.hackPct,
        spacer: state.spacer,
      });

      renderStatus(ns, {
        mode: launchedTotal > 0 ? `MULTI x${launchedTotal}` : prepTargets.length ? "MULTI_PREP" : "WAIT",
        fleet,
        activeJobs,
        activeBatches,
        focusTarget,
        focusInfo,
        rankedTargets: rankedTargets.slice(0, 5),
        activeTargets,
        state,
      });

      await ns.sleep(Math.max(LOOP_SLEEP, state.spacer));
    } catch (err) {
      ns.print(`ERROR: ${String(err)}`);
      await ns.sleep(5000);
    }
  }
}

function parseArgs(args) {
  let idx = 0;
  let manualTarget = "";
  if (typeof args[0] === "string" && args[0] && Number.isNaN(Number(args[0]))) {
    manualTarget = String(args[0]);
    idx = 1;
  }

  return {
    manualTarget,
    hackPct: clamp(Number(args[idx] ?? 0.02), 0.005, 0.16),
    spacer: clampInt(Number(args[idx + 1] ?? 200), 30, 400),
    homeReserve: Math.max(16, Number(args[idx + 2] ?? 64)),
    maxBatches: Math.max(32, Number(args[idx + 3] ?? 500)),
  };
}

function getFleetStats(ns, hosts, homeReserve) {
  let total = 0;
  let used = 0;
  for (const host of hosts) {
    const max = ns.getServerMaxRam(host) - (host === "home" ? homeReserve : 0);
    const safeMax = Math.max(0, max);
    total += safeMax;
    used += Math.min(safeMax, ns.getServerUsedRam(host));
  }
  return { total, used, free: Math.max(0, total - used) };
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

  if (ports >= ns.getServerNumPortsRequired(host) && ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host)) {
    try { ns.nuke(host); } catch {}
  }
}

function tuneState(state, fleet, activeJobs, activeBatches, focusInfo) {
  const ramFreeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
  const jobPressure = state.maxJobs > 0 ? activeJobs / state.maxJobs : 1;
  const batchPressure = state.maxBatches > 0 ? activeBatches / state.maxBatches : 1;

  if (ramFreeRatio > 0.90) {
    state.hackPct = clamp(state.hackPct * 1.12, 0.02, 0.16);
    state.spacer = clampInt(Math.floor(state.spacer * 0.94), 30, 400);
    state.maxBatches = clampInt(state.maxBatches + 24, 64, 1200);
    state.maxJobs = clampInt(state.maxJobs + 300, 1200, 10000);
    state.invest = "buy_servers";
    state.tuneNote = `ramp_up free:${pct(ramFreeRatio)}`;
    return;
  }

  if (ramFreeRatio > 0.65) {
    state.hackPct = clamp(state.hackPct * 1.06, 0.02, 0.16);
    state.spacer = clampInt(Math.floor(state.spacer * 0.97), 30, 400);
    state.maxBatches = clampInt(state.maxBatches + 12, 64, 1200);
    state.maxJobs = clampInt(state.maxJobs + 150, 1200, 10000);
    state.invest = "buy_servers";
    state.tuneNote = `ramp_mid free:${pct(ramFreeRatio)}`;
    return;
  }

  if (ramFreeRatio < 0.12) {
    state.hackPct = clamp(state.hackPct * 0.92, 0.01, 0.14);
    state.spacer = clampInt(Math.floor(state.spacer * 1.08), 35, 500);
    state.maxBatches = clampInt(state.maxBatches - 16, 64, 1200);
    state.maxJobs = clampInt(state.maxJobs - 200, 1200, 10000);
    state.invest = "save_home";
    state.tuneNote = `backoff free:${pct(ramFreeRatio)}`;
    return;
  }

  if (jobPressure > 0.92 && ramFreeRatio > 0.25) {
    state.maxJobs = clampInt(state.maxJobs + 400, 1200, 10000);
    state.maxBatches = clampInt(state.maxBatches + 24, 64, 1200);
    state.invest = "buy_servers";
    state.tuneNote = `raise_caps jobs:${pct(jobPressure)}`;
    return;
  }

  if (batchPressure > 0.90 && ramFreeRatio > 0.25) {
    state.maxBatches = clampInt(state.maxBatches + 24, 64, 1200);
    state.invest = "buy_servers";
    state.tuneNote = `raise_batch_cap batches:${pct(batchPressure)}`;
    return;
  }

  if (focusInfo.moneyRatio < 0.85 || focusInfo.secAboveMin > 2) {
    state.invest = ramFreeRatio > 0.35 ? "buy_servers" : "balanced";
    state.tuneNote = `prep money:${pct(focusInfo.moneyRatio)} sec+${focusInfo.secAboveMin.toFixed(2)}`;
    return;
  }

  state.invest = ramFreeRatio > 0.30 ? "buy_servers" : "balanced";
  state.tuneNote = `stable free:${pct(ramFreeRatio)} jobs:${pct(jobPressure)} batches:${pct(batchPressure)}`;
}

function selectActiveTargets(ns, state, rankedTargets, fleet, holdMs, switchMultiplier, manualTarget) {
  const desiredCount = manualTarget
    ? 1
    : fleet.free / Math.max(1, fleet.total) > 0.75 ? 4
    : fleet.free / Math.max(1, fleet.total) > 0.45 ? 3
    : fleet.free / Math.max(1, fleet.total) > 0.20 ? 2
    : 1;

  const rankedMap = new Map(rankedTargets.map(row => [row.target, row.score]));
  const now = Date.now();
  const selected = [];
  const used = new Set();

  for (const [target, targetState] of state.targetStates.entries()) {
    if (selected.length >= desiredCount) break;
    const score = rankedMap.get(target);
    if (!Number.isFinite(score) || score <= 0) continue;
    const topScore = rankedTargets[0]?.score || score;
    const withinHold = now - targetState.lastSwitchAt < holdMs;
    const competitive = score >= topScore / switchMultiplier;
    if (withinHold || competitive) {
      selected.push({ target, score });
      used.add(target);
    }
  }

  for (const row of rankedTargets) {
    if (selected.length >= desiredCount) break;
    if (used.has(row.target)) continue;
    selected.push(row);
    used.add(row.target);
  }

  for (const row of selected) {
    const targetState = getOrCreateTargetState(state, row.target, ns);
    if (targetState.lastSeenTop !== row.score) {
      targetState.lastSeenTop = row.score;
    }
  }

  for (const [target, targetState] of [...state.targetStates.entries()]) {
    if (!used.has(target) && now - targetState.lastSwitchAt > holdMs * 2) {
      state.targetStates.delete(target);
    }
  }

  return selected.sort((a, b) => b.score - a.score);
}

function getOrCreateTargetState(state, target, ns) {
  let existing = state.targetStates.get(target);
  if (!existing) {
    existing = {
      nextLanding: Date.now() + ns.getWeakenTime(target) + 1000,
      prepStart: 0,
      lastSwitchAt: Date.now(),
      lastSeenTop: 0,
    };
    state.targetStates.set(target, existing);
  }
  return existing;
}

function buildBatchTemplate(ns, target, hackPct) {
  const maxMoney = ns.getServerMaxMoney(target);
  if (maxMoney <= 0) return null;

  let hackThreads = ns.hackAnalyzeThreads(target, maxMoney * hackPct);
  if (!Number.isFinite(hackThreads) || hackThreads <= 0) return null;
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
  const tag = `${Date.now()}-${idx}-${target}`;

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

function deployBatch(ns, hosts, jobs, homeReserve) {
  const ramByScript = {
    "batchHack.js": ns.getScriptRam("batchHack.js", "home"),
    "batchGrow.js": ns.getScriptRam("batchGrow.js", "home"),
    "batchWeaken.js": ns.getScriptRam("batchWeaken.js", "home"),
  };

  for (const job of jobs) {
    let remaining = job.threads;

    for (const host of hosts) {
      const ramCost = ramByScript[job.script];
      const available = Math.floor(freeRam(ns, host, homeReserve) / ramCost);
      if (available <= 0) continue;

      const run = Math.min(remaining, available);
      if (run <= 0) continue;

      const pid = ns.exec(job.script, host, run, ...job.args);
      if (pid !== 0) remaining -= run;
      if (remaining <= 0) break;
    }

    if (remaining > 0) return false;
  }

  return true;
}

function countFittableBatches(ns, hosts, template, homeReserve) {
  let totalFree = 0;
  for (const host of hosts) totalFree += freeRam(ns, host, homeReserve);
  const batchRam = batchRamCost(ns, template);
  return Math.floor(totalFree / Math.max(1, batchRam));
}

function batchRamCost(ns, template) {
  return template.reduce((sum, row) => sum + row.threads * ns.getScriptRam(row.script, "home"), 0);
}

function estimateTimingCap(ns, target, spacer) {
  const weakenTime = ns.getWeakenTime(target);
  const spacingWindow = Math.max(1, spacer * 4);
  return Math.max(12, Math.floor(weakenTime / spacingWindow));
}

function handlePrepTarget(ns, hosts, target, info, homeReserve, ramBudget) {
  let launched = 0;
  if (info.sec > info.secMin + 1.0) {
    if (!hasTaggedRunning(ns, hosts, target, "prepW-")) {
      launched += runPrepWeaken(ns, hosts, target, homeReserve, ramBudget);
    }
    return launched;
  }

  if (info.money < info.moneyMax * 0.95) {
    if (!hasTaggedRunning(ns, hosts, target, "prepG-")) {
      launched += runPrepGrow(ns, hosts, target, homeReserve, ramBudget);
    }
  }

  return launched;
}

function runPrepWeaken(ns, hosts, target, homeReserve, ramBudget) {
  const ram = ns.getScriptRam("batchWeaken.js", "home");
  let remainingRam = ramBudget;
  let launched = 0;
  const tag = `prepW-${Date.now()}`;

  for (const host of hosts) {
    const hostFree = Math.min(freeRam(ns, host, homeReserve), remainingRam);
    const threads = Math.floor(hostFree / ram);
    if (threads <= 0) continue;
    const pid = ns.exec("batchWeaken.js", host, threads, target, 0, tag);
    if (pid !== 0) {
      launched += threads;
      remainingRam -= threads * ram;
    }
    if (remainingRam < ram) break;
  }

  return launched;
}

function runPrepGrow(ns, hosts, target, homeReserve, ramBudget) {
  const growRam = ns.getScriptRam("batchGrow.js", "home");
  const weakenRam = ns.getScriptRam("batchWeaken.js", "home");
  let remainingRam = ramBudget;
  let launched = 0;
  const tag = `prepG-${Date.now()}`;

  for (const host of hosts) {
    const hostFree = Math.min(freeRam(ns, host, homeReserve), remainingRam);
    if (hostFree <= 0) continue;
    const growThreads = Math.floor((hostFree * 0.75) / growRam);
    const weakenThreads = Math.floor((hostFree * 0.25) / weakenRam);

    if (growThreads > 0) {
      const pid = ns.exec("batchGrow.js", host, growThreads, target, 0, `${tag}-g`);
      if (pid !== 0) launched += growThreads;
    }
    if (weakenThreads > 0) {
      const pid = ns.exec("batchWeaken.js", host, weakenThreads, target, 0, `${tag}-w`);
      if (pid !== 0) launched += weakenThreads;
    }
    remainingRam -= hostFree;
    if (remainingRam < Math.min(growRam, weakenRam)) break;
  }

  return launched;
}

function hasTaggedRunning(ns, hosts, target, prefix) {
  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (proc.args?.[0] !== target) continue;
      const tag = String(proc.args?.[2] ?? "");
      if (tag.startsWith(prefix)) return true;
    }
  }
  return false;
}

function rankTargets(ns, fleet) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  const ranked = [];

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
    if (ns.getServerMaxMoney(host) <= 0) continue;
    if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) continue;

    const score = scoreSingleTarget(ns, host, fleet);
    if (Number.isFinite(score) && score > 0) {
      ranked.push({ target: host, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function scoreSingleTarget(ns, server, fleet) {
  const ramFreeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
  const speedBias = ramFreeRatio > 0.25;

  const maxMoney = Math.max(1, ns.getServerMaxMoney(server));
  const moneyAvail = Math.max(0, ns.getServerMoneyAvailable(server));
  const moneyRatio = moneyAvail / maxMoney;

  const minSec = Math.max(1, ns.getServerMinSecurityLevel(server));
  const curSec = Math.max(minSec, ns.getServerSecurityLevel(server));
  const secPenalty = curSec / minSec;

  const hackTime = Math.max(1, ns.getHackTime(server));
  const growTime = Math.max(1, ns.getGrowTime(server));
  const weakenTime = Math.max(1, ns.getWeakenTime(server));
  const cycleTime = Math.max(hackTime, growTime, weakenTime);
  const chance = Math.max(0.01, ns.hackAnalyzeChance(server));

  let prepPenalty = 1;
  if (moneyRatio < 0.90) prepPenalty *= 1.30;
  if (curSec > minSec + 1) prepPenalty *= 1.20;
  prepPenalty *= secPenalty;

  const readyBonus = 0.5 + moneyRatio * 0.5;
  const speedFactor = speedBias ? (1000 / cycleTime) : 1;
  const moneyFactor = speedBias ? Math.cbrt(maxMoney) : maxMoney;
  const baseValuePerSec = (maxMoney * chance) / cycleTime;

  return ((moneyFactor * chance * readyBonus) / prepPenalty) * speedFactor * baseValuePerSec;
}

function getTargetInfo(ns, target) {
  if (!target) return emptyTargetInfo();
  const money = ns.getServerMoneyAvailable(target);
  const moneyMax = ns.getServerMaxMoney(target);
  const sec = ns.getServerSecurityLevel(target);
  const secMin = ns.getServerMinSecurityLevel(target);
  return {
    money,
    moneyMax,
    sec,
    secMin,
    moneyRatio: moneyMax > 0 ? money / moneyMax : 0,
    secAboveMin: Math.max(0, sec - secMin),
  };
}

function emptyTargetInfo() {
  return { money: 0, moneyMax: 0, sec: 1, secMin: 1, moneyRatio: 0, secAboveMin: 0 };
}

function needsPrep(info) {
  return info.sec > info.secMin + 1 || info.money < info.moneyMax * 0.95;
}

function countActiveBatchJobs(ns, hosts) {
  let total = 0;
  const names = new Set(["batchHack.js", "batchGrow.js", "batchWeaken.js"]);
  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (names.has(proc.filename)) total++;
    }
  }
  return total;
}

function countActiveBatches(ns, hosts) {
  const ids = new Set();
  const byTarget = new Map();
  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (!["batchHack.js", "batchGrow.js", "batchWeaken.js"].includes(proc.filename)) continue;
      const target = String(proc.args?.[0] ?? "");
      const tag = String(proc.args?.[2] ?? "");
      if (target) byTarget.set(target, (byTarget.get(target) || 0) + 0.25);
      const normalized = tag.replace(/-(H|W1|G|W2)$/i, "");
      if (normalized) ids.add(normalized);
    }
  }
  return { total: ids.size, byTarget };
}

function freeRam(ns, host, homeReserve) {
  const reserve = host === "home" ? homeReserve : 0;
  return Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve);
}

function publishTunerState(key, payload) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(payload));
    }
  } catch {}
}

function renderStatus(ns, ctx) {
  const { mode, fleet, activeJobs, activeBatches, focusTarget, focusInfo, rankedTargets, activeTargets, state } = ctx;
  ns.clearLog();
  ns.print(`Mode: ${mode} avail:${Math.floor(fleet.free)} fleet:${Math.floor(fleet.total)} time:${new Date().getSeconds()}`);
  ns.print(`jobs:${activeJobs}/${state.maxJobs} batches:${activeBatches}/${state.maxBatches}`);
  ns.print(`Tune: hpct:${(state.hackPct * 100).toFixed(2)} spacer:${state.spacer} maxB:${state.maxBatches}`);
  ns.print(`Invest: ${state.invest}`);
  ns.print(`Tune note: ${state.tuneNote}`);
  ns.print(`Fleet RAM: ${ns.formatRam(fleet.free)} free / ${ns.formatRam(fleet.total)} total`);
  ns.print(`Target: ${focusTarget || "none"}`);
  ns.print(`Money: ${ns.formatNumber(focusInfo.money)} / ${ns.formatNumber(focusInfo.moneyMax)}`);
  ns.print(`Security: ${focusInfo.sec.toFixed(2)} / ${focusInfo.secMin.toFixed(2)}`);
  ns.print(`Active targets:`);
  for (const row of activeTargets.slice(0, 4)) {
    ns.print(`  ${row.target.padEnd(18, " ")} ${formatScore(row.score)}`);
  }
  ns.print(`Top targets:`);
  for (const row of rankedTargets.slice(0, 5)) {
    ns.print(`  ${row.target.padEnd(18, " ")} ${formatScore(row.score)}`);
  }
}

function pct(v) {
  return `${(v * 100).toFixed(0)}%`;
}

function formatScore(v) {
  if (!Number.isFinite(v)) return "0";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}t`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}b`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}m`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}k`;
  return v.toFixed(2);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampInt(n, min, max) {
  return Math.trunc(clamp(n, min, max));
}
