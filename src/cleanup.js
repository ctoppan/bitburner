/** @param {NS} ns **/
export async function main(ns) {
  const keep = new Set([
    "cleanup.js",
	"start-download-only.js",
  ]);

  // Kill everything else on home first
  for (const proc of ns.ps("home")) {
    if (keep.has(proc.filename)) continue;
    ns.kill(proc.pid);
  }

  // Give the kills a moment to settle
  await ns.sleep(200);

  const files = ns.ls("home", ".js");
  let removed = 0;
  let failed = 0;

  for (const file of files) {
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