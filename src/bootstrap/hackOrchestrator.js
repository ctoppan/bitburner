/** @param {NS} ns **/
export async function main(ns) {
    const xpHackPct = Number(ns.args[0] ?? 0.03);
    const moneyHackPct = Number(ns.args[1] ?? 0.08);
    const homeReserveRam = Number(ns.args[2] ?? 1024);
    const xpSpacing = Number(ns.args[3] ?? 30);
    const moneySpacing = Number(ns.args[4] ?? 80);
    const switchHackLevel = Number(ns.args[5] ?? 2500);
    const pollMs = Math.max(3000, Number(ns.args[6] ?? 5000));

    const controller = "/hacking/batch/overlapBatchController.js";
    const spreadHack = "/hacking/spread-hack.js";
    const xpGrind = "/xp/xpGrind.js";
    const xpDistributor = "/xp/xpDistributor.js";

    const CONTROLLER_RESTART_COOLDOWN_MS = 30000;
    const INFRA_LOG_COOLDOWN_MS = 10000;

    ns.disableLog("ALL");
    ns.clearLog();

    killDuplicateOrchestrators(ns);

    let lastControllerRestartAt = 0;
    let lastInfraLogAt = 0;

    let lastPurchasedCount = -1;
    let lastPurchasedRamTotal = -1;
    let lastPhase = "";
    let lastDesiredArgsKey = "";

    while (true) {
        try {
            killDuplicateOrchestrators(ns);

            const hack = ns.getHackingLevel();
            const inXpPhase = hack < switchHackLevel;

            const desiredControllerArgs = inXpPhase
                ? [xpHackPct, -1, homeReserveRam, xpSpacing]
                : [moneyHackPct, moneySpacing, homeReserveRam, 25];

            const desiredArgsKey = JSON.stringify(desiredControllerArgs);

            const purchasedServers = safeGetPurchasedServers(ns);
            const purchasedCount = purchasedServers.length;
            const purchasedRamTotal = getPurchasedRamTotal(ns, purchasedServers);

            const purchasedCountChanged = purchasedCount !== lastPurchasedCount;
            const purchasedRamChanged = purchasedRamTotal !== lastPurchasedRamTotal;
            const phaseChanged = lastPhase !== "" && lastPhase !== (inXpPhase ? "XP" : "MONEY");
            const argsChanged = lastDesiredArgsKey !== "" && lastDesiredArgsKey !== desiredArgsKey;

            const infraChanged = purchasedCountChanged || purchasedRamChanged;
            const now = Date.now();

            let forceControllerRestart = false;
            let restartReason = "";

            if (infraChanged) {
                if (now - lastInfraLogAt >= INFRA_LOG_COOLDOWN_MS) {
                    ns.print(
                        `[orchestrator] infra changed: pservs ${lastPurchasedCount} -> ${purchasedCount}, ` +
                        `pservRam ${formatRam(ns, lastPurchasedRamTotal)} -> ${formatRam(ns, purchasedRamTotal)}`
                    );
                    lastInfraLogAt = now;
                }

                if (now - lastControllerRestartAt >= CONTROLLER_RESTART_COOLDOWN_MS) {
                    forceControllerRestart = true;
                    restartReason = "infrastructure change";
                    lastControllerRestartAt = now;
                }
            }

            if (phaseChanged || argsChanged) {
                forceControllerRestart = true;
                restartReason = phaseChanged ? "phase change" : "arg change";
                lastControllerRestartAt = now;
            }

            enforceController(ns, controller, desiredControllerArgs, forceControllerRestart, restartReason);

            if (inXpPhase) {
                startIfMissing(ns, spreadHack, []);
                startIfMissing(ns, xpGrind, []);
                startIfMissing(ns, xpDistributor, []);
            } else {
                stopAllByScript(ns, spreadHack);
                stopAllByScript(ns, xpGrind);
                stopAllByScript(ns, xpDistributor);
            }

            lastPurchasedCount = purchasedCount;
            lastPurchasedRamTotal = purchasedRamTotal;
            lastPhase = inXpPhase ? "XP" : "MONEY";
            lastDesiredArgsKey = desiredArgsKey;

            const controllerProc = ns.ps("home").find(p => p.filename === controller);
            const controllerPid = controllerProc ? controllerProc.pid : 0;

            ns.clearLog();
            ns.print(`[orchestrator] phase=${lastPhase}`);
            ns.print(`[orchestrator] hack=${ns.formatNumber(hack, 3)} switch=${ns.formatNumber(switchHackLevel, 3)}`);
            ns.print(`[orchestrator] pservs=${purchasedCount} totalRam=${formatRam(ns, purchasedRamTotal)}`);
            ns.print(`[orchestrator] controller=${controller}`);
            ns.print(`[orchestrator] controllerPid=${controllerPid}`);
            ns.print(`[orchestrator] controllerArgs=${desiredControllerArgs.join(" ")}`);
            ns.print(`[orchestrator] restartCooldown=${Math.max(0, CONTROLLER_RESTART_COOLDOWN_MS - (Date.now() - lastControllerRestartAt))}ms`);
        } catch (err) {
            ns.print(`[orchestrator] ERROR: ${String(err)}`);
        }

        await ns.sleep(pollMs);
    }
}

