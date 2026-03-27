/** @param {NS} ns **/
export async function main(ns) {
    const reserve = ns.args[0] ?? 500_000_000;
    const mode = String(ns.args[1] ?? "balanced").toLowerCase();

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
            const name = "G" + Math.floor(Math.random() * 10000);
            ns.gang.recruitMember(name);
        }

        const members = ns.gang.getMemberNames();
        const gangInfo = ns.gang.getGangInformation();
        const homeMoney = ns.getServerMoneyAvailable("home");

        if (homeMoney > reserve) buyGearTier(ns, members, earlyGear);
        if (homeMoney > reserve * 2) buyGearTier(ns, members, midGear);
        if (homeMoney > reserve * 4) buyGearTier(ns, members, lateGear);

        const settings = getModeSettings(mode, members.length, gangInfo.respect);

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
        const respectMode = members.length < 12 || gangInfo.respect < settings.respectTarget;

        for (let i = 0; i < workers.length; i++) {
            const { name, info } = workers[i];

            let useRespectTask;
            if (respectMode) {
                useRespectTask = true;
            } else {
                useRespectTask = i >= Math.floor(workers.length * settings.moneyWorkerShare);
            }

            const task = pickBestTaskByStats(
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

function getModeSettings(mode, memberCount, respect) {
    switch (mode) {
        case "safe":
            return {
                trainStat: 200,
                respectTarget: 2_000_000,
                moneyWorkerShare: 0.60,
                moneyWeight: 0.75,
                respectWeight: 0.90,
                wantedWeight: 3.25,
                weakPenalty: 0.75,
                ascThreshold: 1.12,
                penalty1: 0.97,
                penalty2: 0.93,
                penalty3: 0.89,
            };

        case "money":
            return {
                trainStat: 125,
                respectTarget: 750_000,
                moneyWorkerShare: 0.85,
                moneyWeight: 1.20,
                respectWeight: 0.25,
                wantedWeight: 1.10,
                weakPenalty: 0.90,
                ascThreshold: 1.18,
                penalty1: 0.92,
                penalty2: 0.88,
                penalty3: 0.84,
            };

        case "balanced":
        default:
            return {
                trainStat: 150,
                respectTarget: 1_000_000,
                moneyWorkerShare: 0.75,
                moneyWeight: 1.00,
                respectWeight: 0.45,
                wantedWeight: 1.50,
                weakPenalty: 0.85,
                ascThreshold: 1.15,
                penalty1: 0.95,
                penalty2: 0.90,
                penalty3: 0.85,
            };
    }
}

function combatScore(info) {
    return info.str + info.def + info.dex + info.agi;
}

function buyGearTier(ns, members, gearList) {
    for (const m of members) {
        const info = ns.gang.getMemberInformation(m);
        for (const item of gearList) {
            if (!info.upgrades.includes(item) && !info.augmentations.includes(item)) {
                ns.gang.purchaseEquipment(m, item);
            }
        }
    }
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
            (t.baseMoney * (cfg.favorRespect ? 0.35 : cfg.moneyWeight)) +
            (t.baseRespect * (cfg.favorRespect ? 1.00 : cfg.respectWeight)) -
            (t.baseWanted * cfg.wantedWeight);

        const weak = memberInfo.str < 400 || memberInfo.def < 400;
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