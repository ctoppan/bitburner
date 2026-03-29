/** @param {NS} ns */
export async function main(ns) {
  localStorage.setItem('BB_CRIMES_STOP', JSON.stringify(true))
  ns.tprint('Crime stop flag set.')
}