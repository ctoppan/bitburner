/** @param {NS} ns **/
export async function main(ns) {
  const hackPctStart = Number(ns.args[0] ?? 0.05)
  const spacing = Number(ns.args[1] ?? -1)
  const reserveHome = Number(ns.args[2] ?? 1024)
  const scanTop = Number(ns.args[3] ?? 25)

  ns.disableLog("ALL")
  ns.tail()

  let currentTarget = null

  while (true) {
    const target = pickBestTarget(ns, scanTop)

    if (target !== currentTarget) {
      ns.print(`Switching target -> ${target}`)
      killBatchWorkers(ns)
      currentTarget = target
    }

    await prepIfNeeded(ns, target)

    const weakenTime = ns.getWeakenTime(target)
    const delay = spacing > 0 ? spacing : Math.max(20, Math.floor(weakenTime / 12))

    const hackPct = dynamicHackPct(ns, target, hackPctStart)

    launchBatch(ns, target, hackPct, delay, reserveHome)

    // 🔑 CRITICAL FIX: wait for batches to actually land
    await ns.sleep(weakenTime + delay * 5)
  }
}

function pickBestTarget(ns, topN) {
  const servers = scanAll(ns)
    .filter(s => ns.hasRootAccess(s))
    .filter(s => ns.getServerMaxMoney(s) > 0)
    .filter(s => ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel())

  const scored = servers.map(s => {
    const money = ns.getServerMaxMoney(s)
    const time = ns.getWeakenTime(s)
    return { s, score: money / time }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)[0]?.s
}

function dynamicHackPct(ns, target, base) {
  const money = ns.getServerMoneyAvailable(target)
  const max = ns.getServerMaxMoney(target)

  if (money < max * 0.9) return base * 0.5
  if (money > max * 0.99) return base * 1.5

  return base
}

async function prepIfNeeded(ns, target) {
  while (ns.getServerSecurityLevel(target) > ns.getServerMinSecurityLevel(target) + 2 ||
         ns.getServerMoneyAvailable(target) < ns.getServerMaxMoney(target) * 0.95) {

    ns.print(`Prepping ${target}...`)
    await ns.exec("/hacking/basic/weaken.js", "home", 10, target)
    await ns.exec("/hacking/basic/grow.js", "home", 10, target)
    await ns.sleep(2000)
  }
}

function launchBatch(ns, target, hackPct, delay, reserveHome) {
  const hosts = scanAll(ns)
    .filter(s => ns.hasRootAccess(s))
    .filter(s => ns.getServerMaxRam(s) > 0)

  for (const host of hosts) {
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)

    if (host === "home" && free < reserveHome) continue

    if (free < 4) continue

    ns.exec("/hacking/batch/hack.js", host, 1, target, delay)
    ns.exec("/hacking/batch/grow.js", host, 1, target, delay * 2)
    ns.exec("/hacking/batch/weaken.js", host, 1, target, delay * 3)
  }
}

function killBatchWorkers(ns) {
  const scripts = [
    "/hacking/batch/hack.js",
    "/hacking/batch/grow.js",
    "/hacking/batch/weaken.js"
  ]

  for (const s of scanAll(ns)) {
    for (const script of scripts) {
      ns.scriptKill(script, s)
    }
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