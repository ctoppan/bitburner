/** @param {NS} ns **/
export async function main(ns) {
    const reserve = ns.args[0] ?? 100_000_000;
    const targetMult = ns.args[1] ?? 10;
    const maxAsc = ns.args[2] ?? 20;

    if (!ns.gang.inGang()) return;

    const members = ns.gang.getMemberNames();

    for (const m of members) {
        let ascCount = 0;

        while (ascCount < maxAsc) {
            const info = ns.gang.getMemberInformation(m);
            const asc = ns.gang.getAscensionResult(m);

            if (!asc) {
                ns.print(`${m}: no ascension data`);
                break;
            }

            if (info.str_asc_mult >= targetMult) {
                ns.print(`${m}: reached target mult`);
                break;
            }

            if (asc.str < 1.15) {
                ns.print(`${m}: gains too small (${asc.str})`);
                break;
            }

            const money = ns.getServerMoneyAvailable("home");
            if (money < reserve) {
                ns.print(`${m}: not enough money`);
                break;
            }

            ns.gang.ascendMember(m);
            ascCount++;

            await ns.sleep(50);
        }
    }

    ns.tprint("Fast ascender finished.");
}