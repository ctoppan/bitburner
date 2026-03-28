/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    const now = () => new Date().toLocaleTimeString();

    const overlapArgs = [0.03, -1, 1024, 30];
    const overlapScript = "/hacking/batch/overlapBatchController.js";
    const killAllScript = "/hacking/main/killAll.js";
    const playerServersScript = "/hacking/main/playerServers.js";
    const stockTraderScript = "/stockmarket/stockTrader.js";

    ns.tprint(`[${now()}] Starting initHacking.js`);
    ns.tprint(`[${now()}] Repo sync already completed by start-download-only.js`);
    ns.tprint(`[${now()}] Starting killAll.js -> ${overlapScript} ${overlapArgs.join(" ")}`);

    if (ns.fileExists(killAllScript, "home")) {
        ns.spawn(killAllScript, 1, overlapScript, ...overlapArgs);
        return;
    }

    ns.tprint(`[${now()}] WARNING: ${killAllScript} not found, starting overlap controller directly`);
    if (ns.fileExists(overlapScript, "home")) {
        ns.run(overlapScript, 1, ...overlapArgs);
    } else {
        ns.tprint(`[${now()}] ERROR: ${overlapScript} not found`);
    }

    await ns.sleep(5000);

    if (ns.fileExists(playerServersScript, "home") && !ns.isRunning(playerServersScript, "home")) {
        ns.tprint(`[${now()}] Starting playerServers.js`);
        ns.run(playerServersScript, 1);
    }

    if (hasStockApi(ns)) {
        ns.tprint(`[${now()}] Stock API detected, but stockTrader.js auto-start is disabled for now`);
        // Enable later if wanted:
        // if (ns.fileExists(stockTraderScript, "home") && !ns.isRunning(stockTraderScript, "home")) {
        //     ns.run(stockTraderScript, 1);
        // }
    } else {
        ns.tprint(`[${now()}] Stock API not detected`);
    }
}

function hasStockApi(ns) {
    try {
        return typeof ns.stock?.hasTIXAPIAccess === "function" && ns.stock.hasTIXAPIAccess();
    } catch {
        return false;
    }
}