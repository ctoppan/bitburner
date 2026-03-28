/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    try { ns.ui.openTail(); } catch {}

    const opts = parseArgs(ns.args);
    const state = {
        hackPct: clamp(opts.hackPct, 0.02, 0.30),
        spacer: clampInt(opts.spacer, 20, 700),
        homeReserveGb: opts.homeReserveGb,
        effectiveHomeReserveGb: 0,
        maxBatches: Math.max(512, opts.maxBatches),
        maxJobs: 16000,
        tuneNote: "init",
        invest: "balanced",
        mode: "FAST_START",
        fastStart: true,
        lastTuneAt: 0,
        lastTarget: "",
        lastTargetScore: 0,
        lastTargetSwitchAt: 0,
        lastHomeTrimNote: "none",
    };

    const TUNER_KEY = "bb_tuner_state_v8";
    const TUNE_INTERVAL = 3000;
    const LOOP_SLEEP = 500;
    const TARGET_HOLD_MS = 60000;
    const TARGET_SWITCH_MULTIPLIER = 1.12;
    const MAX_PREP_LAUNCHES_PER_LOOP = 8;

    while (true) {
        try {
            const rooted = getRootedServers(ns);
            const workers = rooted.filter(s => ns.getServerMaxRam(s) > 0);

            state.effectiveHomeReserveGb = resolveHomeReserveGb(ns, state.homeReserveGb);

            state.lastHomeTrimNote = enforceHomeReserve(ns, state.effectiveHomeReserveGb);

            const fleet = getFleetRam(ns, workers, state.effectiveHomeReserveGb);
            state.fastStart = isFastStart(ns, fleet);

            autoScaleCaps(state, fleet);

            const rankedTargets = rankTargets(ns);
            const activeTargetPool = chooseActiveTargets(rankedTargets);
            const selected = selectPrimaryTarget(ns, state, activeTargetPool, TARGET_HOLD_MS, TARGET_SWITCH_MULTIPLIER);
            const primaryTarget = selected.target;
            const primaryScore = selected.score;
            const primaryInfo = getTargetInfo(ns, primaryTarget);

            const activeJobs = countActiveBatchJobs(ns, rooted);
            const activeBatches = countActiveBatches(ns, rooted).total;

            if (shouldTune(state.lastTuneAt, TUNE_INTERVAL)) {
                tuneState(state, fleet, activeJobs, activeBatches, primaryInfo);

                if (fleet.total > 0 && fleet.free / fleet.total > 0.60 && activeJobs === 0) {
                    state.hackPct = clamp(state.hackPct, 0.03, 0.12);
                    state.spacer = clampInt(Math.min(state.spacer, 30), 20, 700);
                    state.tuneNote = `kickstart free:${pct(fleet.free / fleet.total)}`;
                }

                state.lastTuneAt = Date.now();
            }

            publishTunerState(TUNER_KEY, {
                ts: Date.now(),
                invest: state.invest,
                tuneNote: state.tuneNote,
                target: primaryTarget,
                targetScore: primaryScore,
                fleetFreeRam: fleet.free,
                fleetTotalRam: fleet.total,
                homeReserveGb: state.effectiveHomeReserveGb,
                fastStart: state.fastStart,
                ramFreeRatio: fleet.total > 0 ? fleet.free / fleet.total : 0,
                activeJobs,
                maxJobs: state.maxJobs,
                activeBatches,
                maxBatches: state.maxBatches,
                hackPct: state.hackPct,
                spacer: state.spacer,
                activeTargets: activeTargetPool.map(t => t.target),
                homeTrimNote: state.lastHomeTrimNote,
            });

            if (state.lastTarget !== primaryTarget) {
                ns.print(`[overlapBatchController.js] Target selected: ${primaryTarget}`);
                state.lastTarget = primaryTarget;
                state.lastTargetScore = primaryScore;
                state.lastTargetSwitchAt = Date.now();
            }

            const maxLaunchesThisLoop = getLaunchPressure(fleet, state.fastStart);
            let launchedThisLoop = 0;
            let prepLaunchedThisLoop = 0;
            let lastAction = "idle";

            while (
                launchedThisLoop < maxLaunchesThisLoop &&
                canLaunchMore(
                    state,
                    activeJobs + launchedThisLoop * 4,
                    activeBatches + launchedThisLoop,
                    getFleetRam(ns, workers, state.effectiveHomeReserveGb)
                ) &&
                getFleetRam(ns, workers, state.effectiveHomeReserveGb).free >= getMinBatchFreeRam(state, fleet)
            ) {
                const primaryInfoNow = getTargetInfo(ns, primaryTarget);

                if (needsPrep(primaryInfoNow)) {
                    if (prepLaunchedThisLoop >= MAX_PREP_LAUNCHES_PER_LOOP) break;

                    if (!tryLaunchPrep(ns, workers, primaryTarget, state, primaryInfoNow, fleet)) break;

                    lastAction = `prep:${primaryTarget}`;
                    launchedThisLoop++;
                    prepLaunchedThisLoop++;
                    continue;
                }

                const launchTarget = pickLaunchTarget(activeTargetPool);
                if (!launchTarget) break;

                const targetInfo = getTargetInfo(ns, launchTarget.target);
                if (!tryLaunchBatch(ns, workers, launchTarget.target, state, targetInfo, fleet)) break;

                lastAction = `batch:${launchTarget.target}`;
                launchedThisLoop++;
            }

            state.lastHomeTrimNote = enforceHomeReserve(ns, state.effectiveHomeReserveGb);

            const liveFleet = getFleetRam(ns, workers, state.effectiveHomeReserveGb);
            const liveActiveJobs = countActiveBatchJobs(ns, rooted);
            const liveActiveBatches = countActiveBatches(ns, rooted).total;
            const livePrimaryInfo = getTargetInfo(ns, primaryTarget);

            renderTail(ns, buildSummary(
                ns,
                state,
                liveFleet,
                primaryTarget,
                primaryScore,
                livePrimaryInfo,
                liveActiveJobs,
                liveActiveBatches,
                activeTargetPool,
                rankedTargets.slice(0, 6),
                lastAction,
                launchedThisLoop,
                maxLaunchesThisLoop,
            ));

            await ns.sleep(LOOP_SLEEP);
        } catch (err) {
            ns.print(`ERROR: ${String(err)}`);
            await ns.sleep(2000);
        }
    }
}

