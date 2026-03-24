/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("ALL");

    // Default mode if no saved setting exists:
    // "growth" | "balanced" | "save_for_augs"
    const DEFAULT_SPEND_MODE = "balanced";
    const DEFAULT_AUG_RESERVE = 75e9;

    const MODE_KEY = "bb_spend_mode_v1";
    const AUG_RESERVE_KEY = "bb_aug_reserve_v1";
    const TUNER_KEY = "bb_tuner_state_v1";
    const LOOP_MS = 5000;
    const HEARTBEAT_MS = 2 * 60 * 1000;
    const MONEY_BUCKET_SIZE = 10e9;

    const HOME_RAM_COST_FALLBACK = 316.788e9;
    const HOME_CORE_COST_FALLBACK = 421.875e9;

    let lastLog = {
        policy: null,
        target: null,
        affordRam: null,
        affordCore: null,
        moneyBucket: null,
        purchasedCount: null,
        lastPrint: 0,
        reserveBucket: null,
        budgetBucket: null,
        utilBucket: null,
    };

    ns.print(`Starting playerServers.js mode=${DEFAULT_SPEND_MODE}`);

    while (true) {
        try {
            const spendMode = readStoredJson(MODE_KEY) || DEFAULT_SPEND_MODE;
            const augReserve = readStoredNumber(AUG_RESERVE_KEY, DEFAULT_AUG_RESERVE);

            const money = ns.getServerMoneyAvailable("home");
            const ramCost = getHomeRamCost(ns, HOME_RAM_COST_FALLBACK);
            const coreCost = getHomeCoreCost(ns, HOME_CORE_COST_FALLBACK);
            const homeTarget = ramCost <= coreCost ? "ram" : "cores";

            const tuner = readStoredJson(TUNER_KEY);
            const controllerPolicy = tuner?.invest || "balanced";
            const ramFreeRatio = Number.isFinite(tuner?.ramFreeRatio) ? tuner.ramFreeRatio : null;
            const fleetUsedRatio = ramFreeRatio == null ? null : (1 - ramFreeRatio);
            const tuneNote = tuner?.tuneNote || "no-tuner";
            const controllerHackPct = Number.isFinite(tuner?.hackPct) ? tuner.hackPct : null;
            const controllerSpacer = Number.isFinite(tuner?.spacer) ? tuner.spacer : null;

            const policy = resolveSpendPolicy(spendMode, controllerPolicy, fleetUsedRatio);

            const reserve = computeReserve({
                policy,
                money,
                ramCost,
                coreCost,
                augReserve,
            });

            const budget = Math.max(0, money - reserve);

            const purchasedServers = ns.getPurchasedServers();
            const purchasedCount = purchasedServers.length;
            const currentMinPurchasedRam = getMinPurchasedRam(ns, purchasedServers);

            const targetPurchasedRam = decideTargetPurchasedRam({
                ns,
                policy,
                budget,
                money,
                ramFreeRatio,
                fleetUsedRatio,
                currentMinPurchasedRam,
            });

            let boughtOrUpgraded = false;
            if (targetPurchasedRam > 0 && budget > 0) {
                boughtOrUpgraded = tryBuyOrUpgradeServer(ns, {
                    targetRam: targetPurchasedRam,
                    availableBudget: budget,
                });
            }

            const affordRam = money >= ramCost;
            const affordCore = money >= coreCost;

            maybeLog(ns, {
                now: Date.now(),
                heartbeatMs: HEARTBEAT_MS,
                money,
                reserve,
                budget,
                ramCost,
                coreCost,
                homeTarget,
                policy,
                controllerPolicy,
                spendMode,
                tuneNote,
                affordRam,
                affordCore,
                purchasedCount,
                controllerHackPct,
                controllerSpacer,
                lastLog,
                moneyBucketSize: MONEY_BUCKET_SIZE,
                boughtOrUpgraded,
                ramFreeRatio,
                fleetUsedRatio,
                targetPurchasedRam,
            });
        } catch (err) {
            ns.print(`ERROR: ${String(err)}`);
        }

        await ns.sleep(LOOP_MS);
    }
}

function resolveSpendPolicy(spendMode, controllerPolicy, fleetUsedRatio) {
    if (spendMode === "growth") {
        if (fleetUsedRatio != null) {
            if (fleetUsedRatio < 0.20) return "turbo_buy_servers";
            if (fleetUsedRatio < 0.60) return "buy_servers";
            return "balanced";
        }
        return "buy_servers";
    }

    if (spendMode === "save_for_augs") {
        return "save_for_augs";
    }

    if (fleetUsedRatio != null) {
        if (fleetUsedRatio < 0.20) return "buy_servers";
        if (fleetUsedRatio < 0.50) return "balanced";
        return "save_home";
    }

    return controllerPolicy || "balanced";
}

