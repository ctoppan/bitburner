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
      ns.print("[overlap] No valid target")
      await ns.sleep(2000)
      continue
    }

    if (target !== currentTarget) {
      ns.print(`[overlap] Switching -> ${target}`)
      killBatchWorkers(ns)
      currentTarget = target
    }

    const prepped = await prepIfNeeded(ns, target, reserveHome)
    if (!prepped) continue

    const weakenTime = ns.getWeakenTime(target)
    const spacing = spacingArg > 0 ? spacingArg : Math.max(40, Math.floor(weakenTime / 15))

    const launched = launchBatch(ns, target, spacing, reserveHome)

    ns.print(`[overlap] target=${target} spacing=${spacing} launched=${launched}`)

    await ns.sleep(weakenTime + spacing * 6)
  }
}

function launchBatch(ns, target, spacing, reserveHome) {
  const hosts = getHosts(ns, reserveHome)
  let launched = 0

  for (const host of hosts) {
    let free = freeRam(ns, host, reserveHome)
    if (free < 6) continue

    const scriptRam = 1.75 * 3 // hack + grow + weaken rough

    const sets = Math.floor(free / scriptRam)
    if (sets <= 0) continue

    for (let i = 0; i < sets; i++) {
      const delayBase = i * spacing * 4

      const h = ns.exec("/hacking/batch/hack.js", host, 1, target, 1, delayBase)
      const g = ns.exec("/hacking/batch/grow.js", host, 1, target, 1, delayBase + spacing)
      const w = ns.exec("/hacking/batch/weaken.js", host, 1, target, 1, delayBase + spacing * 2)

      if (h && g && w) {
        launched++
      } else {
        break
      }
    }
  }

  return launched
}

async function prepIfNeeded(ns, target, reserveHome) {
  const money = ns.getServerMoneyAvailable(target)
  const maxMoney = ns.getServerMaxMoney(target)
  const sec = ns.getServerSecurityLevel(target)
  const minSec = ns.getServerMinSecurityLevel(target)

  const moneyReady = money >= maxMoney * 0.98
  const secReady = sec <= minSec + 0.5

  if (moneyReady && secReady) return true

  ns.print(`[prep] ${target} money=${((money/maxMoney)*100).toFixed(1)}% sec+${(sec-minSec).toFixed(2)}`)

  const hosts = getHosts(ns, reserveHome)

  for (const host of hosts) {
    let free = freeRam(ns, host, reserveHome)
    if (free < 2) continue

    if (!secReady) {
      const wt = Math.floor(free / 1.75)
      if (wt > 0) ns.exec("/hacking/basic/weaken.js", host, 1, target, wt)
    } else if (!moneyReady) {
      const gt = Math.floor(free / 1.75)
      if (gt > 0) ns.exec("/hacking/basic/grow.js", host, 1, target, gt)
    }
  }

  await ns.sleep(3000)
  return false
}

function pickBestTarget(ns, topN) {
  const servers = scanAll(ns)
    .filter(s => s !== "home")
    .filter(s => ns.hasRootAccess(s))
    .filter(s => ns.getServerMaxMoney(s) > 0)
    .filter(s => ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel())

  return servers
    .map(s => ({
      s,
      score: ns.getServerMaxMoney(s) / ns.getWeakenTime(s)
    }))
    .sort((a,b)=>b.score-a.score)[0]?.s
}

function getHosts(ns, reserveHome) {
  return scanAll(ns)
    .filter(s => ns.hasRootAccess(s))
    .filter(s => ns.getServerMaxRam(s) > 0)
    .filter(s => s !== "home" || freeRam(ns, "home", reserveHome) > 8)
}

function freeRam(ns, host, reserveHome=0) {
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
    for (const s of scripts) {
      ns.scriptKill(s, host)
    }
  }
}

function scanAll(ns) {
  const seen = new Set()
  const stack = ["home"]

  while (stack.length) {
    const n = stack.pop()
    if (seen.has(n)) continue
    seen.add(n)
    for (const x of ns.scan(n)) {
      if (!seen.has(x)) stack.push(x)
    }
  }

  return [...seen]
}