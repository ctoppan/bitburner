function getItem(key) {
  const item = localStorage.getItem(key)
  return item ? JSON.parse(item) : undefined
}

/** @param {NS} ns */
export async function main(ns) {
  const stopFlag = getItem('BB_CRIMES_STOP')
  const karma = ns.heart.break()
  const busy = ns.singularity.isBusy()

  ns.tprint(`Crime stop flag: ${String(stopFlag)}`)
  ns.tprint(`Player busy: ${String(busy)}`)
  ns.tprint(`Karma: ${karma}`)
}