function parseArgs(args) {
    return {
        hackPct: Number(args[0] ?? 0.03),
        spacer: Math.max(20, Math.trunc(Number(args[1]) || 30)),
        homeReserveGb: Number.isFinite(Number(args[2])) ? Number(args[2]) : -1,
        maxBatches: 1024,
    };
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

function autoScaleCaps(state, fleet) {
    const totalTb = fleet.total / 1024;
    const freeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
    const fastStart = state.fastStart;

    const targetMaxBatches = clampInt(Math.floor(totalTb * (fastStart ? 180 : 100)), fastStart ? 896 : 512, 50000);
    const targetMaxJobs = clampInt(Math.floor(totalTb * (fastStart ? 700 : 320)), fastStart ? 14000 : 7000, 200000);

    if (state.maxBatches < targetMaxBatches) {
        state.maxBatches = Math.min(
            targetMaxBatches,
            state.maxBatches + Math.max(fastStart ? 512 : 192, Math.floor(targetMaxBatches * 0.22))
        );
    } else if (freeRatio < 0.05 && state.maxBatches > 512) {
        state.maxBatches = Math.max(512, state.maxBatches - Math.max(128, Math.floor(state.maxBatches * 0.04)));
    }

    if (state.maxJobs < targetMaxJobs) {
        state.maxJobs = Math.min(
            targetMaxJobs,
            state.maxJobs + Math.max(fastStart ? 2200 : 900, Math.floor(targetMaxJobs * 0.18))
        );
    } else if (freeRatio < 0.05 && state.maxJobs > 7000) {
        state.maxJobs = Math.max(7000, state.maxJobs - Math.max(600, Math.floor(state.maxJobs * 0.04)));
    }
}

function getLaunchPressure(fleet, fastStart) {
    const totalTb = fleet.total / 1024;
    const freeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;

    let launches = fastStart ? 24 : 8;
    if (totalTb > 0.5) launches = fastStart ? 32 : 12;
    if (totalTb > 1) launches = fastStart ? 40 : 16;
    if (totalTb > 4) launches = fastStart ? 56 : 24;
    if (totalTb > 16) launches = fastStart ? 72 : 32;
    if (totalTb > 64) launches = fastStart ? 96 : 48;

    if (freeRatio < 0.10) launches = Math.max(fastStart ? 8 : 4, Math.floor(launches * 0.35));
    else if (freeRatio < 0.20) launches = Math.max(fastStart ? 10 : 6, Math.floor(launches * 0.55));

    return launches;
}

function tuneState(state, fleet, activeJobs, activeBatches, targetInfo) {
    const ramFreeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
    const jobPressure = state.maxJobs > 0 ? activeJobs / state.maxJobs : 1;
    const batchPressure = state.maxBatches > 0 ? activeBatches / state.maxBatches : 1;
    const fastStart = state.fastStart;

    if (fastStart && ramFreeRatio > 0.80) {
        state.hackPct = clamp(state.hackPct * 1.10, 0.04, 0.22);
        state.spacer = clampInt(Math.floor(state.spacer * 0.90), 20, 400);
        state.invest = "turbo_buy_servers";
        state.mode = "FAST_START";
        state.tuneNote = `fast_push free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio > 0.50) {
        state.hackPct = clamp(state.hackPct * 1.05, 0.03, 0.18);
        state.spacer = clampInt(Math.floor(state.spacer * 0.94), 20, 500);
        state.invest = fastStart ? "buy_servers" : "balanced";
        state.mode = fastStart ? "FAST_START" : "MULTI";
        state.tuneNote = `ramp_up free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio < 0.10) {
        state.hackPct = clamp(state.hackPct * 0.90, 0.01, 0.12);
        state.spacer = clampInt(Math.floor(state.spacer * 1.15), 30, 700);
        state.invest = "save_home";
        state.tuneNote = `backoff free:${pct(ramFreeRatio)}`;
        return;
    }

    if (needsPrep(targetInfo)) {
        state.hackPct = clamp(state.hackPct * 0.98, 0.01, 0.12);
        state.invest = ramFreeRatio > 0.25 ? (fastStart ? "buy_servers" : "balanced") : "save_home";
        state.tuneNote = `prep money:${pct(targetInfo.moneyRatio)} sec+${targetInfo.secAboveMin.toFixed(2)}`;
        return;
    }

    if (jobPressure > 0.95 && ramFreeRatio > 0.15) {
        state.spacer = clampInt(state.spacer + 5, 20, 700);
        state.tuneNote = `job_limited jobs:${pct(jobPressure)}`;
        return;
    }

    if (batchPressure > 0.95 && ramFreeRatio > 0.15) {
        state.hackPct = clamp(state.hackPct * 1.02, 0.02, 0.20);
        state.tuneNote = `batch_limited batches:${pct(batchPressure)}`;
        return;
    }

    state.tuneNote = `stable free:${pct(ramFreeRatio)}`;
}

function canLaunchMore(state, activeJobs, activeBatches, fleet) {
    if (fleet.free < getMinBatchFreeRam(state, fleet)) return false;
    if (activeJobs >= state.maxJobs) return false;
    if (activeBatches >= state.maxBatches) return false;
    return true;
}

function needsPrep(targetInfo) {
    return targetInfo.moneyRatio < 0.90 || targetInfo.secAboveMin > 1.5;
}

function tryLaunchPrep(ns, workers, target, state, targetInfo, fleetSnapshot) {
    const fleet = fleetSnapshot || getFleetRam(ns, workers, state.effectiveHomeReserveGb);
    const secAboveMin = targetInfo.secAboveMin;
    const moneyRatio = targetInfo.moneyRatio;

    let weakenThreads = secAboveMin > 0.1 ? Math.max(1, Math.ceil(secAboveMin / 0.05)) : 0;
    let growThreads = 0;

    if (moneyRatio < 0.995) {
        const growMultiplier = Math.max(1.03, 1 / Math.max(0.01, moneyRatio));
        growThreads = Math.max(8, Math.ceil(ns.growthAnalyze(target, growMultiplier) || 8));
    }

    if (growThreads > 0) {
        weakenThreads += Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));
    }

    const ramWeak = ns.getScriptRam("batchWeaken.js", "home");
    const ramGrow = ns.getScriptRam("batchGrow.js", "home");
    const estimatedRam = weakenThreads * ramWeak + growThreads * ramGrow;
    const prepRamCap = Math.max(16, Math.min(fleet.total * 0.10, fleet.free * 0.75));

    if (estimatedRam > prepRamCap && estimatedRam > 0) {
        const scale = prepRamCap / estimatedRam;
        weakenThreads = Math.max(1, Math.floor(weakenThreads * scale));
        growThreads = Math.max(growThreads > 0 ? 1 : 0, Math.floor(growThreads * scale));
    }

    if (weakenThreads <= 0 && growThreads <= 0) return false;

    const launchId = `prep-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let launchedAny = false;

    if (weakenThreads > 0) {
        launchedAny = launchDistributed(
            ns, workers, "batchWeaken.js", weakenThreads, [target, 0, `${launchId}-PW`], state.effectiveHomeReserveGb
        ) || launchedAny;
    }

    if (growThreads > 0) {
        launchedAny = launchDistributed(
            ns, workers, "batchGrow.js", growThreads, [target, 120, `${launchId}-PG`], state.effectiveHomeReserveGb
        ) || launchedAny;
    }

    return launchedAny;
}

function tryLaunchBatch(ns, workers, target, state, targetInfo, fleetSnapshot) {
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const pctPerHackThread = ns.hackAnalyze(target);
    if (!Number.isFinite(pctPerHackThread) || pctPerHackThread <= 0) return false;

    let hackThreads = Math.max(1, Math.floor(clamp(state.hackPct, 0.01, 0.20) / pctPerHackThread));
    const stolenFraction = Math.min(0.90, hackThreads * pctPerHackThread);
    const postHackMoney = Math.max(0.01, 1 - stolenFraction);

    let growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / postHackMoney) || 1));
    let weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
    let weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));

    const ramHack = ns.getScriptRam("batchHack.js", "home");
    const ramGrow = ns.getScriptRam("batchGrow.js", "home");
    const ramWeak = ns.getScriptRam("batchWeaken.js", "home");
    const batchRam =
        hackThreads * ramHack +
        growThreads * ramGrow +
        (weakenHackThreads + weakenGrowThreads) * ramWeak;

    const fleet = fleetSnapshot || getFleetRam(ns, workers, state.effectiveHomeReserveGb);

    if (fleet.free > 64 && batchRam > 0) {
        const ramBudget = Math.min(
            fleet.free * (state.fastStart ? 0.25 : 0.18),
            fleet.free / Math.max(1, state.maxBatches / (state.fastStart ? 8 : 12))
        );

        const scale = clamp(ramBudget / batchRam, 1, state.fastStart ? 48 : 24);

        hackThreads = Math.max(1, Math.floor(hackThreads * scale));
        growThreads = Math.max(1, Math.ceil(growThreads * scale));
        weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
        weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));
    }

    const weakenTime = ns.getWeakenTime(target);
    const growTime = ns.getGrowTime(target);
    const hackTime = ns.getHackTime(target);
    const spacer = state.spacer;

    const jobs = [
        { script: "batchWeaken.js", threads: weakenHackThreads, args: [target, 0, `${batchId}-W1`] },
        { script: "batchGrow.js", threads: growThreads, args: [target, Math.max(0, weakenTime - growTime + spacer), `${batchId}-G`] },
        { script: "batchHack.js", threads: hackThreads, args: [target, Math.max(0, weakenTime - hackTime + spacer * 2), `${batchId}-H`] },
        { script: "batchWeaken.js", threads: weakenGrowThreads, args: [target, spacer * 3, `${batchId}-W2`] },
    ];

    let launchedAny = false;
    for (const job of jobs) {
        launchedAny = launchDistributed(
            ns, workers, job.script, job.threads, job.args, state.effectiveHomeReserveGb
        ) || launchedAny;
    }

    return launchedAny;
}

function launchDistributed(ns, workers, script, threads, args, homeReserveGb) {
    let remaining = threads;
    const ramPerThread = ns.getScriptRam(script, "home");
    if (ramPerThread <= 0) return false;

    const ordered = [...workers].sort(
        (a, b) => getServerFreeRam(ns, b, homeReserveGb) - getServerFreeRam(ns, a, homeReserveGb)
    );

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

    return remaining < threads;
}

function enforceHomeReserve(ns, homeReserveGb) {
    const maxRam = ns.getServerMaxRam("home");
    const allowedUsed = Math.max(0, maxRam - homeReserveGb);
    let usedRam = ns.getServerUsedRam("home");

    if (usedRam <= allowedUsed) return "ok";

    const workers = ns.ps("home")
        .filter(p => ["batchHack.js", "batchGrow.js", "batchWeaken.js"].includes(p.filename))
        .map(p => ({
            pid: p.pid,
            filename: p.filename,
            threads: p.threads,
            ram: p.threads * ns.getScriptRam(p.filename, "home"),
            args: p.args || [],
        }))
        .sort((a, b) => b.pid - a.pid);

    if (workers.length === 0) {
        const overflow = Math.max(0, usedRam - allowedUsed);
        return `overflow:${overflow.toFixed(1)}GB no-home-batch-workers`;
    }

    let killed = 0;
    let freed = 0;

    for (const proc of workers) {
        usedRam = ns.getServerUsedRam("home");
        if (usedRam <= allowedUsed) break;

        if (ns.kill(proc.pid)) {
            killed++;
            freed += proc.ram;
        }
    }

    const finalUsed = ns.getServerUsedRam("home");
    const remainingOverflow = Math.max(0, finalUsed - allowedUsed);

    if (remainingOverflow > 0) {
        return `trimmed:${killed} freed:${freed.toFixed(1)}GB still_over:${remainingOverflow.toFixed(1)}GB`;
    }

    return `trimmed:${killed} freed:${freed.toFixed(1)}GB`;
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

function getMinBatchFreeRam(state, fleet) {
    if (state.fastStart) return Math.max(6, Math.min(24, Math.floor(fleet.total * 0.02)));
    return 32;
}

function resolveHomeReserveGb(ns, requestedReserveGb) {
    if (Number.isFinite(requestedReserveGb) && requestedReserveGb >= 0) return requestedReserveGb;

    const max = ns.getServerMaxRam("home");
    const pservCount = ns.getPurchasedServers().length;

    let reserve = 32;
    if (max >= 256) reserve = 40;
    if (max >= 512) reserve = 48;
    if (max >= 1024) reserve = 64;
    if (max >= 4096) reserve = 96;

    if (pservCount <= 4) reserve = Math.max(32, Math.floor(max * 0.12));

    return Math.max(24, Math.min(reserve, Math.floor(max * 0.25)));
}

function isFastStart(ns, fleet) {
    const pserv = ns.getPurchasedServers();
    const pservCount = pserv.length;
    const minPservRam = pservCount ? Math.min(...pserv.map(s => ns.getServerMaxRam(s))) : 0;

    return fleet.total < 4096 || pservCount < 12 || minPservRam < 256;
}

function chooseActiveTargets(rankedTargets) {
    if (!rankedTargets.length) return [];

    const best = rankedTargets[0];
    const pool = [best];

    for (let i = 1; i < rankedTargets.length && pool.length < 4; i++) {
        if (rankedTargets[i].score >= best.score * 0.72) {
            pool.push(rankedTargets[i]);
        }
    }

    return pool;
}

function pickLaunchTarget(activeTargetPool) {
    if (!activeTargetPool.length) return null;

    const totalScore = activeTargetPool.reduce((sum, t) => sum + Math.max(0.0001, t.score), 0);
    let roll = Math.random() * totalScore;

    for (const entry of activeTargetPool) {
        roll -= Math.max(0.0001, entry.score);
        if (roll <= 0) return entry;
    }

    return activeTargetPool[0];
}

function selectPrimaryTarget(ns, state, activeTargetPool, holdMs, switchMultiplier) {
    if (!activeTargetPool.length) {
        return { target: "n00dles", score: 0 };
    }

    const best = activeTargetPool[0];
    if (!state.lastTarget) return best;

    const currentScore = scoreSingleTarget(ns, state.lastTarget);
    const enoughTimePassed = (Date.now() - state.lastTargetSwitchAt) > holdMs;
    const meaningfullyBetter = best.score > (currentScore * switchMultiplier);

    if (!enoughTimePassed && !meaningfullyBetter) {
        return { target: state.lastTarget, score: currentScore };
    }

    return best;
}

function rankTargets(ns) {
    const playerHack = ns.getHackingLevel();

    const servers = getRootedServers(ns)
        .filter(s => s !== "home")
        .filter(s => ns.getServerMaxMoney(s) > 0)
        .filter(s => ns.getServerRequiredHackingLevel(s) <= playerHack)
        .filter(s => {
            const maxMoney = ns.getServerMaxMoney(s);

            if (playerHack >= 3000) return maxMoney >= 1e11;
            if (playerHack >= 1000) return maxMoney >= 1e9;
            if (playerHack >= 500) return maxMoney >= 2e8;
            if (playerHack >= 250) return maxMoney >= 1e8;
            if (playerHack >= 150) return maxMoney >= 2e7;
            if (playerHack >= 100) return maxMoney >= 1e7;

            return true;
        });

    if (!servers.length) return [{ target: "n00dles", score: 0 }];

    const ranked = servers.map(s => ({ target: s, score: scoreSingleTarget(ns, s) }));
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
}

function scoreSingleTarget(ns, server) {
    const maxMoney = ns.getServerMaxMoney(server);
    if (maxMoney <= 0) return 0;

    const moneyAvail = ns.getServerMoneyAvailable(server);
    const moneyRatio = maxMoney > 0 ? moneyAvail / maxMoney : 0;

    const minSec = Math.max(1, ns.getServerMinSecurityLevel(server));
    const curSec = Math.max(minSec, ns.getServerSecurityLevel(server));
    const secPenalty = Math.max(1, curSec / minSec);

    const chance = Math.max(0.01, ns.hackAnalyzeChance(server));
    const weakenTime = Math.max(1, ns.getWeakenTime(server));

    const value = Math.pow(maxMoney, 1.08);
    const prepPenalty = (moneyRatio < 0.90 || (curSec - minSec) > 1.5) ? 0.72 : 1.0;

    return (value * chance * prepPenalty) / (Math.pow(weakenTime, 0.85) * secPenalty);
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
    const names = new Set(["batchHack.js", "batchGrow.js", "batchWeaken.js"]);

    for (const s of servers) {
        for (const proc of ns.ps(s)) {
            if (names.has(proc.filename)) total++;
        }
    }

    return total;
}

function countActiveBatches(ns, servers) {
    const batchParts = new Map();

    for (const s of servers) {
        for (const proc of ns.ps(s)) {
            if (!["batchHack.js", "batchGrow.js", "batchWeaken.js"].includes(proc.filename)) continue;

            const args = proc.args || [];
            const id = typeof args[2] === "string" ? args[2] : null;
            if (!id || id.startsWith("prep-")) continue;

            const pieces = id.split("-");
            const suffix = pieces[pieces.length - 1];
            const baseId = pieces.slice(0, -1).join("-");

            if (!baseId) continue;

            if (!batchParts.has(baseId)) {
                batchParts.set(baseId, new Set());
            }

            batchParts.get(baseId).add(suffix);
        }
    }

    let total = 0;
    for (const parts of batchParts.values()) {
        if (parts.has("W1") && parts.has("G") && parts.has("H") && parts.has("W2")) {
            total++;
        }
    }

    return { total };
}

function publishTunerState(key, payload) {
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(key, JSON.stringify(payload));
        }
    } catch {}
}

function buildSummary(ns, state, fleet, target, targetScore, targetInfo, activeJobs, activeBatches, activeTargets, rankedTargets, lastAction, launchedThisLoop, maxLaunchesThisLoop) {
    const lines = [
        `Mode: ${state.mode} x${launchedThisLoop}/${maxLaunchesThisLoop} avail:${Math.floor(fleet.free)} fleet:${Math.floor(fleet.total)} time:${new Date().getSeconds()}`,
        `jobs:${activeJobs}/${state.maxJobs} batches:${activeBatches}/${state.maxBatches}`,
        `Tune: auto hpct:${(state.hackPct * 100).toFixed(2)} spacer:${state.spacer} maxB:${state.maxBatches}`,
        `Home reserve: ${state.effectiveHomeReserveGb.toFixed(0)}GB fastStart:${state.fastStart ? "on" : "off"}`,
        `Home trim: ${state.lastHomeTrimNote}`,
        `Invest: ${state.invest}`,
        `Tune note: ${state.tuneNote}`,
        `Action: ${lastAction}`,
        `Fleet RAM: ${ns.formatRam(fleet.free)} free / ${ns.formatRam(fleet.total)} total`,
        `Target: ${target} score:${formatScore(targetScore)} ${needsPrep(targetInfo) ? "[prep]" : "[batch]"}`,
        `Money: ${ns.formatNumber(targetInfo.money)} / ${ns.formatNumber(targetInfo.moneyMax)} (${pct(targetInfo.moneyRatio)})`,
        `Security: ${targetInfo.sec.toFixed(2)} / ${targetInfo.secMin.toFixed(2)} (+${targetInfo.secAboveMin.toFixed(2)})`,
        `Active targets:`,
    ];

    for (const row of activeTargets) {
        lines.push(`  ${row.target.padEnd(18, " ")} ${formatScore(row.score)}`);
    }

    lines.push(`Top targets:`);
    for (const row of rankedTargets) {
        lines.push(`  ${row.target.padEnd(18, " ")} ${formatScore(row.score)}`);
    }

    return lines;
}

function renderTail(ns, lines) {
    ns.clearLog();
    for (const line of lines) ns.print(line);
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