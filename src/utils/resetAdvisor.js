/** @param {NS} ns */
export async function main(ns) {
  const reserve = Number(ns.args[0] ?? 110e9)
  const daedalusMoneyGate = Number(ns.args[1] ?? 100e9)
  const daedalusHackGate = Number(ns.args[2] ?? 2500)

  const player = ns.getPlayer()
  const factions = player.factions
  const hasDaedalus = factions.includes("Daedalus")
  const homeMoney = ns.getServerMoneyAvailable("home")
  const hack = ns.getHackingLevel()

  const lines = []
  lines.push("=== Reset Advisor ===")
  lines.push(`Home money:      ${fmtMoney(ns, homeMoney)}`)
  lines.push(`Reserve target:  ${fmtMoney(ns, reserve)}`)
  lines.push(`Daedalus money:  ${fmtMoney(ns, daedalusMoneyGate)}`)
  lines.push(`Hacking level:   ${ns.formatNumber(hack, 3)}`)
  lines.push(`Hack target:     ${ns.formatNumber(daedalusHackGate, 3)}`)
  lines.push(`Daedalus joined: ${hasDaedalus ? "yes" : "no"}`)

  if (ns.gang.inGang()) {
    const gang = ns.gang.getGangInformation()
    const members = ns.gang.getMemberNames()
    lines.push("")
    lines.push("Gang:")
    lines.push(`  faction:       ${gang.faction}`)
    lines.push(`  members:       ${members.length}`)
    lines.push(`  respect:       ${ns.formatNumber(gang.respect, 3)}`)
    lines.push(`  wanted penalty ${(gang.wantedPenalty * 100).toFixed(2)}%`)
    lines.push(`  territory:     ${(gang.territory * 100).toFixed(2)}%`)
  }

  lines.push("")
  lines.push("Recommendation:")

  if (homeMoney < daedalusMoneyGate) {
    lines.push("- Keep pushing money. Do not raise reserve too high yet.")
  } else if (homeMoney < reserve) {
    lines.push("- You crossed the Daedalus floor, but current reserve is higher than cash. Avoid spending.")
  } else {
    lines.push("- Money objective met. Protect reserve and push rep.")
  }

  if (hack < daedalusHackGate) {
    lines.push("- Favor XP-heavy hacking until hack is stable above the target.")
  } else {
    lines.push("- Hacking objective met. Favor stable money batches and faction work.")
  }

  if (!hasDaedalus) {
    lines.push("- Daedalus not joined yet. Keep checking invite conditions.")
  } else {
    lines.push("- Daedalus joined. Narrow focus to rep and the aug package you want.")
  }

  const shouldReset = hasDaedalus && homeMoney >= reserve && hack >= daedalusHackGate
  lines.push("")
  lines.push(`Reset-ready: ${shouldReset ? "probably yes, if your aug package is ready" : "not yet"}`)

  ns.tprint(lines.join("\n"))
}

function fmtMoney(ns, value) {
  return "$" + ns.formatNumber(value, 3)
}
