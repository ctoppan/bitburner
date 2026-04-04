/** @param {NS} ns **/
export async function main(ns) {
  const reserveHome = Number(ns.args[2] ?? 1024)
  const scanTop = Number(ns.args[3] ?? 25)
  const spacingArg = Number(ns.args[1] ?? -1)

  ns.disableLog("ALL")

  // Simple singleton guard
  const me = ns.pid
  const others = ns.ps("home").filter(
    p => p.filename === ns.getScriptName() && p.pid !== me
  )
  if (others.length > 0) {
    ns.print("[overlap] Another controller is already running, exiting")
    return
  }

  const hackScript = "/hacking/main/hack.js"
  const growScript = "/hacking/main/grow.js"
  const weakenScript = "/hacking/main/weaken.js"

  let currentTarget = null

  while (true) {
    // Duplicate self-check
    const duplicates = ns.ps("home").filter(
      p => p.filename === ns.getScriptName() && p.pid !== ns.pid
    )
    if (duplicates.length > 0) {
      const all = [...duplicates.map(d => d.pid), ns.pid].sort((a, b) => a - b)
      if (all[0] !== ns.pid) {
        ns.print("[overlap] Duplicate controller detected, exiting")
        return
      }
    }

    let target = pickBestTarget(ns, scanTop)

    if (!target) {
      ns.print("[overlap] No valid target")
      await ns.sleep(2000)
      continue
    }

    if (target !== currentTarget) {
      if (currentTarget !== null) {
        const currentMoney = ns.getServerMoneyAvailable(currentTarget)
        const currentMaxMoney = ns.getServerMaxMoney(currentTarget)
        const currentSec = ns.getServerSecurityLevel(currentTarget)
        const currentMinSec = ns.getServerMinSecurityLevel(currentTarget)

        const currentStillGood =
          currentMaxMoney > 0 &&
          currentMoney >= currentMaxMoney * 0.8 &&
          currentSec <= currentMinSec + 3

        if (currentStillGood) {
          target = currentTarget
        } else {
          ns.print(`[overlap] Switching target -> ${target}`)
          killWorkers(ns, hackScript, growScript, weakenScript)
          currentTarget = target
        }
      } else {
        ns.print(`[overlap] Switching target -> ${target}`)
        currentTarget = target
      }
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
  const hackLevel = ns.getHackingLevel()

  // Hard tiering by late-game progression
  let minMoney = 0
  if (hackLevel >= 500) minMoney = 1e9
  if (hackLevel >= 1200) minMoney = 5e9
  if (hackLevel >= 2500) minMoney = 1e10
  if (hackLevel >= 4000) minMoney = 2e10
  if (hackLevel >= 5500) minMoney = 4e10

  let maxReqHackRatio = 1.00
  if (hackLevel >= 2500) maxReqHackRatio = 0.95
  if (hackLevel >= 4000) maxReqHackRatio = 0.90
  if (hackLevel >= 5500) maxReqHackRatio = 0.85

  const maxAllowedReqHack = hackLevel * maxReqHackRatio

  const servers = scanAll(ns)
    .filter((s) => s !== "home")
    .filter((s) => ns.hasRootAccess(s))
    .filter((s) => ns.getServerMaxMoney(s) > 0)
    .filter((s) => ns.getServerRequiredHackingLevel(s) <= maxAllowedReqHack)
    .filter((s) => ns.getServerMaxMoney(s) >= minMoney)

  if (servers.length === 0) {
    // fallback if hard tiering filters too much
    const fallback = scanAll(ns)
      .filter((s) => s !== "home")
      .filter((s) => ns.hasRootAccess(s))
      .filter((s) => ns.getServerMaxMoney(s) > 0)
      .filter((s) => ns.getServerRequiredHackingLevel(s) <= hackLevel)

    if (fallback.length === 0) return null

    return fallback
      .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a))[0]
  }

  const scored = servers.map((s) => {
    const maxMoney = ns.getServerMaxMoney(s)
    const minSec = ns.getServerMinSecurityLevel(s)
    const weakenTime = ns.getWeakenTime(s)
    const chance = Math.max(0.01, ns.hackAnalyzeChance(s))
    const reqHack = ns.getServerRequiredHackingLevel(s)

    const moneyNow = ns.getServerMoneyAvailable(s)
    const secNow = ns.getServerSecurityLevel(s)

    const moneyRatio = maxMoney > 0 ? moneyNow / maxMoney : 0
    const secPenalty = Math.max(1, secNow - minSec + 1)

    // Strong rich-server bias
    const valueScore = Math.pow(maxMoney, 1.0)

    // Still account for efficiency, but not enough for foodnstuff to win
    const efficiencyScore =
      (chance * valueScore) /
      (Math.pow(weakenTime, 0.45) * Math.pow(Math.max(1, minSec), 0.30))

    // Prefer already-prepped servers, but don't overpunish rich ones
    const prepScore =
      Math.max(0.40, moneyRatio) /
      Math.pow(secPenalty, 0.55)

    // Small reward for tougher late-game servers, but capped
    const levelFit = 1 + Math.min(0.25, reqHack / Math.max(1, hackLevel))

    return {
      s,
      score: efficiencyScore * prepScore * levelFit,
      maxMoney,
      weakenTime,
      chance,
      reqHack,
    }
  })

  scored.sort((a, b) => b.score - a.score)

  const finalists = scored.slice(0, Math.max(1, topN))

  // If scores are close, prefer the richer server.
  finalists.sort((a, b) => {
    const scoreDiff = Math.abs(a.score - b.score) / Math.max(1e-9, Math.max(a.score, b.score))
    if (scoreDiff < 0.20) {
      return b.maxMoney - a.maxMoney
    }
    return b.score - a.score
  })

  return finalists[0]?.s ?? null
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