/** @param {NS} ns **/
export async function main(ns) {
  const reserveHome = Number(ns.args[2] ?? 1024)
  const scanTop = Number(ns.args[3] ?? 25)
  const spacingArg = Number(ns.args[1] ?? -1)

  ns.disableLog("ALL")
  ns.ui.openTail()

  const hackScript = "/hacking/main/hack.js"
  const growScript = "/hacking/main/grow.js"
  const weakenScript = "/hacking/main/weaken.js"

  let currentTarget = null

  while (true) {
    const target = pickBestTarget(ns, scanTop)

    if (!target) {
      ns.print("[overlap] No valid target")
      await ns.sleep(2000)
      continue
    }

    if (target !== currentTarget) {
      ns.print(`[overlap] Switching target -> ${target}`)
      killWorkers(ns, hackScript, growScript, weakenScript)
      currentTarget = target
    }

    await deployFiles(ns, [hackScript, growScript, weakenScript], reserveHome)

    const ready = await prepIfNeeded(ns, target, reserveHome, growScript, weakenScript)
    if (!ready) continue

    const weakenTime = ns.getWeakenTime(target)
    const spacing = spacingArg > 0 ? spacingArg : Math.max(80, Math.floor(weakenTime / 20))

    const launched = launchBatches(ns, target, spacing, reserveHome, hackScript, growScript, weakenScript)
    ns.print(`[overlap] target=${target} spacing=${spacing}ms launched=${launched}`)

    await ns.sleep(Math.max(3000, weakenTime + spacing * 8))
  }
}

async function deployFiles(ns, files, reserveHome) {
  for (const host of getHosts(ns, reserveHome)) {
    if (host === "home") continue
    await ns.scp(files, host, "home")
  }
}

async function prepIfNeeded(ns, target, reserveHome, growScript, weakenScript) {
  while (true) {
    const money = ns.getServerMoneyAvailable(target)
    const maxMoney = ns.getServerMaxMoney(target)
    const sec = ns.getServerSecurityLevel(target)
    const minSec = ns.getServerMinSecurityLevel(target)

    const moneyReady = maxMoney > 0 && money >= maxMoney * 0.98
    const secReady = sec <= minSec + 0.5

    if (moneyReady && secReady) {
      ns.print(`[prep] ${target} READY`)
      return true
    }

    ns.print(
      `[prep] ${target} money=${maxMoney > 0 ? ((money / maxMoney) * 100).toFixed(1) : "0.0"}% sec+${(sec - minSec).toFixed(2)}`
    )

    let launched = 0

    for (const host of getHosts(ns, reserveHome)) {
      const free = freeRam(ns, host, reserveHome)
      if (free < 2) continue

      if (!secReady) {
        const ram = ns.getScriptRam(weakenScript, host) || 1.75
        const threads = Math.floor(free / ram)
        if (threads > 0) {
          const pid = ns.exec(weakenScript, host, threads, target, 0)
          if (pid !== 0) launched++
        }
      } else if (!moneyReady) {
        const ram = ns.getScriptRam(growScript, host) || 1.75
        const threads = Math.floor(free / ram)
        if (threads > 0) {
          const pid = ns.exec(growScript, host, threads, target, 0)
          if (pid !== 0) launched++
        }
      }
    }

    ns.print(`[prep] launched jobs=${launched}`)

    if (launched === 0) {
      await ns.sleep(10000)
    } else {
      const waitMs = !secReady
        ? Math.max(5000, Math.min(15000, ns.getWeakenTime(target) * 0.25))
        : Math.max(5000, Math.min(15000, ns.getGrowTime(target) * 0.25))
      await ns.sleep(waitMs)
    }
  }
}

function launchBatches(ns, target, spacing, reserveHome, hackScript, growScript, weakenScript) {
  let launched = 0

  for (const host of getHosts(ns, reserveHome)) {
    const free = freeRam(ns, host, reserveHome)
    if (free < 6) continue

    const hackRam = ns.getScriptRam(hackScript, host) || 1.7
    const growRam = ns.getScriptRam(growScript, host) || 1.75
    const weakenRam = ns.getScriptRam(weakenScript, host) || 1.75

    const oneSetRam = hackRam + growRam + weakenRam
    const sets = Math.floor(free / oneSetRam)
    if (sets <= 0) continue

    for (let i = 0; i < sets; i++) {
      const baseDelay = i * spacing * 4

      const h = ns.exec(hackScript, host, 1, target, baseDelay)
      const g = ns.exec(growScript, host, 1, target, baseDelay + spacing)
      const w = ns.exec(weakenScript, host, 1, target, baseDelay + spacing * 2)

      if (h !== 0 && g !== 0 && w !== 0) {
        launched++
      } else {
        break
      }
    }
  }

  return launched
}

function pickBestTarget(ns, topN) {
  const servers = scanAll(ns)
    .filter((s) => s !== "home")
    .filter((s) => ns.hasRootAccess(s))
    .filter((s) => ns.getServerMaxMoney(s) > 0)
    .filter((s) => ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel())

  const scored = servers.map((s) => {
    const money = ns.getServerMaxMoney(s)
    const minSec = ns.getServerMinSecurityLevel(s)
    const time = ns.getWeakenTime(s)
    const chance = ns.hackAnalyzeChance(s)
    const moneyNow = ns.getServerMoneyAvailable(s)
    const secNow = ns.getServerSecurityLevel(s)

    const prepPenalty =
      Math.max(0.25, moneyNow / Math.max(1, money)) /
      Math.max(1, secNow - minSec + 1)

    return {
      s,
      score: ((money * Math.max(0.01, chance)) / (time * Math.max(1, minSec))) * prepPenalty,
    }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)[0]?.s ?? null
}

function getHosts(ns, reserveHome) {
  return scanAll(ns)
    .filter((s) => ns.hasRootAccess(s))
    .filter((s) => ns.getServerMaxRam(s) > 0)
    .filter((s) => s !== "home" || freeRam(ns, "home", reserveHome) > 8)
    .sort((a, b) => freeRam(ns, b, reserveHome) - freeRam(ns, a, reserveHome))
}

function freeRam(ns, host, reserveHome = 0) {
  const max = ns.getServerMaxRam(host)
  const used = ns.getServerUsedRam(host)
  const reserve = host === "home" ? reserveHome : 0
  return Math.max(0, max - used - reserve)
}

function killWorkers(ns, hackScript, growScript, weakenScript) {
  for (const host of scanAll(ns)) {
    ns.scriptKill(hackScript, host)
    ns.scriptKill(growScript, host)
    ns.scriptKill(weakenScript, host)
  }
}

function scanAll(ns) {
  const seen = new Set()
  const stack = ["home"]

  while (stack.length) {
    const node = stack.pop()
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of ns.scan(node)) {
      if (!seen.has(next)) stack.push(next)
    }
  }

  return [...seen]
}