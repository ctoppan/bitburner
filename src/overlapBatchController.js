/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    try { ns.ui.openTail(); } catch {}

    const args = parseArgs(ns.args);

    let state = {
        hackPct: clamp(args[0] ?? 0.01, 0.01, 0.18),
        spacer: clampInt(args[1] ?? 300, 30, 400),
        homeReserveGb: Math.max(0, Number(args[2] ?? 128)),
        maxBatches: clampInt(args[3] ?? 24, 64, 800),
        maxJobs: 3200,
        tuneNote: "init",
        invest: "balanced",
        mode: "BATCH",
        lastTuneAt: 0,
        lastTarget: null,
        lastTargetScore: 0,
        lastTargetSwitchAt: 0,
    };

    const TUNE_INTERVAL = 30000;
    const LOOP_SLEEP = 1500;
    const TARGET_HOLD_MS = 120000;
    const TARGET_SWITCH_MULTIPLIER = 1.15;
    const TUNER_KEY = "bb_tuner_state_v1";

    while (true) {
        try {
            const rooted = getRootedServers(ns);
            const workers = rooted.filter(s => ns.getServerMaxRam(s) > 0);
            const fleet = getFleetRam(ns, workers, state.homeReserveGb);

            const rankedTargets = rankTargets(ns, fleet).slice(0, 5);
            const selected = selectTarget(ns, state, fleet, rankedTargets);
            const target = selected.target;
            const targetScore = selected.score;
            const targetInfo = getTargetInfo(ns, target);

            const activeJobs = countActiveBatchJobs(ns, rooted);
            const activeBatches = countActiveBatches(ns, rooted).total;

            if (shouldTune(state.lastTuneAt, TUNE_INTERVAL)) {
                tuneState(state, fleet, activeJobs, activeBatches, targetInfo);
                state.lastTuneAt = Date.now();
            }

            publishTunerState(TUNER_KEY, {
                ts: Date.now(),
                invest: state.invest,
                tuneNote: state.tuneNote,
                target,
                targetScore,
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

            if (state.lastTarget !== target) {
                ns.print(`[overlapBatchController.js] Target selected: ${target}`);
                state.lastTarget = target;
                state.lastTargetScore = targetScore;
                state.lastTargetSwitchAt = Date.now();
            }

            renderTail(ns, buildSummary(ns, state, fleet, target, targetScore, targetInfo, activeJobs, activeBatches, rankedTargets));

            if (canLaunchMore(state, activeJobs, activeBatches, fleet)) {
                await tryLaunchBatch(ns, workers, target, state, targetInfo, fleet);
            }

            await ns.sleep(LOOP_SLEEP);
        } catch (err) {
            ns.print(`ERROR: ${String(err)}`);
            await ns.sleep(5000);
        }
    }
}

function parseArgs(args) {
    return [
        Number(args[0] ?? 0.01),
        Number(args[1] ?? 300),
        Number(args[2] ?? 128),
        Number(args[3] ?? 24),
    ];
}

function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(n, min), max);
}

function clampInt(v, min, max) {
    return Math.trunc(clamp(v, min, max));
}

function shouldTune(lastTuneAt, interval) {
    return Date.now() - lastTuneAt >= interval;
}

