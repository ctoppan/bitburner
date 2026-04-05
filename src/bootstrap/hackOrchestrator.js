/** @param {NS} ns **/
export async function main(ns) {
    const xpHackPct = Number(ns.args[0] ?? 0.03);
    const moneyHackPct = Number(ns.args[1] ?? 0.08);
    const homeReserveRam = Number(ns.args[2] ?? 1024);
    const xpSpacing = Number(ns.args[3] ?? 30);
    const moneySpacing = Number(ns.args[4] ?? 80);
    const switchHackLevel = Number(ns.args[5] ?? 2500);
    const pollMs = Number(ns.args[6] ?? 2000);

    const controller = "/hacking/batch/overlapBatchController.js";
    const spreadHack = "/hacking/spread-hack.js";
    const xpGrind = "/xp/xpGrind.js";
    const xpDistributor = "/xp/xpDistributor.js";

    ns.disableLog("ALL");
    ns.clearLog();

    killDuplicateOrchestrators(ns);

    let lastPurchasedCount = -1;

    while (true) {
        killDuplicateOrchestrators(ns);

        const hack = ns.getHackingLevel();
        const inXpPhase = hack < switchHackLevel;

        const desiredControllerArgs = inXpPhase
            ? [xpHackPct, -1, homeReserveRam, xpSpacing]
            : [moneyHackPct, moneySpacing, homeReserveRam, 25];

        const purchasedNow = ns.getPurchasedServers().length;
        const purchasedChanged = purchasedNow !== lastPurchasedCount;

        if (purchasedChanged) {
            ns.print(`[orchestrator] Detected pserv change: ${lastPurchasedCount} → ${purchasedNow}`);
            lastPurchasedCount = purchasedNow;
        }

        enforceController(ns, controller, desiredControllerArgs, purchasedChanged);

        if (inXpPhase) {
            startIfMissing(ns, spreadHack, []);
            startIfMissing(ns, xpGrind, []);
            startIfMissing(ns, xpDistributor, []);
        } else {
            stopAllByScript(ns, spreadHack);
            stopAllByScript(ns, xpGrind);
            stopAllByScript(ns, xpDistributor);
        }

        ns.clearLog();
        ns.print(`[orchestrator] phase=${inXpPhase ? "XP" : "MONEY"}`);
        ns.print(`[orchestrator] hack=${ns.formatNumber(hack, 3)} switch=${ns.formatNumber(switchHackLevel, 3)}`);
        ns.print(`[orchestrator] pservs=${purchasedNow}`);
        ns.print(`[orchestrator] controller args=${desiredControllerArgs.join(" ")}`);

        await ns.sleep(pollMs);
    }
}

function enforceController(ns, script, desiredArgs, forceRestart) {
    if (!ns.fileExists(script, "home")) return;

    let running = ns.ps("home").filter(p => p.filename === script);

    if (running.length > 1) {
        for (let i = 1; i < running.length; i++) {
            ns.kill(running[i].pid);
        }
    }

    running = ns.ps("home").filter(p => p.filename === script);

    if (running.length === 0) {
        ns.exec(script, "home", 1, ...desiredArgs);
        return;
    }

    const proc = running[0];

    if (forceRestart || !sameArgs(proc.args, desiredArgs)) {
        ns.kill(proc.pid);
        ns.exec(script, "home", 1, ...desiredArgs);
    }
}

function killDuplicateOrchestrators(ns) {
    const me = ns.pid;
    const self = ns.getScriptName();

    for (const proc of ns.ps("home")) {
        if (proc.filename === self && proc.pid !== me) {
            ns.kill(proc.pid);
        }
    }
}

function startIfMissing(ns, script, args) {
    if (!ns.fileExists(script, "home")) return;

    const running = ns.ps("home").filter(p => p.filename === script);
    if (running.length > 0) return;

    ns.exec(script, "home", 1, ...args);
}

function stopAllByScript(ns, script) {
    for (const proc of ns.ps("home")) {
        if (proc.filename === script) {
            ns.kill(proc.pid);
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