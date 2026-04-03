/** @param {NS} ns **/
export async function main(ns) {
    ns.tprint(`[${ts()}] Starting initHacking.js`);

    const repoStarter = "/bootstrap/start-download-only.js";
    if (ns.fileExists(repoStarter, "home")) {
        ns.tprint(`[${ts()}] Repo sync already completed by start-download-only.js`);
    }

    const killAllScript = "/hacking/main/killAll.js";
    const orchestrator = "/bootstrap/hackOrchestrator.js";

    if (!ns.fileExists(killAllScript, "home")) {
        ns.tprint(`[${ts()}] ERROR: Missing ${killAllScript}`);
        return;
    }

    if (!ns.fileExists(orchestrator, "home")) {
        ns.tprint(`[${ts()}] ERROR: Missing ${orchestrator}`);
        return;
    }

    const orchestratorArgs = [0.03, 0.08, 1024, 30, 80, 2500, 15000];

    ns.tprint(`[${ts()}] Running cleanup with ${killAllScript}`);
    const killPid = ns.run(killAllScript, 1, ns.pid);
    if (killPid === 0) {
        ns.tprint(`[${ts()}] ERROR: Failed to start ${killAllScript}`);
        return;
    }

    await ns.sleep(750);

    ns.tprint(
        `[${ts()}] Starting ${orchestrator} ${orchestratorArgs.join(" ")}`
    );

    const orchPid = ns.run(orchestrator, 1, ...orchestratorArgs);
    if (orchPid === 0) {
        ns.tprint(`[${ts()}] ERROR: Failed to start ${orchestrator}`);
    }
}

function ts() {
    return new Date().toLocaleTimeString();
}