function maybeLog(ns, ctx) {
    const {
        now,
        heartbeatMs,
        money,
        reserve,
        budget,
        ramCost,
        coreCost,
        homeTarget,
        policy,
        controllerPolicy,
        spendMode,
        tuneNote,
        affordRam,
        affordCore,
        purchasedCount,
        controllerHackPct,
        controllerSpacer,
        lastLog,
        moneyBucketSize,
        boughtOrUpgraded,
        ramFreeRatio,
        fleetUsedRatio,
        targetPurchasedRam,
    } = ctx;

    const moneyBucket = Math.floor(money / moneyBucketSize);
    const reserveBucket = Math.floor(reserve / moneyBucketSize);
    const budgetBucket = Math.floor(budget / moneyBucketSize);
    const utilBucket = fleetUsedRatio == null ? -1 : Math.floor(fleetUsedRatio * 20);

    const shouldLog =
        boughtOrUpgraded ||
        policy !== lastLog.policy ||
        homeTarget !== lastLog.target ||
        affordRam !== lastLog.affordRam ||
        affordCore !== lastLog.affordCore ||
        purchasedCount !== lastLog.purchasedCount ||
        moneyBucket !== lastLog.moneyBucket ||
        reserveBucket !== lastLog.reserveBucket ||
        budgetBucket !== lastLog.budgetBucket ||
        utilBucket !== lastLog.utilBucket ||
        now - lastLog.lastPrint >= heartbeatMs;

    if (!shouldLog) return;

    const ramFreeText = ramFreeRatio == null ? "n/a" : `${(ramFreeRatio * 100).toFixed(0)}%`;
    const fleetUsedText = fleetUsedRatio == null ? "n/a" : `${(fleetUsedRatio * 100).toFixed(0)}%`;
    const hackPctText = controllerHackPct == null ? "n/a" : `${(controllerHackPct * 100).toFixed(2)}%`;
    const spacerText = controllerSpacer == null ? "n/a" : `${controllerSpacer}`;

    ns.print(
        `mode=${spendMode}, home target=${homeTarget}, ` +
        `ramCost=${fmtMoney(ns, ramCost)}, coreCost=${fmtMoney(ns, coreCost)}, ` +
        `reserve=${fmtMoney(ns, reserve)}, budget=${fmtMoney(ns, budget)}, money=${fmtMoney(ns, money)}, ` +
        `policy=${policy}, controller=${controllerPolicy}, used=${fleetUsedText}, freeRam=${ramFreeText}, ` +
        `hpct=${hackPctText}, spacer=${spacerText}, ` +
        `pservTarget=${targetPurchasedRam > 0 ? ns.formatRam(targetPurchasedRam) : "none"} ` +
        `(${tuneNote})`
    );

    lastLog.policy = policy;
    lastLog.target = homeTarget;
    lastLog.affordRam = affordRam;
    lastLog.affordCore = affordCore;
    lastLog.moneyBucket = moneyBucket;
    lastLog.reserveBucket = reserveBucket;
    lastLog.budgetBucket = budgetBucket;
    lastLog.purchasedCount = purchasedCount;
    lastLog.lastPrint = now;
    lastLog.utilBucket = utilBucket;
}

function getHomeRamCost(ns, fallback) {
    try {
        if (ns.singularity?.getUpgradeHomeRamCost) {
            const cost = ns.singularity.getUpgradeHomeRamCost();
            if (Number.isFinite(cost) && cost > 0) return cost;
        }
    } catch {}
    return fallback;
}

function getHomeCoreCost(ns, fallback) {
    try {
        if (ns.singularity?.getUpgradeHomeCoresCost) {
            const cost = ns.singularity.getUpgradeHomeCoresCost();
            if (Number.isFinite(cost) && cost > 0) return cost;
        }
    } catch {}
    return fallback;
}

