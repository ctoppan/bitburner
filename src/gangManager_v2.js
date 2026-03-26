/** @param {NS} ns **/
export async function main(ns) {
    const reserve = ns.args[0] ?? 500_000_000;
    const sleepTime = ns.args[1] ?? 2500;

    const earlyGear = [
        "Baseball Bat",
        "Bulletproof Vest",
        "Ford Flex V20"
    ];

    const midGear = [
        "Katana",
        "Glock 18C",
        "P90C"
    ];

    const lateGear = [
        "Steyr AUG",
        "AK-47",
        "M15A10 Assault Rifle",
        "AWM Sniper Rifle"
    ];

    while (true) {
        if (!ns.gang.inGang()) return;

        // Recruit
        while (ns.gang.canRecruitMember()) {
            const name = "G" + Math.floor(Math.random() * 10000);
            ns.gang.recruitMember(name);
        }

        const members = ns.gang.getMemberNames();

        for (const m of members) {
            const info = ns.gang.getMemberInformation(m);
            const money = ns.getServerMoneyAvailable("home");

            // --- Equipment ---
            if (money > reserve) {
                for (const item of earlyGear) {
                    if (!info.upgrades.includes(item)) {
                        ns.gang.purchaseEquipment(m, item);
                    }
                }
            }

            if (money > reserve * 2) {
                for (const item of midGear) {
                    if (!info.upgrades.includes(item)) {
                        ns.gang.purchaseEquipment(m, item);
                    }
                }
            }

            if (money > reserve * 4) {
                for (const item of lateGear) {
                    if (!info.upgrades.includes(item)) {
                        ns.gang.purchaseEquipment(m, item);
                    }
                }
            }

            // --- Training vs Work ---
            if (info.str < 200) {
                ns.gang.setMemberTask(m, "Train Combat");
                continue;
            }

            // Wanted control
            const gangInfo = ns.gang.getGangInformation();
            if (gangInfo.wantedPenalty < 0.9) {
                ns.gang.setMemberTask(m, "Vigilante Justice");
                continue;
            }

            // Job assignment
            if (info.str > 500) {
                ns.gang.setMemberTask(m, "Terrorism");
            } else {
                ns.gang.setMemberTask(m, "Traffick Illegal Arms");
            }

            // --- Light Ascension ---
            const asc = ns.gang.getAscensionResult(m);
            if (asc && asc.str > 1.2) {
                ns.gang.ascendMember(m);
            }
        }

        await ns.sleep(sleepTime);
    }
}