function safeGetPurchasedServers(ns) {
    try {
        return ns.getPurchasedServers();
    } catch {
        return [];
    }
}

function getPurchasedRamTotal(ns, servers) {
    let total = 0;
    for (const host of servers) {
        try {
            total += ns.getServerMaxRam(host);
        } catch {}
    }
    return total;
}

function enforceController(ns, script, desiredArgs, forceRestart, restartReason = "") {
    if (!ns.fileExists(script, "home")) {
        ns.print(`[orchestrator] missing controller ${script}`);
        return;
    }

    let running = ns.ps("home").filter(p => p.filename === script);

    if (running.length > 1) {
        for (let i = 1; i < running.length; i++) {
            try {
                ns.kill(running[i].pid);
            } catch {}
        }
    }

    running = ns.ps("home").filter(p => p.filename === script);

    if (running.length === 0) {
        const pid = ns.exec(script, "home", 1, ...desiredArgs);
        if (pid === 0) {
            ns.print(`[orchestrator] FAILED to start ${script} ${desiredArgs.join(" ")}`);
        } else {
            ns.print(`[orchestrator] started controller pid=${pid}`);
        }
        return;
    }

    const proc = running[0];
    const argsMatch = sameArgs(proc.args, desiredArgs);

    if (forceRestart || !argsMatch) {
        try {
            ns.kill(proc.pid);
        } catch {}

        const pid = ns.exec(script, "home", 1, ...desiredArgs);
        if (pid === 0) {
            ns.print(
                `[orchestrator] FAILED to restart ${script} ${desiredArgs.join(" ")}`
            );
        } else {
            ns.print(
                `[orchestrator] restarted controller pid=${pid}` +
                (restartReason ? ` reason=${restartReason}` : (!argsMatch ? ` reason=args mismatch` : ""))
            );
        }
    }
}

function killDuplicateOrchestrators(ns) {
    const me = ns.pid;
    const self = ns.getScriptName();

    for (const proc of ns.ps("home")) {
        if (proc.filename === self && proc.pid !== me) {
            try {
                ns.kill(proc.pid);
            } catch {}
        }
    }
}

function startIfMissing(ns, script, args) {
    if (!ns.fileExists(script, "home")) return;

    const running = ns.ps("home").filter(p => p.filename === script);
    if (running.length > 0) return;

    const pid = ns.exec(script, "home", 1, ...args);
    if (pid === 0) {
        ns.print(`[orchestrator] FAILED to start ${script} ${args.join(" ")}`);
    }
}

function stopAllByScript(ns, script) {
    for (const proc of ns.ps("home")) {
        if (proc.filename === script) {
            try {
                ns.kill(proc.pid);
            } catch {}
        }
    }
}

function sameArgs(actual, desired) {
    if (actual.length !== desired.length) return false;

    for (let i = 0; i < actual.length; i++) {
        if (String(actual[i]) !== String(desired[i])) return false;
    }

    return true;
}

function formatRam(ns, value) {
    if (!Number.isFinite(value) || value < 0) return "n/a";
    try {
        return ns.formatRam(value);
    } catch {
        return `${value}GB`;
    }
}