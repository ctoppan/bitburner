/** @param {NS} ns **/
export async function main(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  let total = 0;
  let used = 0;

  while (queue.length > 0) {
    const host = queue.shift();
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  const servers = [...seen].filter(s => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0);

  for (const s of servers) {
    total += ns.getServerMaxRam(s);
    used += ns.getServerUsedRam(s);
  }

  const pct = total > 0 ? ((used / total) * 100).toFixed(2) : "0.00";
  ns.tprint(`Fleet Total: ${ns.formatRam(total)}`);
  ns.tprint(`Fleet Used: ${ns.formatRam(used)} (${pct}%)`);
  ns.tprint(`Fleet Free: ${ns.formatRam(total - used)}`);
}
