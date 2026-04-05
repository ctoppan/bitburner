/** @param {NS} ns **/
export async function main(ns) {
    ns.tprint(`[${ts()}] Starting initHacking.js`);

    const killAllScript = "/hacking/main/killAll.js";
    const xpDistributor = "/xp/xpDistributor.js";
    const gangManager = "/gang/gangManager_v2.js";

    if (!ns.fileExists(killAllScript, "home")) {
        ns.tprint(`[${ts()}] ERROR: Missing ${killAllScript}`);
        return;
    }

    if (!ns.fileExists(xpDistributor, "home")) {
        ns.tprint(`[${ts()}] ERROR: Missing ${xpDistributor}`);
        return;
    }

    ns.tprint(`[${ts()}] Running cleanup with ${killAllScript}`);
    const killPid = ns.run(killAllScript, 1, ns.pid);
    if (killPid === 0) {
        ns.tprint(`[${ts()}] ERROR: Failed to start ${killAllScript}`);
        return;
    }

    await ns.sleep(1000);

    ns.tprint(`[${ts()}] Starting ${xpDistributor} n00dles 512 true`);
    const xpPid = ns.run(xpDistributor, 1, "n00dles", 512, true);
    if (xpPid === 0) {
        ns.tprint(`[${ts()}] ERROR: Failed to start ${xpDistributor}`);
    }

    if (ns.fileExists(gangManager, "home")) {
        await ns.sleep(250);
        ns.tprint(`[${ts()}] Starting ${gangManager} 150e9 money rep`);
        const gangPid = ns.run(gangManager, 1, 150e9, "money", "rep");
        if (gangPid === 0) {
            ns.tprint(`[${ts()}] WARNING: Failed to start ${gangManager}`);
        }
    } else {
        ns.tprint(`[${ts()}] Skipping gang manager, file missing`);
    }
}

function ts() {
    return new Date().toLocaleTimeString();
}