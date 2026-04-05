const settings = {
  keys: {
    crimesStop: 'BB_CRIMES_STOP',
  },
  crimes: [
    'shoplift',
    'rob store',
    'mug',
    'larceny',
    'deal drugs',
    'bond forgery',
    'traffick arms',
    'homicide',
    'grand theft auto',
    'kidnap',
    'assassinate',
    'heist',
  ],
  refreshMs: 10 * 60 * 1000,
  defaultKarmaTarget: -54000,
}

function getItem(key) {
  const item = localStorage.getItem(key)
  return item ? JSON.parse(item) : undefined
}

function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now()
  return new Date(ms).toLocaleTimeString()
}

function formatNumber(n) {
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

function getCrimeData(ns) {
  const crimes = {}

  for (const crime of settings.crimes) {
    const chance = ns.singularity.getCrimeChance(crime)
    const stats = ns.singularity.getCrimeStats(crime)
    crimes[crime] = { chance, stats }
  }

  return crimes
}

function pickBestMoneyCrime(crimes) {
  const crimesList = Object.keys(crimes).sort((a, b) => crimes[b].chance - crimes[a].chance)

  const solidChanceCrimes = crimesList.filter((crime) => crimes[crime].chance >= 0.8)
  const candidateCrimes = solidChanceCrimes.length >= 3 ? solidChanceCrimes : crimesList.slice(0, 4)

  let bestCrime = 'shoplift'
  let bestWeight = -1

  for (const crime of candidateCrimes) {
    const info = crimes[crime]
    const moneyPerMs = info.stats.money / Math.max(info.stats.time, 1)
    const weight = info.chance * moneyPerMs

    if (weight > bestWeight) {
      bestWeight = weight
      bestCrime = crime
    }
  }

  return bestCrime
}

function pickBestKarmaCrime(crimes) {
  let bestCrime = 'homicide'
  let bestWeight = -1

  for (const crime of Object.keys(crimes)) {
    const info = crimes[crime]
    const karma = Math.abs(info.stats.karma || 0)
    const karmaPerMs = karma / Math.max(info.stats.time, 1)
    const weight = info.chance * karmaPerMs

    if (weight > bestWeight) {
      bestWeight = weight
      bestCrime = crime
    }
  }

  return bestCrime
}

/** @param {NS} ns */
export async function main(ns) {
  const mode = String(ns.args[0] || 'money').toLowerCase()
  const karmaTarget = Number(ns.args[1] ?? settings.defaultKarmaTarget)

  ns.disableLog('sleep')
  ns.tprint(`[${localeHHMMSS()}] Starting crimeManager.js in mode: ${mode}`)

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home')
  }

  const validModes = new Set(['money', 'karma', 'karma-until'])
  if (!validModes.has(mode)) {
    ns.tprint('Usage:')
    ns.tprint('run /crime/crimeManager.js money')
    ns.tprint('run /crime/crimeManager.js karma')
    ns.tprint('run /crime/crimeManager.js karma-until -54000')
    return
  }

  setItem(settings.keys.crimesStop, false)

  let nextRefresh = 0
  let crimes = null

  while (true) {
    const stop = getItem(settings.keys.crimesStop)
    if (stop) {
      ns.tprint(`[${localeHHMMSS()}] Stop flag detected, exiting crimeManager.js`)
      break
    }

    const currentKarma = ns.heart.break()

    if (mode === 'karma-until' && currentKarma <= karmaTarget) {
      ns.tprint(
        `[${localeHHMMSS()}] Karma target reached: ${formatNumber(currentKarma)} <= ${formatNumber(karmaTarget)}`
      )
      break
    }

    while (ns.singularity.isBusy()) {
      await ns.sleep(100)
    }

    if (!crimes || Date.now() >= nextRefresh) {
      crimes = getCrimeData(ns)
      nextRefresh = Date.now() + settings.refreshMs
    }

    const crime = mode === 'money' ? pickBestMoneyCrime(crimes) : pickBestKarmaCrime(crimes)
    const info = crimes[crime]

    ns.tprint(
      `[${localeHHMMSS()}] Crime: ${crime} | chance=${(info.chance * 100).toFixed(1)}% | ` +
        `money=${formatNumber(info.stats.money)} | karma=${info.stats.karma}`
    )

    const crimeTime = ns.singularity.commitCrime(crime)
    await ns.sleep(Math.max(crimeTime + 20, 100))
  }

  setItem(settings.keys.crimesStop, false)
}