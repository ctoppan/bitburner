/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    try { ns.ui.openTail(); } catch {}

    const [argHackPct, argSpacer, argHomeReserveGb, argMaxBatches] = parseArgs(ns.args);

    const state = {
        hackPct: clamp(argHackPct, 0.02, 0.30),
        spacer: clampInt(argSpacer, 25, 500),
        homeReserveGb: Math.max(0, Number(argHomeReserveGb)),
        maxBatches: Math.max(512, Math.trunc(Number(argMaxBatches) || 0)),
        maxJobs: 12000,
        tuneNote: "init",
        invest: "balanced",
        mode: "MULTI",
        lastTuneAt: 0,
        lastTarget: null,
        lastTargetScore: 0,
        lastTargetSwitchAt: 0,
    };

    const TUNE_INTERVAL = 5000;
    const LOOP_SLEEP = 700;
    const TARGET_HOLD_MS = 180000;
    const TARGET_SWITCH_MULTIPLIER = 1.25;
    const MAX_PREP_LAUNCHES_PER_LOOP = 4;
    const MIN_BATCH_FREE_RAM = 64;
    const TUNER_KEY = "bb_tuner_state_v7";

    while (true) {
        try {
            const rooted = getRootedServers(ns);
            const workers = rooted.filter(s => ns.getServerMaxRam(s) > 0);
            const fleet = getFleetRam(ns, workers, state.homeReserveGb);

            autoScaleCaps(state, fleet);

            const rankedTargets = rankTargets(ns, fleet);
            const activeTargetPool = chooseActiveTargets(rankedTargets);
            const selected = selectPrimaryTarget(ns, state, fleet, activeTargetPool, TARGET_HOLD_MS, TARGET_SWITCH_MULTIPLIER);
            const primaryTarget = selected.target;
            const primaryScore = selected.score;
            const primaryInfo = getTargetInfo(ns, primaryTarget);

            const activeJobs = countActiveBatchJobs(ns, rooted);
            const activeBatches = countActiveBatches(ns, rooted).total;

            if (shouldTune(state.lastTuneAt, TUNE_INTERVAL)) {
                tuneState(state, fleet, activeJobs, activeBatches, primaryInfo);
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
                ramFreeRatio: fleet.total > 0 ? fleet.free / fleet.total : 0,
                activeJobs,
                maxJobs: state.maxJobs,
                activeBatches,
                maxBatches: state.maxBatches,
                hackPct: state.hackPct,
                spacer: state.spacer,
                activeTargets: activeTargetPool.map(t => t.target),
            });

            if (state.lastTarget !== primaryTarget) {
                ns.print(`[overlapBatchController.js] Target selected: ${primaryTarget}`);
                state.lastTarget = primaryTarget;
                state.lastTargetScore = primaryScore;
                state.lastTargetSwitchAt = Date.now();
            }

            const maxLaunchesThisLoop = getLaunchPressure(fleet);
            let launchedThisLoop = 0;
            let prepLaunchedThisLoop = 0;
            let lastAction = "idle";

            while (
                launchedThisLoop < maxLaunchesThisLoop &&
                canLaunchMore(
                    state,
                    activeJobs + launchedThisLoop * 4,
                    activeBatches + launchedThisLoop,
                    getFleetRam(ns, workers, state.homeReserveGb)
                ) &&
                getFleetRam(ns, workers, state.homeReserveGb).free >= MIN_BATCH_FREE_RAM
            ) {
                const primaryInfoNow = getTargetInfo(ns, primaryTarget);

                if (needsPrep(primaryInfoNow)) {
                    if (prepLaunchedThisLoop >= MAX_PREP_LAUNCHES_PER_LOOP) break;

                    const prepOk = tryLaunchPrep(ns, workers, primaryTarget, state, primaryInfoNow);
                    if (!prepOk) break;

                    lastAction = `prep:${primaryTarget}`;
                    launchedThisLoop++;
                    prepLaunchedThisLoop++;
                    continue;
                }

                const launchTarget = pickLaunchTarget(activeTargetPool);
                if (!launchTarget) break;

                const targetInfo = getTargetInfo(ns, launchTarget.target);
                const batchOk = tryLaunchBatch(ns, workers, launchTarget.target, state, targetInfo, fleet);
                if (!batchOk) break;

                lastAction = `batch:${launchTarget.target}`;
                launchedThisLoop++;
            }

            const liveFleet = getFleetRam(ns, workers, state.homeReserveGb);
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
                maxLaunchesThisLoop
            ));

            await ns.sleep(LOOP_SLEEP);
        } catch (err) {
            ns.print(`ERROR: ${String(err)}`);
            await ns.sleep(3000);
        }
    }
}

