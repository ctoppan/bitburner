/** @param {NS} ns */
export async function main(ns) {
  const target = String(ns.args[0] || "n00dles")
  const retryMs = 1000

  ns.disableLog("sleep")
  ns.disableLog("hasRootAccess")

  while (true) {
    while (!ns.hasRootAccess(target)) {
      ns.print(`[xpGrind] Waiting for root access on ${target}...`)
      await ns.sleep(retryMs)
    }

    try {
      await ns.grow(target)
    } catch (err) {
      ns.print(`[xpGrind] grow failed on ${target}: ${String(err)}`)
      await ns.sleep(retryMs)
    }
  }
}