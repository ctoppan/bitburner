/** @param {NS} ns */
export async function main(ns) {
  const xpHackPct = Number(ns.args[0] ?? 0.03)
  const moneyHackPct = Number(ns.args[1] ?? 0.08)
  const homeReserveRam = Number(ns.args[2] ?? 1024)
  const earlySpacing = Number(ns.args[3] ?? 30)
  const lateSpacing = Number(ns.args[4] ?? 80)
  const switchHackLevel = Number(ns.args[5] ?? 2500)
  const pollMs = Number(ns.args[6] ?? 15000)

  const controller = "/hacking/batch/overlapBatchController.js"
  const spreadHack = "/hacking/spread-hack.js"
  const xpGrind = "/xp/xpGrind.js"
  const xpDistributor = "/xp/xpDistributor.js"

  ns.disableLog("ALL")
  ns.ui.openTail()

  while (true) {
    const hack = ns.getHackingLevel()
    const inXpPhase = hack < switchHackLevel

    if (ns.fileExists(controller, "home")) {
      const desiredArgs = inXpPhase
        ? [xpHackPct, earlySpacing, homeReserveRam, 25]
        : [moneyHackPct, lateSpacing, homeReserveRam, 25]

      ensureSingleScript(ns, controller, desiredArgs)

      ns.clearLog()
      ns.print(`[orchestrator] phase=${inXpPhase ? "XP" : "MONEY"}`)
      ns.print(`[orchestrator] hack=${ns.formatNumber(hack, 3)} switch=${ns.formatNumber(switchHackLevel, 3)}`)
      ns.print(`[orchestrator] controller=${controller} ${desiredArgs.join(" ")}`)
    } else {
      ns.clearLog()
      ns.print(`[orchestrator] Missing ${controller}`)
    }

    if (inXpPhase) {
      startIfPresent(ns, spreadHack, [])
      startIfPresent(ns, xpGrind, [])
      startIfPresent(ns, xpDistributor, [])
    } else {
      stopIfRunning(ns, spreadHack)
      stopIfRunning(ns, xpGrind)
      stopIfRunning(ns, xpDistributor)
    }

    await ns.sleep(pollMs)
  }
}

function ensureSingleScript(ns, script, args) {
  const running = ns.ps("home").filter((p) => p.filename === script)
  const match = running.find((p) => sameArgs(p.args, args))

  if (match) return

  for (const proc of running) {
    try {
      ns.kill(proc.pid)
    } catch {}
  }

  ns.exec(script, "home", 1, ...args)
}

function startIfPresent(ns, script, args) {
  if (!ns.fileExists(script, "home")) return
  if (ns.scriptRunning(script, "home")) return
  ns.exec(script, "home", 1, ...args)
}

function stopIfRunning(ns, script) {
  if (ns.scriptRunning(script, "home")) ns.scriptKill(script, "home")
}

function sameArgs(actual, desired) {
  if (actual.length !== desired.length) return false
  for (let i = 0; i < actual.length; i++) {
    if (String(actual[i]) !== String(desired[i])) return false
  }
  return true
}
