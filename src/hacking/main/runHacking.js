function localeHHMMSS(ms = 0) {
  if (!ms) {
    ms = new Date().getTime()
  }

  return new Date(ms).toLocaleTimeString()
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting runHacking.js`)

  let hostname = ns.getHostname()

  if (hostname !== 'home') {
    throw new Exception('Run the script from home')
  }

  const homeRam = ns.getServerMaxRam('home')

  if (homeRam >= 32) {
    ns.tprint(`[${localeHHMMSS()}] Spawning spider.js`)
    await ns.run('/hacking/main/spider.js', 1, '/hacking/main/mainHack.js')
    await ns.sleep(3000)
    ns.tprint(`[${localeHHMMSS()}] Spawning playerServers.js`)
    ns.spawn('/hacking/main/playerServers.js', 1)
  } else {
    ns.tprint(`[${localeHHMMSS()}] Spawning spider.js`)
    ns.spawn('/hacking/main/spider.js', 1, '/hacking/main/mainHack.js')
  }
}
