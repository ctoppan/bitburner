/** @param {NS} ns **/
export async function main(ns) {
  const hackPctStart = Number(ns.args[0] ?? 0.05)
  const spacingArg = Number(ns.args[1] ?? -1)
  const reserveHome = Number(ns.args[2] ?? 1024)
  const scanTop = Number(ns.args[3] ?? 25)

  ns.disableLog("ALL")
  ns.ui.openTail()

  let currentTarget = null

  while (true) {
    const target = pickBestTarget(ns, scanTop)

    if (!target) {
      ns.print("[overlap] No valid target found")
      await ns.sleep(2000)
      continue
    }

    if (target !== currentTarget) {
      ns.print(`[overlap] Switching target -> ${target}`)
      killBatchWorkers(ns)
      currentTarget = target
    }

    const prepped = await prepIfNeeded(ns, target, reserveHome)
    if (!prepped) {
      await ns.sleep(2000)
      continue
    }

    const weakenTime = ns.getWeakenTime(target)
    const spacing = spacingArg > 0 ? spacingArg : Math.max(30, Math.floor(weakenTime / 15))
    const hackPct = dynamicHackPct(ns, target, hackPctStart)

    const launched = launchBatch(ns, target, hackPct, spacing, reserveHome)
    ns.print(
      `[overlap] target=${target} hackPct=${(hackPct * 100).toFixed(1)} ` +
      `spacing=${spacing}ms launched=${launched}`
    )

    await ns.sleep(Math.max(2000, weakenTime + spacing * 8))
  }
}

function pickBestTarget(ns, topN) {
  const servers = scanAll(ns)
    .filter((s) => s !== "home")
    .filter((s) => ns.hasRootAccess(s))
    .filter((s) => ns.getServerMaxMoney(s) > 0)
    .filter((s) => ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel())

  const scored = servers.map((s) => {
    const maxMoney = ns.getServerMaxMoney(s)
    const minSec = ns.getServerMinSecurityLevel(s)
    const weakenTime = ns.getWeakenTime(s)
    const hackChance = ns.hackAnalyzeChance(s)
    const moneyNow = ns.getServerMoneyAvailable(s)
    const secNow = ns.getServerSecurityLevel(s)

    const prepPenalty =
      Math.max(0.15, moneyNow / Math.max(1, maxMoney)) *
      (1 / Math.max(1, secNow - minSec + 1))

    const score =
      (maxMoney * Math.max(0.01, hackChance) * prepPenalty) /
      Math.max(1, weakenTime * Math.max(1, minSec))

    return { s, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)[0]?.s ?? null
}

function dynamicHackPct(ns, target, base) {
  const money = ns.getServerMoneyAvailable(target)
  const maxMoney = ns.getServerMaxMoney(target)

  if (maxMoney <= 0) return clamp(base, 0.01, 0.15)

  if (money < maxMoney * 0.8) return clamp(base * 0.5, 0.01, 0.15)
  if (money > maxMoney * 0.98) return clamp(base * 1.25, 0.01, 0.15)

  return clamp(base, 0.01, 0.15)
}

async function prepIfNeeded(ns, target, reserveHome) {
  const money = ns.getServerMoneyAvailable(target)
  const maxMoney = ns.getServerMaxMoney(target)
  const sec = ns.getServerSecurityLevel(target)
  const minSec = ns.getServerMinSecurityLevel(target)

  const moneyReady = money >= maxMoney * 0.98
  const secReady = sec <= minSec + 0.5

  if (moneyReady && secReady) return true

  ns.print(
    `[prep] ${target} money=${formatPct(maxMoney > 0 ? money / maxMoney : 0)} ` +
    `sec+${(sec - minSec).toFixed(2)}`
  )

  const hosts = getUsableHosts(ns, reserveHome)
  let launched = 0

  for (const host of hosts) {
    const free = freeRam(ns, host, reserveHome)
    if (free < 2) continue

    if (!secReady) {
      const weakenRam = ns.getScriptRam("/hacking/basic/weaken.js", host) || 1.75
      const threads = Math.floor(free / weakenRam)
      if (threads > 0) {
        const pid = ns.exec("/hacking/basic/weaken.js", host, threads, target)
        if (pid !== 0) {
          launched += threads
          continue
        }
      }
    }

    if (!moneyReady) {
      const growRam = ns.getScriptRam("/hacking/basic/grow.js", host) || 1.75
      const threads = Math.floor(free / growRam)
      if (threads > 0) {
        const pid = ns.exec("/hacking/basic/grow.js", host, threads, target)
        if (pid !== 0) launched += threads
      }
    }
  }

  ns.print(`[prep] launched threads=${launched}`)
  await ns.sleep(3000)
  return false
}

function launchBatch(ns, target, hackPct, spacing, reserveHome) {
  const hosts = getUsableHosts(ns, reserveHome)
  let launched = 0

  for (const host of hosts) {
    const free = freeRam(ns, host, reserveHome)
    if (free < 6) continue

    const hackRam = ns.getScriptRam("/hacking/batch/hack.js", host) || 1.7
    const growRam = ns.getScriptRam("/hacking/batch/grow.js", host) || 1.75
    const weakenRam = ns.getScriptRam("/hacking/batch/weaken.js", host) || 1.75
    const setRam = hackRam + growRam + weakenRam

    const sets = Math.floor(free / setRam)
    if (sets <= 0) continue

    for (let i = 0; i < sets; i++) {
      const baseDelay = i * spacing * 4

      const p1 = ns.exec("/hacking/batch/hack.js", host, 1, target, baseDelay, hackPct)
      const p2 = ns.exec("/hacking/batch/grow.js", host, 1, target, baseDelay + spacing, hackPct)
      const p3 = ns.exec("/hacking/batch/weaken.js", host, 1, target, baseDelay + spacing * 2, hackPct)

      if (p1 !== 0 && p2 !== 0 && p3 !== 0) {
        launched++
      } else {
        break
      }
    }
  }

  return launched
}

function getUsableHosts(ns, reserveHome) {
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

function killBatchWorkers(ns) {
  const scripts = [
    "/hacking/batch/hack.js",
    "/hacking/batch/grow.js",
    "/hacking/batch/weaken.js",
  ]

  for (const host of scanAll(ns)) {
    for (const script of scripts) {
      ns.scriptKill(script, host)
    }
  }
}

function scanAll(ns) {
  const seen = new Set()
  const stack = ["home"]

  while (stack.length > 0) {
    const node = stack.pop()
    if (seen.has(node)) continue
    seen.add(node)

    for (const next of ns.scan(node)) {
      if (!seen.has(next)) stack.push(next)
    }
  }

  return [...seen]
}

function formatPct(v) {
  return `${(v * 100).toFixed(1)}%`
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}