function tuneState(state, fleet, activeJobs, activeBatches, targetInfo) {
    const ramFreeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
    const jobPressure = state.maxJobs > 0 ? activeJobs / state.maxJobs : 1;
    const batchPressure = state.maxBatches > 0 ? activeBatches / state.maxBatches : 1;

    if (ramFreeRatio > 0.9) {
        state.hackPct = clamp(state.hackPct * 1.18, 0.03, 0.18);
        state.spacer = clampInt(Math.floor(state.spacer * 0.92), 30, 400);
        state.maxBatches = clampInt(state.maxBatches + 24, 64, 800);
        state.maxJobs = clampInt(state.maxJobs + 300, 800, 6000);
        state.invest = "buy_servers";
        state.tuneNote = `ramp_up_ram_available free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio > 0.7) {
        state.hackPct = clamp(state.hackPct * 1.10, 0.02, 0.16);
        state.spacer = clampInt(Math.floor(state.spacer * 0.95), 35, 400);
        state.maxBatches = clampInt(state.maxBatches + 12, 64, 800);
        state.maxJobs = clampInt(state.maxJobs + 150, 800, 6000);
        state.invest = "buy_servers";
        state.tuneNote = `ramp_up free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio < 0.1) {
        state.hackPct = clamp(state.hackPct * 0.88, 0.01, 0.15);
        state.spacer = clampInt(Math.floor(state.spacer * 1.15), 40, 500);
        state.maxBatches = clampInt(state.maxBatches - 16, 32, 800);
        state.maxJobs = clampInt(state.maxJobs - 200, 400, 6000);
        state.invest = "save_home";
        state.tuneNote = `backoff_ram_limited free:${pct(ramFreeRatio)}`;
        return;
    }

    if (jobPressure > 0.98 && ramFreeRatio > 0.25) {
        state.maxJobs = clampInt(state.maxJobs + 300, 800, 6000);
        state.maxBatches = clampInt(state.maxBatches + 24, 64, 800);
        state.invest = "buy_servers";
        state.tuneNote = `raise_caps jobs:${pct(jobPressure)} free:${pct(ramFreeRatio)}`;
        return;
    }

    if (batchPressure > 0.98 && ramFreeRatio > 0.25) {
        state.maxBatches = clampInt(state.maxBatches + 24, 64, 800);
        state.invest = "buy_servers";
        state.tuneNote = `raise_batch_cap batches:${pct(batchPressure)} free:${pct(ramFreeRatio)}`;
        return;
    }

    if (targetInfo.moneyRatio < 0.85 || targetInfo.secAboveMin > 2) {
        state.invest = ramFreeRatio > 0.40 ? "buy_servers" : "balanced";
        state.tuneNote = `prep_or_recovery money:${pct(targetInfo.moneyRatio)} sec+${targetInfo.secAboveMin.toFixed(2)}`;
        return;
    }

    state.invest = ramFreeRatio > 0.40 ? "buy_servers" : "balanced";
    state.tuneNote = `stable free:${pct(ramFreeRatio)} jobs:${pct(jobPressure)} batches:${pct(batchPressure)}`;
}

function canLaunchMore(state, activeJobs, activeBatches, fleet) {
    if (fleet.free < 256) return false;
    if (activeJobs >= state.maxJobs) return false;
    if (activeBatches >= state.maxBatches) return false;
    return true;
}

async function tryLaunchBatch(ns, workers, target, state, targetInfo, fleet) {
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const moneyMax = Math.max(1, targetInfo.moneyMax);
    const hackFraction = clamp(state.hackPct, 0.03, 0.18);

    let hackThreads = Math.max(4, Math.floor(ns.hackAnalyzeThreads(target, moneyMax * hackFraction) || 4));
    const growMultiplier = 1 / Math.max(0.01, 1 - hackFraction);
    let growThreads = Math.max(20, Math.ceil(ns.growthAnalyze(target, growMultiplier) || 20));
    let weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
    let weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));

    const ramScale = clamp(Math.floor(fleet.free / 2048), 1, 32);
    if (fleet.free > 4096) {
        const scale = Math.min(ramScale, 12);
        hackThreads = Math.max(4, Math.floor(hackThreads * scale));
        growThreads = Math.max(20, Math.floor(growThreads * scale));
        weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
        weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));
    }

    const weakenTime = ns.getWeakenTime(target);
    const growTime = ns.getGrowTime(target);
    const hackTime = ns.getHackTime(target);
    const spacer = state.spacer;

    const now = Date.now();
    const w1Delay = 0;
    const gDelay = Math.max(0, weakenTime - growTime + spacer);
    const hDelay = Math.max(0, weakenTime - hackTime + (spacer * 2));
    const w2Delay = spacer * 3;

    const jobs = [
        { script: "batchHack.js", threads: hackThreads, args: [target, now + hDelay, `${batchId}-H`] },
        { script: "batchWeaken.js", threads: weakenHackThreads, args: [target, now + w1Delay, `${batchId}-W1`] },
        { script: "batchGrow.js", threads: growThreads, args: [target, now + gDelay, `${batchId}-G`] },
        { script: "batchWeaken.js", threads: weakenGrowThreads, args: [target, now + w2Delay, `${batchId}-W2`] },
    ];

    for (const job of jobs) {
        const launched = launchDistributed(ns, workers, job.script, job.threads, job.args, state.homeReserveGb);
        if (!launched) return false;
    }

    return true;
}

