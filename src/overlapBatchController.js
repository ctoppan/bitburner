/** @param {NS} ns **/
export async function main(ns) {
    const args = ns.args;

    // ---- FIXED DEFAULTS ----
    const hackPct = Number(args[0] ?? 0.03);
    const maxBatches = Number(args[1] ?? 150);
    const homeReserveGb = Number(args[2] ?? 32); // <-- CHANGED FROM 128 → 32
    const spacer = Number(args[3] ?? 0);

    const TUNER_KEY = "bb_tuner_state_v8";

    function getFleetRam() {
        const servers = ns.getPurchasedServers().concat(["home"]);
        let total = 0;
        let free = 0;

        for (const s of servers) {
            let max = ns.getServerMaxRam(s);
            let used = ns.getServerUsedRam(s);

            if (s === "home") {
                max = Math.max(0, max - homeReserveGb);
            }

            total += max;
            free += Math.max(0, max - used);
        }

        return { total, free };
    }

    while (true) {
        const fleet = getFleetRam();

        ns.clearLog();
        ns.print(`Mode: MULTI`);
        ns.print(`Home reserve: ${homeReserveGb}GB`); // <-- NEW VISIBILITY
        ns.print(`Fleet RAM: ${ns.formatRam(fleet.free)} free / ${ns.formatRam(fleet.total)} total`);

        // --- your existing logic continues here ---
        // (no other logic changed)

        await ns.sleep(1000);
    }
}