/** @param {NS} ns **/
export async function main(ns) {
    const reserve = Number(ns.args[0] ?? 100_000_000);
    const mode = String(ns.args[1] ?? "money").toLowerCase();
    const focus = String(ns.args[2] ?? "normal").toLowerCase(); // normal | rep

    const earlyGear = [
        "Baseball Bat",
        "Bulletproof Vest",
        "Ford Flex V20",
    ];

    const midGear = [
        "Katana",
        "Glock 18C",
        "P90C",
    ];

    const lateGear = [
        "Steyr AUG",
        "AK-47",
        "M15A10 Assault Rifle",
        "AWM Sniper Rifle",
    ];

    const moneyTasks = [
        "Human Trafficking",
        "Traffick Illegal Arms",
        "Armed Robbery",
        "Strongarm Civilians",
        "Deal Drugs",
        "Run a Con",
        "Mug People",
    ];

    const respectTasks = [
        "Terrorism",
        "Human Trafficking",
        "Traffick Illegal Arms",
        "Armed Robbery",
        "Strongarm Civilians",
    ];

    while (true) {
        if (!ns.gang.inGang()) return;

        while (ns.gang.canRecruitMember()) {
            const name = makeMemberName(ns);
            ns.gang.recruitMember(name);
        }

        const members = ns.gang.getMemberNames();
        const gangInfo = ns.gang.getGangInformation();
        const homeMoney = ns.getServerMoneyAvailable("home");

        const settings = getModeSettings(mode, focus, members.length, gangInfo.respect);

        // Hard budget rules:
        // 1. Never spend below reserve
        // 2. Only spend up to a slice of the surplus each cycle
        const surplus = Math.max(0, homeMoney - reserve);
        const cycleBudget = Math.min(surplus, Math.max(0, surplus * settings.maxSpendRatioPerCycle));

        let remainingBudget = cycleBudget;

        if (homeMoney > reserve) {
            remainingBudget = buyGearTierBudgeted(ns, members, earlyGear, reserve, remainingBudget);
        }
        if (homeMoney > reserve * settings.midGearThreshold) {
            remainingBudget = buyGearTierBudgeted(ns, members, midGear, reserve, remainingBudget);
        }
        if (homeMoney > reserve * settings.lateGearThreshold) {
            remainingBudget = buyGearTierBudgeted(ns, members, lateGear, reserve, remainingBudget);
        }

        let vigilantesNeeded = 0;
        if (gangInfo.wantedPenalty < settings.penalty1) vigilantesNeeded = 1;
        if (gangInfo.wantedPenalty < settings.penalty2) vigilantesNeeded = 2;
        if (gangInfo.wantedPenalty < settings.penalty3) vigilantesNeeded = 3;

        const memberInfos = members
            .map(name => ({
                name,
                info: ns.gang.getMemberInformation(name),
            }))
            .sort((a, b) => combatScore(a.info) - combatScore(b.info));

        const trainees = new Set();

        for (const m of memberInfos) {
            if (
                m.info.str < settings.trainStat ||
                m.info.def < settings.trainStat ||
                m.info.dex < settings.trainStat ||
                m.info.agi < settings.trainStat
            ) {
                ns.gang.setMemberTask(m.name, "Train Combat");
                trainees.add(m.name);
            }
        }

        const assignable = memberInfos.filter(m => !trainees.has(m.name));

        for (let i = 0; i < vigilantesNeeded && i < assignable.length; i++) {
            ns.gang.setMemberTask(assignable[i].name, "Vigilante Justice");
        }

        const workers = assignable.slice(vigilantesNeeded);

        const respectMode =
            focus === "rep" ||
            members.length < settings.forceRespectMemberCount ||
            gangInfo.respect < settings.respectTarget;

        for (let i = 0; i < workers.length; i++) {
            const { name, info } = workers[i];

            let useRespectTask;
            if (respectMode) {
                useRespectTask = true;
            } else {
                useRespectTask = i >= Math.floor(workers.length * settings.moneyWorkerShare);
            }

            let task = pickBestTaskByStats(
                ns,
                info,
                useRespectTask ? respectTasks : moneyTasks,
                {
                    favorRespect: useRespectTask,
                    moneyWeight: settings.moneyWeight,
                    respectWeight: settings.respectWeight,
                    wantedWeight: settings.wantedWeight,
                    weakPenalty: settings.weakPenalty,
                }
            );

            // Anti-stall fallback for weak early members
            if (combatScore(info) < settings.weakFallbackScore) {
                task = respectMode ? "Strongarm Civilians" : "Mug People";
            }

            ns.gang.setMemberTask(name, task);

            const asc = ns.gang.getAscensionResult(name);
            if (
                asc &&
                (
                    asc.str > settings.ascThreshold ||
                    asc.def > settings.ascThreshold ||
                    asc.dex > settings.ascThreshold ||
                    asc.agi > settings.ascThreshold
                )
            ) {
                ns.gang.ascendMember(name);
            }
        }

        await ns.gang.nextUpdate();
    }
}