function readStoredJson(key) {
    try {
        if (typeof localStorage === "undefined") return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function readStoredNumber(key, fallback) {
    const value = readStoredJson(key);
    return Number.isFinite(value) ? value : fallback;
}

function computeReserve({ policy, money, ramCost, coreCost, augReserve }) {
    const cheaperHomeUpgrade = Math.min(ramCost, coreCost);

    if (policy === "turbo_buy_servers") {
        return Math.max(2e9, Math.min(cheaperHomeUpgrade * 0.05, money * 0.03));
    }

    if (policy === "buy_servers") {
        return Math.max(5e9, Math.min(cheaperHomeUpgrade * 0.20, money * 0.10));
    }

    if (policy === "balanced") {
        return Math.max(7.5e9, Math.min(cheaperHomeUpgrade * 0.50, money * 0.40));
    }

    if (policy === "save_home") {
        return Math.max(10e9, Math.min(cheaperHomeUpgrade * 1.00, money * 0.85));
    }

    if (policy === "save_for_augs") {
        return Math.max(augReserve, Math.min(cheaperHomeUpgrade * 0.50, money * 0.95));
    }

    return Math.max(7.5e9, Math.min(cheaperHomeUpgrade * 0.50, money * 0.40));
}

function decideTargetPurchasedRam({ ns, policy, budget, money, ramFreeRatio, fleetUsedRatio, currentMinPurchasedRam }) {
    const maxPurchasedRam = ns.getPurchasedServerMaxRam();
    const purchasedLimit = ns.getPurchasedServerLimit();
    const purchasedCount = ns.getPurchasedServers().length;
    const base = Math.max(8, currentMinPurchasedRam || 8);

    let spendRatio;
    if (policy === "turbo_buy_servers") spendRatio = 0.90;
    else if (policy === "buy_servers") spendRatio = 0.70;
    else if (policy === "balanced") spendRatio = 0.40;
    else if (policy === "save_home") spendRatio = 0.15;
    else if (policy === "save_for_augs") spendRatio = 0.05;
    else spendRatio = 0.25;

    if (ramFreeRatio != null && ramFreeRatio > 0.80 && policy !== "save_for_augs") spendRatio *= 1.15;
    if (fleetUsedRatio != null && fleetUsedRatio < 0.20 && policy === "turbo_buy_servers") spendRatio *= 1.20;

    const spendCap = Math.max(0, Math.min(budget, money * spendRatio));
    if (spendCap <= 0) return 0;

    let target = base;
    while (target < maxPurchasedRam) {
        const next = target * 2;
        const nextCost = ns.getPurchasedServerCost(next);
        if (!Number.isFinite(nextCost) || nextCost <= 0 || nextCost > spendCap) break;
        target = next;
    }

    if (purchasedCount < purchasedLimit) {
        const freshCost = ns.getPurchasedServerCost(target);
        if (Number.isFinite(freshCost) && freshCost > 0 && freshCost <= spendCap) {
            return target;
        }
    }

    const purchased = ns.getPurchasedServers()
        .map(s => ({ host: s, ram: ns.getServerMaxRam(s) }))
        .sort((a, b) => a.ram - b.ram);

    for (const server of purchased) {
        let candidate = Math.max(server.ram * 2, 8);
        while (candidate <= maxPurchasedRam) {
            const upgradeCost = ns.getPurchasedServerUpgradeCost(server.host, candidate);
            if (Number.isFinite(upgradeCost) && upgradeCost > 0 && upgradeCost <= spendCap) {
                return candidate;
            }
            candidate *= 2;
        }
    }

    return 0;
}

function tryBuyOrUpgradeServer(ns, { targetRam, availableBudget }) {
    if (!Number.isFinite(targetRam) || targetRam <= 0) return false;

    const purchased = ns.getPurchasedServers()
        .map(s => ({ host: s, ram: ns.getServerMaxRam(s) }))
        .sort((a, b) => a.ram - b.ram);

    const limit = ns.getPurchasedServerLimit();

    if (purchased.length < limit) {
        const cost = ns.getPurchasedServerCost(targetRam);
        if (Number.isFinite(cost) && cost > 0 && cost <= availableBudget) {
            const host = `pserv-${targetRam}-${Date.now()}`;
            const result = ns.purchaseServer(host, targetRam);
            if (result) {
                ns.print(`Purchased ${result} with ${ns.formatRam(targetRam)}`);
                return true;
            }
        }
    }

    for (const server of purchased) {
        if (server.ram >= targetRam) continue;
        const upgradeCost = ns.getPurchasedServerUpgradeCost(server.host, targetRam);
        if (!Number.isFinite(upgradeCost) || upgradeCost <= 0 || upgradeCost > availableBudget) continue;

        const ok = ns.upgradePurchasedServer(server.host, targetRam);
        if (ok) {
            ns.print(`Upgraded ${server.host} to ${ns.formatRam(targetRam)}`);
            return true;
        }
    }

    return false;
}

function getMinPurchasedRam(ns, purchasedServers) {
    if (!purchasedServers.length) return 0;
    return Math.min(...purchasedServers.map(s => ns.getServerMaxRam(s)));
}

function fmtMoney(ns, value) {
    return ns.formatNumber(value);
}
