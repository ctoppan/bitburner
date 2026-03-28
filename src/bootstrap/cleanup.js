/** @param {NS} ns **/
export async function main(ns) {
  const keep = new Set([
    "cleanup.js",
    "start.js",
    "bootstrap/start-download-only.js",
  ]);

  // Kill everything except kept scripts
  for (const proc of ns.ps("home")) {
    if (keep.has(proc.filename)) continue;
    ns.kill(proc.pid);
  }

  await ns.sleep(200);

  let removed = 0;

  for (const file of ns.ls("home", ".js")) {
    if (keep.has(file)) continue;

    if (ns.rm(file, "home")) {
      removed++;
      ns.tprint(`[cleanup] removed ${file}`);
    }
  }

  ns.tprint(`[cleanup] done | removed=${removed}`);
}