function getModeSettings(mode, focus, memberCount, respect) {
    let base;

    switch (mode) {
        case "safe":
            base = {
                trainStat: 175,
                respectTarget: 1_500_000,
                forceRespectMemberCount: 10,
                moneyWorkerShare: 0.60,
                moneyWeight: 0.75,
                respectWeight: 0.90,
                wantedWeight: 3.25,
                weakPenalty: 0.75,
                ascThreshold: 1.12,
                penalty1: 0.97,
                penalty2: 0.93,
                penalty3: 0.89,
                weakFallbackScore: 220,
                maxSpendRatioPerCycle: 0.20,
                midGearThreshold: 1.75,
                lateGearThreshold: 3.00,
            };
            break;

        case "balanced":
            base = {
                trainStat: 125,
                respectTarget: 750_000,
                forceRespectMemberCount: 10,
                moneyWorkerShare: 0.78,
                moneyWeight: 1.00,
                respectWeight: 0.40,
                wantedWeight: 1.40,
                weakPenalty: 0.88,
                ascThreshold: 1.15,
                penalty1: 0.95,
                penalty2: 0.90,
                penalty3: 0.85,
                weakFallbackScore: 220,
                maxSpendRatioPerCycle: 0.25,
                midGearThreshold: 1.75,
                lateGearThreshold: 3.00,
            };
            break;

        case "money":
        default:
            base = {
                trainStat: 90,
                respectTarget: 350_000,
                forceRespectMemberCount: 10,
                moneyWorkerShare: 0.90,
                moneyWeight: 1.30,
                respectWeight: 0.18,
                wantedWeight: 0.95,
                weakPenalty: 0.97,
                ascThreshold: 1.14,
                penalty1: 0.90,
                penalty2: 0.86,
                penalty3: 0.82,
                weakFallbackScore: 220,
                maxSpendRatioPerCycle: 0.30,
                midGearThreshold: 1.75,
                lateGearThreshold: 3.00,
            };
            break;
    }

    if (focus === "rep") {
        return {
            ...base,
            trainStat: Math.min(base.trainStat, 75),
            respectTarget: Math.max(base.respectTarget, 5_000_000),
            forceRespectMemberCount: 12,
            moneyWorkerShare: 0.55,
            moneyWeight: Math.max(0.70, base.moneyWeight * 0.75),
            respectWeight: Math.max(1.10, base.respectWeight * 3.5),
            wantedWeight: Math.max(1.60, base.wantedWeight),
            weakPenalty: Math.min(base.weakPenalty, 0.90),
            ascThreshold: Math.min(base.ascThreshold, 1.12),
            penalty1: Math.max(base.penalty1, 0.94),
            penalty2: Math.max(base.penalty2, 0.90),
            penalty3: Math.max(base.penalty3, 0.86),
            weakFallbackScore: 260,
            maxSpendRatioPerCycle: Math.max(base.maxSpendRatioPerCycle, 0.35),
            midGearThreshold: 1.25,
            lateGearThreshold: 1.90,
        };
    }

    return base;
}

function combatScore(info) {
    return info.str + info.def + info.dex + info.agi;
}

function makeMemberName(ns) {
    const base = "G";
    let tries = 0;
    const existing = new Set(ns.gang.getMemberNames());

    while (tries < 50) {
        const name = base + Math.floor(Math.random() * 100000);
        if (!existing.has(name)) return name;
        tries++;
    }

    return base + Date.now();
}

function buyGearTierBudgeted(ns, members, gearList, reserve, budget) {
    let remaining = budget;

    for (const m of members) {
        const info = ns.gang.getMemberInformation(m);

        for (const item of gearList) {
            if (info.upgrades.includes(item) || info.augmentations.includes(item)) continue;

            const cost = ns.gang.getEquipmentCost(item);
            const cash = ns.getServerMoneyAvailable("home");
            const maxAllowedSpend = Math.max(0, cash - reserve);

            if (cost <= remaining && cost <= maxAllowedSpend) {
                const ok = ns.gang.purchaseEquipment(m, item);
                if (ok) {
                    remaining -= cost;
                }
            }
        }
    }

    return remaining;
}

function pickBestTaskByStats(ns, memberInfo, taskList, cfg) {
    let bestTask = taskList[0];
    let bestScore = -Infinity;

    for (const task of taskList) {
        const t = ns.gang.getTaskStats(task);

        const statPower =
            (t.strWeight * memberInfo.str) +
            (t.defWeight * memberInfo.def) +
            (t.dexWeight * memberInfo.dex) +
            (t.agiWeight * memberInfo.agi) +
            (t.chaWeight * memberInfo.cha) +
            (t.hackWeight * memberInfo.hack);

        let score =
            statPower +
            (t.baseMoney * (cfg.favorRespect ? 0.25 : cfg.moneyWeight)) +
            (t.baseRespect * (cfg.favorRespect ? 1.20 : cfg.respectWeight)) -
            (t.baseWanted * cfg.wantedWeight);

        const weak = memberInfo.str < 300 || memberInfo.def < 300;
        if (weak && (task === "Human Trafficking" || task === "Terrorism")) {
            score *= cfg.weakPenalty;
        }

        if (score > bestScore) {
            bestScore = score;
            bestTask = task;
        }
    }

    return bestTask;
}