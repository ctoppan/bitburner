/** @param {NS} ns **/
export async function main(ns) {
    const self = ns.getScriptName();

    const keep = new Set([
        "installscripts.js",
        "bootstrap/start.js",
        "bootstrap/start-download-only.js",
        self,
    ]);

    for (const proc of ns.ps("home")) {
        if (keep.has(proc.filename)) continue;
        ns.kill(proc.pid);
    }

    await ns.sleep(200);

    let removed = 0;
    let failed = 0;

    for (const file of ns.ls("home", ".js")) {
        if (keep.has(file)) continue;

        const ok = ns.rm(file, "home");
        if (ok) {
            removed++;
            ns.tprint(`[cleanup] removed ${file}`);
        } else {
            failed++;
            ns.tprint(`[cleanup] failed ${file}`);
        }
    }

    ns.tprint(`[cleanup] done | removed=${removed} failed=${failed}`);
}