function launchDistributed(ns, workers, script, threads, args, homeReserveGb) {
    let remaining = threads;
    const ramPerThread = ns.getScriptRam(script, "home");
    if (ramPerThread <= 0) return false;

    const ordered = [...workers].sort((a, b) => getServerFreeRam(ns, b, homeReserveGb) - getServerFreeRam(ns, a, homeReserveGb));

    for (const host of ordered) {
        const free = getServerFreeRam(ns, host, homeReserveGb);
        const maxThreads = Math.floor(free / ramPerThread);
        if (maxThreads <= 0) continue;

        const use = Math.min(maxThreads, remaining);
        if (use <= 0) continue;

        if (host !== "home") ns.scp(script, host, "home");

        const pid = ns.exec(script, host, use, ...args);
        if (pid !== 0) {
            remaining -= use;
        }

        if (remaining <= 0) return true;
    }

    return false;
}

function getRootedServers(ns) {
    const discovered = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!discovered.has(next)) {
                discovered.add(next);
                queue.push(next);
            }
        }
    }

    return [...discovered].filter(s => ns.hasRootAccess(s));
}

function getFleetRam(ns, servers, homeReserveGb) {
    let total = 0;
    let used = 0;

    for (const s of servers) {
        let max = ns.getServerMaxRam(s);
        let use = ns.getServerUsedRam(s);

        if (s === "home") {
            max = Math.max(0, max - homeReserveGb);
            use = Math.min(use, max);
        }

        total += max;
        used += use;
    }

    return {
        total,
        used,
        free: Math.max(0, total - used),
    };
}

function getServerFreeRam(ns, host, homeReserveGb = 0) {
    let max = ns.getServerMaxRam(host);
    const used = ns.getServerUsedRam(host);

    if (host === "home") {
        max = Math.max(0, max - homeReserveGb);
    }

    return Math.max(0, max - used);
}

function selectTarget(ns, state, fleet, rankedTargets) {
    if (!rankedTargets.length) {
        return { target: "n00dles", score: 0 };
    }

    const best = rankedTargets[0];
    if (!state.lastTarget) return best;

    const currentScore = scoreSingleTarget(ns, state.lastTarget, fleet);
    const enoughTimePassed = (Date.now() - state.lastTargetSwitchAt) > 120000;
    const meaningfullyBetter = best.score > (currentScore * 1.15);

    if (!enoughTimePassed && !meaningfullyBetter) {
        return { target: state.lastTarget, score: currentScore };
    }

    return best;
}

