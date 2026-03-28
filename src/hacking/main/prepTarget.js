/** @param {NS} ns **/
export async function main(ns) {
  const target = ns.args[0]
  if (!target) {
    ns.tprint('Usage: run prepTarget.js <target>')
    return
  }

  while (true) {
    const sec = ns.getServerSecurityLevel(target)
    const minSec = ns.getServerMinSecurityLevel(target)
    const money = ns.getServerMoneyAvailable(target)
    const maxMoney = ns.getServerMaxMoney(target)

    if (sec > minSec + 0.5) {
      await ns.weaken(target)
    } else if (money < maxMoney * 0.99) {
      await ns.grow(target)
    } else {
      ns.tprint(`[prepTarget.js] ${target} is prepped.`)
      return
    }
  }
}