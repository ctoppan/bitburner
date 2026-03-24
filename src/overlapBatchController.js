/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");
    try { ns.ui.openTail(); } catch {}

    const [hackPctArg, spacerArg, homeReserveArg, maxBatchesArg] = ns.args;

    const state = {
        hackPct: Math.min(Math.max(Number(hackPctArg || 0.02), 0.01), 0.2),
        spacer: Math.min(Math.max(Number(spacerArg || 250), 25), 400),
        homeReserve: Number(homeReserveArg || 128),
        maxBatches: Math.min(Math.max(Number(maxBatchesArg || 64), 16), 512),
        maxJobs: 6000
    };

    while (true) {
        const servers = getServers(ns);
        const target = pickTarget(ns);

        const active = countBatches(ns, servers);

        if (active < state.maxBatches) {
            await launchBatch(ns, servers, target, state);
        }

        ns.clearLog();
        ns.print(`Target: ${target}`);
        ns.print(`Batches: ${active}/${state.maxBatches}`);

        await ns.sleep(1000);
    }
}

async function launchBatch(ns, servers, target, state) {
    const batchId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const weakenTime = ns.getWeakenTime(target);
    const growTime = ns.getGrowTime(target);
    const hackTime = ns.getHackTime(target);

    const spacer = state.spacer;

    const w1Delay = 0;
    const gDelay = weakenTime - growTime + spacer;
    const hDelay = weakenTime - hackTime + spacer * 2;
    const w2Delay = spacer * 3;

    const jobs = [
        { script: "batchWeaken.js", threads: 1, delay: w1Delay, tag: "W1" },
        { script: "batchGrow.js", threads: 2, delay: gDelay, tag: "G" },
        { script: "batchHack.js", threads: 1, delay: hDelay, tag: "H" },
        { script: "batchWeaken.js", threads: 1, delay: w2Delay, tag: "W2" }
    ];

    const launched = [];

    for (const job of jobs) {
        const ok = execDistributed(
            ns,
            servers,
            job.script,
            job.threads,
            [target, job.delay, `${batchId}-${job.tag}`],
            launched
        );

        if (!ok) {
            for (const entry of launched) {
                ns.kill(entry.pid, entry.host);
            }
            return false;
        }
    }

    return true;
}

function execDistributed(ns, servers, script, threads, args, launched) {
    let remaining = threads;

    for (const host of servers) {
        const ramPerThread = ns.getScriptRam(script, host);
        if (ramPerThread <= 0) continue;

        const free = getFreeRam(ns, host);
        const possible = Math.floor(free / ramPerThread);
        if (possible <= 0) continue;

        const use = Math.min(possible, remaining);
        const pid = ns.exec(script, host, use, ...args);

        if (pid !== 0) {
            launched.push({ pid, host });
            remaining -= use;
        }

        if (remaining <= 0) return true;
    }

    return false;
}

function countBatches(ns, servers) {
    const ids = new Set();

    for (const host of servers) {
        for (const proc of ns.ps(host)) {
            if (![
                "batchHack.js",
                "batchGrow.js",
                "batchWeaken.js"
            ].includes(proc.filename)) {
                continue;
            }

            if (!proc.args || proc.args.length < 3) continue;
            const id = proc.args[2];
            if (typeof id !== "string") continue;

            const baseId = id.split("-").slice(0, -1).join("-");
            if (baseId) ids.add(baseId);
        }
    }

    return ids.size;
}

function getServers(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];

    while (queue.length) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }

    return [...seen].filter(host => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0);
}

function getFreeRam(ns, host) {
    return Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host));
}

function pickTarget(ns) {
    const servers = getServers(ns)
        .filter(host => host !== "home")
        .filter(host => ns.getServerMaxMoney(host) > 0)
        .filter(host => ns.getServerRequiredHackingLevel(host) <= ns.getHackingLevel());

    if (servers.length === 0) return "n00dles";

    servers.sort((a, b) => scoreTarget(ns, b) - scoreTarget(ns, a));
    return servers[0];
}

function scoreTarget(ns, host) {
    const maxMoney = Math.max(1, ns.getServerMaxMoney(host));
    const chance = Math.max(0.01, ns.hackAnalyzeChance(host));
    const weakenTime = Math.max(1, ns.getWeakenTime(host));
    const moneyRatio = maxMoney > 0 ? ns.getServerMoneyAvailable(host) / maxMoney : 0;
    const secPenalty = Math.max(1, ns.getServerSecurityLevel(host) / Math.max(1, ns.getServerMinSecurityLevel(host)));

    return (maxMoney * chance * (0.5 + moneyRatio * 0.5)) / weakenTime / secPenalty;
}
