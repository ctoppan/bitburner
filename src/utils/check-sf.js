/** @param {NS} ns */
export async function main(ns) {
  const owned = ns.getOwnedSourceFiles()

  if (owned.length === 0) {
    ns.tprint("No Source Files yet.")
    return
  }

  for (const sf of owned.sort((a, b) => a.n - b.n)) {
    ns.tprint(`SF-${sf.n}: Level ${sf.lvl}`)
  }
}