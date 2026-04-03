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

    ns.disableLog("sleep");
    ns.disableLog("exec");
    ns.disableLog("kill");
    ns.disableLog("scriptKill");
    ns.clearLog();

    killDuplicateOrchestrators(ns);

    while (true) {
        killDuplicateOrchestrators(ns);

        const hack = ns.getHackingLevel();
        const inXpPhase = hack < switchHackLevel;

        const desiredControllerArgs = inXpPhase
            ? [xpHackPct, -1, homeReserveRam, xpSpacing]
            : [moneyHackPct, moneySpacing, homeReserveRam, 25];

        enforceSingleInstance(ns, controller, desiredControllerArgs);

        if (inXpPhase) {
            startIfMissing(ns, spreadHack, []);
            startIfMissing(ns, xpGrind, []);
            startIfMissing(ns, xpDistributor, []);
        } else {
            stopAllByScript(ns, spreadHack);
            stopAllByScript(ns, xpGrind);
            stopAllByScript(ns, xpDistributor);
        }

        const controllerCount = ns.ps("home").filter(p => p.filename === controller).length;

        ns.clearLog();
        ns.print(`[orchestrator] phase=${inXpPhase ? "XP" : "MONEY"}`);
        ns.print(`[orchestrator] hack=${ns.formatNumber(hack, 3)} switch=${ns.formatNumber(switchHackLevel, 3)}`);
        ns.print(`[orchestrator] controller=${controller} ${desiredControllerArgs.join(" ")}`);
        ns.print(`[orchestrator] controllerCount=${controllerCount}`);

        await ns.sleep(pollMs);
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

function enforceSingleInstance(ns, script, desiredArgs) {
    if (!ns.fileExists(script, "home")) return;

    let running = ns.ps("home").filter(p => p.filename === script);

    if (running.length > 1) {
        for (let i = 1; i < running.length; i++) {
            ns.kill(running[i].pid);
        }
    }

    running = ns.ps("home").filter(p => p.filename === script);

    if (running.length === 0) {
        const pid = ns.exec(script, "home", 1, ...desiredArgs);
        if (pid === 0) {
            ns.print(`[orchestrator] FAILED to start ${script} ${desiredArgs.join(" ")}`);
        }
        return;
    }

    const proc = running[0];
    if (!sameArgs(proc.args, desiredArgs)) {
        ns.kill(proc.pid);
        const pid = ns.exec(script, "home", 1, ...desiredArgs);
        if (pid === 0) {
            ns.print(`[orchestrator] FAILED to restart ${script} ${desiredArgs.join(" ")}`);
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
    const running = ns.ps("home").filter(p => p.filename === script);
    for (const proc of running) {
        ns.kill(proc.pid);
    }
}

function sameArgs(actual, desired) {
    if (actual.length !== desired.length) return false;

    for (let i = 0; i < actual.length; i++) {
        if (String(actual[i]) !== String(desired[i])) return false;
    }

    return true;
}