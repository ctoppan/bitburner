/** @param {NS} ns **/
export async function main(ns) {
  const manualTarget = ns.args[0] || ''
  const hackPct = Math.max(0.01, Math.min(0.1, Number(ns.args[1] ?? 0.03)))
  const spacer = Math.max(100, Number(ns.args[2] ?? 200))
  const homeReserve = Math.max(16, Number(ns.args[3] ?? 64))

  const scripts = ['batchHack.js', 'batchGrow.js', 'batchWeaken.js']
  for (const script of scripts) {
    if (!ns.fileExists(script, 'home')) {
      ns.tprint(`Missing ${script} on home`)
      return
    }
  }

  ns.disableLog('ALL')

  let currentTarget = ''

  while (true) {
    const hosts = await getUsableHosts(ns, scripts, homeReserve)

    if (hosts.length === 0) {
      ns.print('No usable rooted hosts.')
      await ns.sleep(5000)
      continue
    }

    const bestTarget = manualTarget || pickBestTarget(ns)
    if (!bestTarget) {
      ns.print('No valid batch target found.')
      await ns.sleep(5000)
      continue
    }

    if (bestTarget !== currentTarget) {
      currentTarget = bestTarget
      ns.tprint(`[batchController.js] Target selected: ${currentTarget}`)
    }

    const sec = ns.getServerSecurityLevel(currentTarget)
    const minSec = ns.getServerMinSecurityLevel(currentTarget)
    const money = ns.getServerMoneyAvailable(currentTarget)
    const maxMoney = ns.getServerMaxMoney(currentTarget)

    if (sec > minSec + 0.5) {
      await runPrepWeaken(ns, hosts, currentTarget)
      await ns.sleep(250)
      continue
    }

    if (money < maxMoney * 0.99) {
      await runPrepGrow(ns, hosts, currentTarget)
      await ns.sleep(250)
      continue
    }

    const batch = buildBatch(ns, currentTarget, hackPct, spacer)
    if (!batch) {
      ns.print(`Could not build batch for ${currentTarget}`)
      await ns.sleep(5000)
      continue
    }

    const launched = await deployBatch(ns, hosts, currentTarget, batch, spacer)
    ns.clearLog()
    ns.print(`Target: ${currentTarget}`)
    ns.print(`Money: ${ns.formatNumber(money, 2)} / ${ns.formatNumber(maxMoney, 2)}`)
    ns.print(`Security: ${sec.toFixed(2)} / ${minSec.toFixed(2)}`)
    ns.print(`Hack %: ${(hackPct * 100).toFixed(1)}%`)
    ns.print(
      `Threads: H ${batch[0].threads} | W1 ${batch[1].threads} | G ${batch[2].threads} | W2 ${batch[3].threads}`
    )
    ns.print(`Launched: ${launched ? 'YES' : 'NO (waiting for RAM)'}`)

    if (!launched) {
      await ns.sleep(5000)
      continue
    }

    await ns.sleep(spacer * 4 + 200)
  }
}

async function getUsableHosts(ns, scripts, homeReserve) {
  const seen = new Set(['home'])
  const queue = ['home']
  const hosts = []

  while (queue.length > 0) {
    const host = queue.shift()

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }

    tryRoot(ns, host)

    if (!ns.hasRootAccess(host)) continue
    if (ns.getServerMaxRam(host) < 2) continue

    for (const script of scripts) {
      await ns.scp(script, host, 'home')
    }

    hosts.push({
      host,
      freeRam: freeRam(ns, host, homeReserve),
    })
  }

  hosts.sort((a, b) => b.freeRam - a.freeRam)
  return hosts
}

function tryRoot(ns, host) {
  if (host === 'home' || ns.hasRootAccess(host)) return

  let ports = 0

  if (ns.fileExists('BruteSSH.exe', 'home')) {
    try { ns.brutessh(host) } catch {}
    ports++
  }
  if (ns.fileExists('FTPCrack.exe', 'home')) {
    try { ns.ftpcrack(host) } catch {}
    ports++
  }
  if (ns.fileExists('relaySMTP.exe', 'home')) {
    try { ns.relaysmtp(host) } catch {}
    ports++
  }
  if (ns.fileExists('HTTPWorm.exe', 'home')) {
    try { ns.httpworm(host) } catch {}
    ports++
  }
  if (ns.fileExists('SQLInject.exe', 'home')) {
    try { ns.sqlinject(host) } catch {}
    ports++
  }

  if (
    ports >= ns.getServerNumPortsRequired(host) &&
    ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host)
  ) {
    try { ns.nuke(host) } catch {}
  }
}

