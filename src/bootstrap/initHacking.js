/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")

  const now = () => new Date().toLocaleTimeString()

  const orchestratorArgs = [0.03, 0.08, 1024, 30, 80, 2500, 15000]
  const orchestratorScript = "/bootstrap/hackOrchestrator.js"
  const killAllScript = "/hacking/main/killAll.js"

  ns.tprint(`[${now()}] Starting initHacking.js`)
  ns.tprint(`[${now()}] Repo sync already completed by start-download-only.js`)
  ns.tprint(
    `[${now()}] Starting killAll.js -> ${orchestratorScript} ${orchestratorArgs.join(" ")}`,
  )

  if (!ns.fileExists(killAllScript, "home")) {
    ns.tprint(`[${now()}] ERROR: Missing ${killAllScript}`)
    return
  }

  if (!ns.fileExists(orchestratorScript, "home")) {
    ns.tprint(`[${now()}] ERROR: Missing ${orchestratorScript}`)
    return
  }

  ns.spawn(killAllScript, 1, orchestratorScript, ...orchestratorArgs)
}