function parseArgs(args) {
    return [
        Number(args[0] ?? 0.04),
        Number(args[1] ?? 120),
        Number(args[2] ?? 128),
        Number(args[3] ?? 0),
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

function autoScaleCaps(state, fleet) {
    const totalTb = fleet.total / 1024;
    const freeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;

    const targetMaxBatches = clampInt(Math.floor(totalTb * 80), 512, 40000);
    const targetMaxJobs = clampInt(Math.floor(totalTb * 260), 6000, 150000);

    if (state.maxBatches < targetMaxBatches) {
        state.maxBatches = Math.min(targetMaxBatches, state.maxBatches + Math.max(256, Math.floor(targetMaxBatches * 0.18)));
    } else if (freeRatio < 0.05 && state.maxBatches > 512) {
        state.maxBatches = Math.max(512, state.maxBatches - Math.max(128, Math.floor(state.maxBatches * 0.03)));
    }

    if (state.maxJobs < targetMaxJobs) {
        state.maxJobs = Math.min(targetMaxJobs, state.maxJobs + Math.max(1000, Math.floor(targetMaxJobs * 0.12)));
    } else if (freeRatio < 0.05 && state.maxJobs > 6000) {
        state.maxJobs = Math.max(6000, state.maxJobs - Math.max(500, Math.floor(state.maxJobs * 0.03)));
    }
}

function getLaunchPressure(fleet) {
    const totalTb = fleet.total / 1024;
    const freeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;

    let launches = 8;
    if (totalTb > 32) launches = 16;
    if (totalTb > 256) launches = 24;
    if (totalTb > 1024) launches = 32;
    if (totalTb > 4096) launches = 48;
    if (totalTb > 16384) launches = 64;
    if (totalTb > 65536) launches = 96;

    if (freeRatio < 0.10) launches = Math.max(6, Math.floor(launches * 0.4));
    else if (freeRatio < 0.20) launches = Math.max(8, Math.floor(launches * 0.6));

    return launches;
}

function tuneState(state, fleet, activeJobs, activeBatches, targetInfo) {
    const ramFreeRatio = fleet.total > 0 ? fleet.free / fleet.total : 0;
    const jobPressure = state.maxJobs > 0 ? activeJobs / state.maxJobs : 1;
    const batchPressure = state.maxBatches > 0 ? activeBatches / state.maxBatches : 1;

    if (ramFreeRatio > 0.90) {
        state.hackPct = clamp(state.hackPct * 1.15, 0.04, 0.30);
        state.spacer = clampInt(Math.floor(state.spacer * 0.90), 25, 500);
        state.invest = "buy_servers";
        state.mode = "MULTI";
        state.tuneNote = `ramp_hard free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio > 0.70) {
        state.hackPct = clamp(state.hackPct * 1.08, 0.03, 0.25);
        state.spacer = clampInt(Math.floor(state.spacer * 0.94), 30, 500);
        state.invest = "buy_servers";
        state.mode = "MULTI";
        state.tuneNote = `ramp_up free:${pct(ramFreeRatio)}`;
        return;
    }

    if (ramFreeRatio < 0.10) {
        state.hackPct = clamp(state.hackPct * 0.90, 0.01, 0.16);
        state.spacer = clampInt(Math.floor(state.spacer * 1.08), 35, 700);
        state.invest = "save_home";
        state.tuneNote = `backoff_ram_limited free:${pct(ramFreeRatio)}`;
        return;
    }

    if (jobPressure > 0.95 && ramFreeRatio > 0.20) {
        state.tuneNote = `job_limited jobs:${pct(jobPressure)}`;
        return;
    }

    if (batchPressure > 0.95 && ramFreeRatio > 0.20) {
        state.tuneNote = `batch_limited batches:${pct(batchPressure)}`;
        return;
    }

    if (needsPrep(targetInfo)) {
        state.hackPct = clamp(state.hackPct * 0.97, 0.01, 0.18);
        state.invest = ramFreeRatio > 0.35 ? "buy_servers" : "balanced";
        state.tuneNote = `prep_or_recovery money:${pct(targetInfo.moneyRatio)} sec+${targetInfo.secAboveMin.toFixed(2)}`;
        return;
    }

    state.invest = ramFreeRatio > 0.30 ? "buy_servers" : "balanced";
    state.tuneNote = `stable free:${pct(ramFreeRatio)} jobs:${pct(jobPressure)} batches:${pct(batchPressure)}`;
}

function canLaunchMore(state, activeJobs, activeBatches, fleet) {
    if (fleet.free < 64) return false;
    if (activeJobs >= state.maxJobs) return false;
    if (activeBatches >= state.maxBatches) return false;
    return true;
}

function needsPrep(targetInfo) {
    return targetInfo.moneyRatio < 0.75 || targetInfo.secAboveMin > 2.0;
}

function tryLaunchPrep(ns, workers, target, state, targetInfo) {
    const secAboveMin = targetInfo.secAboveMin;
    const moneyRatio = targetInfo.moneyRatio;

    let weakenThreads = 0;
    let growThreads = 0;

    if (secAboveMin > 0.25) {
        weakenThreads = Math.max(1, Math.ceil(secAboveMin / 0.05));
    }

    if (moneyRatio < 0.98) {
        const growMultiplier = Math.max(1.05, 1 / Math.max(0.01, moneyRatio));
        growThreads = Math.max(20, Math.ceil(ns.growthAnalyze(target, growMultiplier) || 20));
    }

    if (growThreads > 0) {
        weakenThreads += Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));
    }

    if (weakenThreads <= 0 && growThreads <= 0) return false;

    const launchId = `prep-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const launched = [];

    const jobs = [];
    if (weakenThreads > 0) {
        jobs.push({
            script: "batchWeaken.js",
            threads: weakenThreads,
            args: [target, 0, `${launchId}-PW`]
        });
    }
    if (growThreads > 0) {
        jobs.push({
            script: "batchGrow.js",
            threads: growThreads,
            args: [target, 150, `${launchId}-PG`]
        });
    }

    for (const job of jobs) {
        const ok = launchDistributed(ns, workers, job.script, job.threads, job.args, state.homeReserveGb, launched);
        if (!ok) {
            cleanupLaunched(ns, launched);
            return false;
        }
    }

    return true;
}

function tryLaunchBatch(ns, workers, target, state, targetInfo, fleetSnapshot) {
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const pctPerHackThread = ns.hackAnalyze(target);
    if (!Number.isFinite(pctPerHackThread) || pctPerHackThread <= 0) return false;

    let hackThreads = Math.max(1, Math.floor(clamp(state.hackPct, 0.01, 0.30) / pctPerHackThread));
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

    const fleet = fleetSnapshot || getFleetRam(ns, workers, state.homeReserveGb);

    if (fleet.free > 512 && batchRam > 0) {
        const ramBudget = Math.min(
            fleet.free * 0.25,
            fleet.free / Math.max(1, state.maxBatches / 10)
        );

        const scale = clamp(ramBudget / batchRam, 1, 64);

        hackThreads = Math.max(1, Math.floor(hackThreads * scale));
        growThreads = Math.max(1, Math.ceil(growThreads * scale));
        weakenHackThreads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
        weakenGrowThreads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));
    }

    const weakenTime = ns.getWeakenTime(target);
    const growTime = ns.getGrowTime(target);
    const hackTime = ns.getHackTime(target);
    const spacer = state.spacer;

    const w1Delay = 0;
    const gDelay = Math.max(0, weakenTime - growTime + spacer);
    const hDelay = Math.max(0, weakenTime - hackTime + spacer * 2);
    const w2Delay = spacer * 3;

    const jobs = [
        { script: "batchWeaken.js", threads: weakenHackThreads, args: [target, w1Delay, `${batchId}-W1`] },
        { script: "batchGrow.js", threads: growThreads, args: [target, gDelay, `${batchId}-G`] },
        { script: "batchHack.js", threads: hackThreads, args: [target, hDelay, `${batchId}-H`] },
        { script: "batchWeaken.js", threads: weakenGrowThreads, args: [target, w2Delay, `${batchId}-W2`] },
    ];

    const launched = [];
    for (const job of jobs) {
        const ok = launchDistributed(ns, workers, job.script, job.threads, job.args, state.homeReserveGb, launched);
        if (!ok) {
            cleanupLaunched(ns, launched);
            return false;
        }
    }

    return true;
}

function launchDistributed(ns, workers, script, threads, args, homeReserveGb, launched = []) {
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
            launched.push({ host, pid });
            remaining -= use;
        }

        if (remaining <= 0) return true;
    }

    return false;
}

