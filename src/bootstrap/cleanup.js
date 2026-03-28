/** @param {NS} ns **/
export async function main(ns) {
  const keep = new Set([
    "bootstrap/cleanup.js",
    "bootstrap/start-download-only.js",
  ]);

  const normalize = (name) => String(name || "").replace(/^\/+/, "");

  for (const proc of ns.ps("home")) {
    if (keep.has(normalize(proc.filename))) continue;
    ns.kill(proc.pid);
  }

  await ns.sleep(200);

  const files = ns.ls("home", ".js");
  let removed = 0;
  let failed = 0;

  for (const file of files) {
    if (keep.has(normalize(file))) continue;

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