function pickBestTarget(ns) {
  const seen = new Set(['home'])
  const queue = ['home']
  const candidates = []
  const playerLevel = ns.getHackingLevel()

  while (queue.length > 0) {
    const host = queue.shift()

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }

    if (host === 'home') continue
    if (!ns.hasRootAccess(host)) continue
    if (ns.getServerRequiredHackingLevel(host) > playerLevel) continue

    const maxMoney = ns.getServerMaxMoney(host)
    if (maxMoney <= 0) continue

    const minSec = Math.max(1, ns.getServerMinSecurityLevel(host))
    const weakenTime = Math.max(1, ns.getWeakenTime(host))
    const req = Math.max(1, ns.getServerRequiredHackingLevel(host))

    const score =
      (maxMoney / minSec) *
      (1 / (weakenTime / 60000)) *
      (1 / Math.max(1, req / Math.max(1, playerLevel)))

    candidates.push({ host, score })
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.length ? candidates[0].host : ''
}

function buildBatch(ns, target, hackPct, spacer) {
  const maxMoney = ns.getServerMaxMoney(target)
  if (maxMoney <= 0) return null

  let hackThreads = ns.hackAnalyzeThreads(target, maxMoney * hackPct)
  if (!isFinite(hackThreads) || hackThreads <= 0) return null
  hackThreads = Math.max(1, Math.floor(hackThreads))

  const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / (1 - hackPct))))
  const hackSec = ns.hackAnalyzeSecurity(hackThreads, target)
  const growSec = ns.growthAnalyzeSecurity(growThreads, target)
  const weaken1Threads = Math.max(1, Math.ceil(hackSec / 0.05))
  const weaken2Threads = Math.max(1, Math.ceil(growSec / 0.05))

  const hackTime = ns.getHackTime(target)
  const growTime = ns.getGrowTime(target)
  const weakenTime = ns.getWeakenTime(target)

  const landing = Date.now() + weakenTime + 2000
  const batchId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`

  return [
    {
      script: 'batchHack.js',
      threads: hackThreads,
      delay: Math.max(0, landing - spacer * 3 - Date.now() - hackTime),
      batchId,
    },
    {
      script: 'batchWeaken.js',
      threads: weaken1Threads,
      delay: Math.max(0, landing - spacer * 2 - Date.now() - weakenTime),
      batchId,
    },
    {
      script: 'batchGrow.js',
      threads: growThreads,
      delay: Math.max(0, landing - spacer * 1 - Date.now() - growTime),
      batchId,
    },
    {
      script: 'batchWeaken.js',
      threads: weaken2Threads,
      delay: Math.max(0, landing - Date.now() - weakenTime),
      batchId,
    },
  ]
}

async function deployBatch(ns, hosts, target, jobs, homeReserve) {
  const ramByScript = {
    'batchHack.js': ns.getScriptRam('batchHack.js', 'home'),
    'batchGrow.js': ns.getScriptRam('batchGrow.js', 'home'),
    'batchWeaken.js': ns.getScriptRam('batchWeaken.js', 'home'),
  }

  for (const job of jobs) {
    let remaining = job.threads

    for (const hostInfo of hosts) {
      const host = hostInfo.host
      const ramPerThread = ramByScript[job.script]
      const available = Math.floor(freeRam(ns, host, homeReserve) / ramPerThread)
      if (available <= 0) continue

      const run = Math.min(remaining, available)
      if (run <= 0) continue

      const pid = ns.exec(job.script, host, run, target, job.delay, job.batchId)
      if (pid !== 0) {
        remaining -= run
      }

      if (remaining <= 0) break
    }

    if (remaining > 0) {
      return false
    }
  }

  return true
}

async function runPrepWeaken(ns, hosts, target) {
  const script = 'batchWeaken.js'
  const ram = ns.getScriptRam(script, 'home')
  const batchId = `prepW-${Date.now()}`

  for (const hostInfo of hosts) {
    const threads = Math.floor(hostInfo.freeRam / ram)
    if (threads > 0) {
      ns.exec(script, hostInfo.host, threads, target, 0, batchId)
    }
  }
}

async function runPrepGrow(ns, hosts, target) {
  const growRam = ns.getScriptRam('batchGrow.js', 'home')
  const weakenRam = ns.getScriptRam('batchWeaken.js', 'home')
  const batchId = `prepG-${Date.now()}`

  for (const hostInfo of hosts) {
    const totalGrow = Math.floor(hostInfo.freeRam * 0.8 / growRam)
    const totalWeaken = Math.floor(hostInfo.freeRam * 0.2 / weakenRam)

    if (totalGrow > 0) {
      ns.exec('batchGrow.js', hostInfo.host, totalGrow, target, 0, `${batchId}-g`)
    }
    if (totalWeaken > 0) {
      ns.exec('batchWeaken.js', hostInfo.host, totalWeaken, target, 0, `${batchId}-w`)
    }
  }
}

function freeRam(ns, host, homeReserve) {
  const reserve = host === 'home' ? homeReserve : 0
  return Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve)
}