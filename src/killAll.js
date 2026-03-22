const settings = {
  mapRefreshInterval: 24 * 60 * 60 * 1000,
  keys: {
    serverMap: 'BB_SERVER_MAP',
  },
}

const scriptsToKill = [
  // legacy
  'mainHack.js',
  'spider.js',
  'grow.js',
  'hack.js',
  'weaken.js',
  'playerServers.js',
  'runHacking.js',
  'initHacking.js',
  'start.js',
  'find.js',

  // batch
  'prepTarget.js',
  'batchHack.js',
  'batchGrow.js',
  'batchWeaken.js',
  'batchController.js',
  'overlapBatchController.js',
]

function getItem(key) {
  const item = localStorage.getItem(key)
  return item ? JSON.parse(item) : undefined
}

function localeHHMMSS(ms = 0) {
  if (!ms) {
    ms = new Date().getTime()
  }
  return new Date(ms).toLocaleTimeString()
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting killAll.js`)

  const scriptToRunAfter = ns.args[0]
  const hostname = ns.getHostname()

  if (hostname !== 'home') {
    throw new Error('Run the script from home')
  }

  const serverMap = getItem(settings.keys.serverMap)

  if (!serverMap || serverMap.lastUpdate < new Date().getTime() - settings.mapRefreshInterval) {
    ns.tprint(`[${localeHHMMSS()}] Spawning spider.js`)
    if (scriptToRunAfter) {
      ns.spawn('spider.js', 1, scriptToRunAfter)
    } else {
      ns.spawn('spider.js', 1, 'overlapBatchController.js')
    }
    return
  }

  for (let i = 0; i < scriptsToKill.length; i++) {
    await ns.scriptKill(scriptsToKill[i], 'home')
  }

  const killableServers = Object.keys(serverMap.servers)
    .filter((host) => ns.serverExists(host))
    .filter((host) => host !== 'home')

  for (let i = 0; i < killableServers.length; i++) {
    await ns.killall(killableServers[i])
  }

  ns.tprint(`[${localeHHMMSS()}] All processes killed`)

  if (scriptToRunAfter) {
    ns.tprint(`[${localeHHMMSS()}] Spawning ${scriptToRunAfter}`)
    ns.spawn(scriptToRunAfter, 1)
  } else {
    ns.tprint(`[${localeHHMMSS()}] Spawning overlapBatchController.js`)
    ns.spawn('overlapBatchController.js', 1)
  }
}