function cleanupLaunched(ns, launched) {
    for (const entry of launched) {
        try { ns.kill(entry.pid, entry.host); } catch {}
    }
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

function chooseActiveTargets(rankedTargets) {
    if (!rankedTargets.length) return [];

    const best = rankedTargets[0];
    const pool = [best];

    for (let i = 1; i < rankedTargets.length && pool.length < 4; i++) {
        const candidate = rankedTargets[i];
        if (candidate.score >= best.score * 0.70) {
            pool.push(candidate);
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

function selectPrimaryTarget(ns, state, fleet, activeTargetPool, holdMs, switchMultiplier) {
    if (!activeTargetPool.length) {
        return { target: "n00dles", score: 0 };
    }

    const best = activeTargetPool[0];
    if (!state.lastTarget) return best;

    const currentScore = scoreSingleTarget(ns, state.lastTarget, fleet);
    const enoughTimePassed = (Date.now() - state.lastTargetSwitchAt) > holdMs;
    const meaningfullyBetter = best.score > (currentScore * switchMultiplier);

    if (!enoughTimePassed && !meaningfullyBetter) {
        return { target: state.lastTarget, score: currentScore };
    }

    return best;
}

function rankTargets(ns, fleet) {
    const playerHack = ns.getHackingLevel();

    const servers = getRootedServers(ns)
        .filter(s => s !== "home")
        .filter(s => ns.getServerMaxMoney(s) > 0)
        .filter(s => ns.getServerRequiredHackingLevel(s) <= playerHack)
        .filter(s => {
            const maxMoney = ns.getServerMaxMoney(s);
            if (playerHack > 3000) return maxMoney >= 1e11;
            if (playerHack > 1000) return maxMoney >= 1e9;
            if (playerHack > 500) return maxMoney >= 1e8;
            return true;
        });

    if (!servers.length) return [{ target: "n00dles", score: 0 }];

    const ranked = [];
    for (const s of servers) {
        ranked.push({ target: s, score: scoreSingleTarget(ns, s, fleet) });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
}

function scoreSingleTarget(ns, server, fleet) {
    const maxMoney = ns.getServerMaxMoney(server);
    if (maxMoney <= 0) return 0;

    const playerHack = ns.getHackingLevel();
    if (playerHack > 3000 && maxMoney < 1e11) return 0;
    if (playerHack > 1000 && maxMoney < 1e9) return 0;

    const moneyAvail = ns.getServerMoneyAvailable(server);
    const moneyRatio = maxMoney > 0 ? moneyAvail / maxMoney : 0;

    const minSec = Math.max(1, ns.getServerMinSecurityLevel(server));
    const curSec = Math.max(minSec, ns.getServerSecurityLevel(server));
    const secPenalty = Math.max(1, curSec / minSec);

    const chance = Math.max(0.01, ns.hackAnalyzeChance(server));
    const weakenTime = Math.max(1, ns.getWeakenTime(server));

    const value = Math.pow(maxMoney, 0.92);
    const prepPenalty = (moneyRatio < 0.75 || (curSec - minSec) > 2) ? 0.6 : 1.0;

    return (value * chance * prepPenalty) / weakenTime / secPenalty;
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
            if (!id) continue;

            if (id.startsWith("prep-")) continue;

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
        `Tune: dynamic hpct:${(state.hackPct * 100).toFixed(2)} spacer:${state.spacer} maxB:${state.maxBatches}`,
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