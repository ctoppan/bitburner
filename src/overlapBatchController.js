/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    try { ns.ui.openTail(); } catch {}

    const args = parseArgs(ns.args);

    let state = {
        hackPct: clamp(args.hackPct, 0.01, 0.12),
        spacer: clampInt(args.spacer, 80, 400),
        homeReserveGb: Math.max(0, Number(args.homeReserveGb) || 128),
        maxBatches: clampInt(args.maxBatches, 16, 120),
        maxJobs: 220,
        tuneNote: "init",
        invest: "balanced",
        mode: "BATCH",
        lastTuneAt: 0,
        lastTarget: null,
    };

    const TUNE_INTERVAL = 30_000;
    const LOOP_SLEEP = 2_000;
    const TUNER_PORT = "bb_tuner_state_v1";

    while (true) {
        try {
            const rooted = getRootedServers(ns);
            const workers = rooted.filter(s => ns.getServerMaxRam(s) > 0);
            const fleet = getFleetRam(ns, workers, state.homeReserveGb);

            const target = pickBestTarget(ns);
            const targetInfo = getTargetInfo(ns, target);

            const activeJobs = countActiveBatchJobs(ns, rooted);
            const batchCounts = countActiveBatches(ns, rooted);
            const activeBatches = batchCounts.total;

            if (shouldTune(state.lastTuneAt, TUNE_INTERVAL)) {
                tuneState(state, fleet, activeJobs, activeBatches, targetInfo);
                state.lastTuneAt = Date.now();
            }

            publishTunerState(TUNER_PORT, {
                ts: Date.now(),
                invest: state.invest,
                tuneNote: state.tuneNote,
                target,
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
            }

            const summary = buildSummary(ns, state, fleet, target, targetInfo, activeJobs, activeBatches);
            renderTail(ns, summary);

            if (canLaunchMore(state, activeJobs, activeBatches, fleet)) {
                await tryLaunchBatch(ns, workers, target, state, targetInfo, fleet);
            }

            await ns.sleep(LOOP_SLEEP);
        } catch (err) {
            ns.print(`ERROR: ${String(err)}`);
            await ns.sleep(5_000);
        }
    }
}

function parseArgs(args) {
    return {
        hackPct: Number(args[0] ?? 0.01),
        spacer: Number(args[1] ?? 300),
        homeReserveGb: Number(args[2] ?? 128),
        maxBatches: Number(args[3] ?? 24),
    };
}

function clamp(v, min, max) {
    return Math.min(Math.max(Number(v) || 0, min), max);
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

    if (ramFreeRatio > 0.85) {
        state.hackPct = clamp(state.hackPct * 1.30, 0.02, 0.15);
        state.spacer = clampInt(Math.floor(state.spacer * 0.82), 60, 400);
        state.maxBatches = clampInt(state.maxBatches + 4, 16, 120);
        state.invest = "buy_servers";
        state.tuneNote = `ramp_up_ram_available free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio > 0.60) {
        state.hackPct = clamp(state.hackPct * 1.18, 0.02, 0.15);
        state.spacer = clampInt(Math.floor(state.spacer * 0.88), 70, 400);
        state.maxBatches = clampInt(state.maxBatches + 2, 16, 120);
        state.invest = "buy_servers";
        state.tuneNote = `ramp_up free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio < 0.15) {
        state.hackPct = clamp(state.hackPct * 0.85, 0.01, 0.12);
        state.spacer = clampInt(Math.floor(state.spacer * 1.20), 80, 500);
        state.maxBatches = clampInt(state.maxBatches - 2, 12, 120);
        state.invest = "save_home";
        state.tuneNote = `backoff_ram_limited free:${pct(ramFreeRatio)}`;
        return;
    }

    if (jobPressure > 0.98 || batchPressure > 0.98) {
        state.spacer = clampInt(Math.floor(state.spacer * 1.08), 80, 450);
        state.invest = ramFreeRatio > 0.35 ? "balanced" : "save_home";
        state.tuneNote = `soft_backoff_concurrency jobs:${pct(jobPressure)} batches:${pct(batchPressure)}`;
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
    if (fleet.free < 16) return false;
    if (activeJobs >= state.maxJobs) return false;
    if (activeBatches >= state.maxBatches) return false;
    return true;
}

async function tryLaunchBatch(ns, workers, target, state, targetInfo, fleet) {
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const moneyMax = Math.max(1, targetInfo.moneyMax);
    const hackFraction = clamp(state.hackPct, 0.02, 0.15);

    let hackThreads = Math.max(2, Math.floor(ns.hackAnalyzeThreads(target, moneyMax * hackFraction) || 2));
    const growMultiplier = 1 / Math.max(0.01, (1 - hackFraction));
    let growThreads = Math.max(10, Math.ceil(ns.growthAnalyze(target, growMultiplier) || 10));
    let weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
    let weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));

    const ramScale = clamp(Math.floor(fleet.free / 1024), 1, 64);
    if (fleet.free > 2048) {
        hackThreads = Math.max(2, Math.floor(hackThreads * Math.min(ramScale, 8)));
        growThreads = Math.max(10, Math.floor(growThreads * Math.min(ramScale, 8)));
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
        if (!launched) {
            return false;
        }
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

        if (host !== "home") {
            ns.scp(script, host, "home");
        }

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

function pickBestTarget(ns) {
    const candidates = getRootedServers(ns)
        .filter(s => ns.getServerMaxMoney(s) > 0)
        .filter(s => ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel())
        .filter(s => s !== "home");

    if (candidates.length === 0) return "n00dles";

    let best = candidates[0];
    let bestScore = -Infinity;

    for (const s of candidates) {
        const maxMoney = Math.max(1, ns.getServerMaxMoney(s));
        const minSec = Math.max(1, ns.getServerMinSecurityLevel(s));
        const hackTime = Math.max(1, ns.getHackTime(s));
        const chance = ns.hackAnalyzeChance(s);
        const score = (maxMoney * chance) / (hackTime * minSec);

        if (score > bestScore) {
            bestScore = score;
            best = s;
        }
    }

    return best;
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
            if (names.has(proc.filename)) {
                total++;
            }
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
            if (id) {
                const normalized = String(id).replace(/-(H|W1|G|W2)$/, "");
                ids.add(normalized);
            }
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

function buildSummary(ns, state, fleet, target, targetInfo, activeJobs, activeBatches) {
    return [
        `Mode: ${state.mode} x1 avail:${Math.floor(fleet.free)} fleet:${Math.floor(fleet.total)} time:${new Date().getSeconds()}`,
        `jobs:${activeJobs}/${state.maxJobs} batches:${activeBatches}/${state.maxBatches}`,
        `Tune: dynamic hpct:${(state.hackPct * 100).toFixed(2)} spacer:${state.spacer} maxB:${state.maxBatches}`,
        `Invest: ${state.invest}`,
        `Tune note: ${state.tuneNote}`,
        `Fleet RAM: ${ns.formatRam(fleet.free)} free / ${ns.formatRam(fleet.total)} total`,
        `Target: ${target}`,
        `Money: ${ns.formatNumber(targetInfo.money)} / ${ns.formatNumber(targetInfo.moneyMax)}`,
        `Security: ${targetInfo.sec.toFixed(2)} / ${targetInfo.secMin.toFixed(2)}`,
    ];
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