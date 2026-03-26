/** @param {NS} ns **/
export async function main(ns) {
    const reserve = ns.args[0] ?? 500_000_000;

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

        // Buy gear in tiers
        if (homeMoney > reserve) buyGearTier(ns, members, earlyGear);
        if (homeMoney > reserve * 2) buyGearTier(ns, members, midGear);
        if (homeMoney > reserve * 4) buyGearTier(ns, members, lateGear);

        // Count how many members should reduce wanted
        let vigilantesNeeded = 0;
        if (gangInfo.wantedPenalty < 0.95) vigilantesNeeded = 1;
        if (gangInfo.wantedPenalty < 0.90) vigilantesNeeded = 2;
        if (gangInfo.wantedPenalty < 0.85) vigilantesNeeded = 3;

        // Sort weakest to strongest by combat power
        const memberInfos = members.map(name => ({
            name,
            info: ns.gang.getMemberInformation(name),
        })).sort((a, b) => combatScore(a.info) - combatScore(b.info));

        // Put weakest members in training first
        for (const m of memberInfos) {
            if (m.info.str < 150 || m.info.def < 150 || m.info.dex < 150 || m.info.agi < 150) {
                ns.gang.setMemberTask(m.name, "Train Combat");
            }
        }

        // Assign vigilantes to the weakest non-training members
        const assignable = memberInfos.filter(m =>
            !(m.info.str < 150 || m.info.def < 150 || m.info.dex < 150 || m.info.agi < 150)
        );

        for (let i = 0; i < vigilantesNeeded && i < assignable.length; i++) {
            ns.gang.setMemberTask(assignable[i].name, "Vigilante Justice");
        }

        // Remaining members: split between respect and money
        const workers = assignable.slice(vigilantesNeeded);

        const respectMode =
            members.length < 12 ||
            gangInfo.respect < 5e5;

        for (let i = 0; i < workers.length; i++) {
            const { name, info } = workers[i];

            let task;
            if (respectMode) {
                // Early growth: lean toward respect
                task = pickBestTaskByStats(ns, info, respectTasks, true);
            } else {
                // Established gang: mostly money, some respect
                // Roughly 1 in 3 strongest workers stays on respect-oriented jobs
                const useRespectTask = (i >= Math.floor(workers.length * 0.67));
                task = pickBestTaskByStats(
                    ns,
                    info,
                    useRespectTask ? respectTasks : moneyTasks,
                    useRespectTask
                );
            }

            ns.gang.setMemberTask(name, task);

            // Light ascension
            const asc = ns.gang.getAscensionResult(name);
            if (asc && (asc.str > 1.15 || asc.def > 1.15 || asc.dex > 1.15 || asc.agi > 1.15)) {
                ns.gang.ascendMember(name);
            }
        }

        await ns.gang.nextUpdate();
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

function pickBestTaskByStats(ns, memberInfo, taskList, favorRespect) {
    let bestTask = taskList[0];
    let bestScore = -Infinity;

    for (const task of taskList) {
        const t = ns.gang.getTaskStats(task);

        // Weighted by the member's actual combat stats
        const statPower =
            (t.strWeight * memberInfo.str) +
            (t.defWeight * memberInfo.def) +
            (t.dexWeight * memberInfo.dex) +
            (t.agiWeight * memberInfo.agi) +
            (t.chaWeight * memberInfo.cha) +
            (t.hackWeight * memberInfo.hack);

        // Crude fallback score without formulas
        let score =
            statPower +
            (t.baseMoney * (favorRespect ? 0.35 : 1.00)) +
            (t.baseRespect * (favorRespect ? 1.00 : 0.45)) -
            (t.baseWanted * 3.0);

        // Slight bonus to safer mid-tier tasks if member is still weak
        const weak = memberInfo.str < 400 || memberInfo.def < 400;
        if (weak && (task === "Human Trafficking" || task === "Terrorism")) {
            score *= 0.85;
        }

        if (score > bestScore) {
            bestScore = score;
            bestTask = task;
        }
    }

    return bestTask;
}