/** @param {NS} ns **/
export async function main(ns) {
  const worker = "/share/share-worker.js";
  const reserve = 32; // leave some RAM so you don't lock yourself out

  const scriptRam = ns.getScriptRam(worker);
  if (scriptRam <= 0) {
    ns.tprint(`ERROR: Missing ${worker}`);
    return;
  }

  // Kill any existing share workers on home
  ns.scriptKill(worker, "home");

  const maxRam = ns.getServerMaxRam("home");
  const usedRam = ns.getServerUsedRam("home");

  const freeRam = Math.max(0, maxRam - usedRam - reserve);
  const threads = Math.floor(freeRam / scriptRam);

  if (threads <= 0) {
    ns.tprint("Not enough free RAM on home to run share.");
    return;
  }

  const pid = ns.exec(worker, "home", threads);

  if (pid === 0) {
    ns.tprint("Failed to start share-worker on home.");
    return;
  }

  ns.tprint(`Started ${threads} share threads on home.`);
  ns.tprint(`Free RAM used: ${ns.formatRam(freeRam)}`);
}