function rankTargets(ns, fleet) {
    const servers = getRootedServers(ns)
        .filter(s => ns.getServerMaxMoney(s) > 0)
        .filter(s => ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel())
        .filter(s => s !== "home");

    if (!servers.length) return [{ target: "n00dles", score: 0 }];

    const ranked = [];
    for (const s of servers) {
        ranked.push({ target: s, score: scoreSingleTarget(ns, s, fleet) });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
}

function scoreSingleTarget(ns, server, fleet) {
    const ramFreeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
    const speedBias = ramFreeRatio > 0.50;

    const maxMoney = Math.max(1, ns.getServerMaxMoney(server));
    const moneyAvail = Math.max(0, ns.getServerMoneyAvailable(server));
    const moneyRatio = maxMoney > 0 ? moneyAvail / maxMoney : 0;

    const minSec = Math.max(1, ns.getServerMinSecurityLevel(server));
    const curSec = Math.max(minSec, ns.getServerSecurityLevel(server));
    const secPenalty = curSec / minSec;

    const hackTime = Math.max(1, ns.getHackTime(server));
    const growTime = Math.max(1, ns.getGrowTime(server));
    const weakenTime = Math.max(1, ns.getWeakenTime(server));
    const chance = Math.max(0.01, ns.hackAnalyzeChance(server));

    const cycleTime = Math.max(hackTime, growTime, weakenTime);

    let prepPenalty = 1;
    if (moneyRatio < 0.90) prepPenalty *= 1.35;
    if (curSec > minSec + 1) prepPenalty *= 1.25;
    prepPenalty *= secPenalty;

    const readyBonus = 0.5 + (moneyRatio * 0.5);
    const baseValuePerSec = (maxMoney * chance) / cycleTime;
    const speedFactor = speedBias ? (1000 / cycleTime) : 1;
    const moneyFactor = speedBias ? Math.sqrt(maxMoney) : maxMoney;

    return ((moneyFactor * chance * readyBonus) / prepPenalty) * speedFactor * baseValuePerSec;
}

function getTargetInfo(ns, target) {
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

function countActiveBatchJobs(ns, servers) {
    let total = 0;
    const names = new Set(["batchHack.js", "batchGrow.js", "batchWeaken.js", "prepTarget.js"]);

    for (const s of servers) {
        for (const proc of ns.ps(s)) {
            if (names.has(proc.filename)) total++;
        }
    }

    return total;
}

function countActiveBatches(ns, servers) {
    const ids = new Set();

    for (const s of servers) {
        for (const proc of ns.ps(s)) {
            if (!["batchHack.js", "batchGrow.js", "batchWeaken.js"].includes(proc.filename)) continue;
            const args = proc.args || [];
            const id = typeof args[2] === "string" ? args[2] : typeof args[1] === "string" ? args[1] : null;
            if (id) ids.add(String(id).replace(/-(H|W1|G|W2)$/, ""));
        }
    }

    return { total: ids.size };
}

function publishTunerState(key, payload) {
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(key, JSON.stringify(payload));
        }
    } catch {}
}

function buildSummary(ns, state, fleet, target, targetScore, targetInfo, activeJobs, activeBatches, rankedTargets) {
    const lines = [
        `Mode: ${state.mode} x1 avail:${Math.floor(fleet.free)} fleet:${Math.floor(fleet.total)} time:${new Date().getSeconds()}`,
        `jobs:${activeJobs}/${state.maxJobs} batches:${activeBatches}/${state.maxBatches}`,
        `Tune: dynamic hpct:${(state.hackPct * 100).toFixed(2)} spacer:${state.spacer} maxB:${state.maxBatches}`,
        `Invest: ${state.invest}`,
        `Tune note: ${state.tuneNote}`,
        `Fleet RAM: ${ns.formatRam(fleet.free)} free / ${ns.formatRam(fleet.total)} total`,
        `Target: ${target} score:${formatScore(targetScore)}`,
        `Money: ${ns.formatNumber(targetInfo.money)} / ${ns.formatNumber(targetInfo.moneyMax)}`,
        `Security: ${targetInfo.sec.toFixed(2)} / ${targetInfo.secMin.toFixed(2)}`,
        `Top targets:`,
    ];

    for (const row of rankedTargets) {
        lines.push(`  ${row.target.padEnd(18, " ")} ${formatScore(row.score)}`);
    }

    return lines;
}

function renderTail(ns, lines) {
    ns.clearLog();
    for (const line of lines) {
        ns.print(line);
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