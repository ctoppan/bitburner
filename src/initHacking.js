const baseUrl = 'https://raw.githubusercontent.com/ctoppan/bitburner/master/src/'

// Toggle which hacking system to run
const USE_OVERLAP_BATCH = true

const filesToDownload = [
  // core
  'common.js',
  'spider.js',
  'find.js',

  // legacy system (kept for fallback)
  'mainHack.js',
  'grow.js',
  'hack.js',
  'weaken.js',
  'playerServers.js',
  'runHacking.js',

  // management
  'killAll.js',

  // batch system
  'prepTarget.js',
  'batchHack.js',
  'batchGrow.js',
  'batchWeaken.js',
  'batchController.js',
  'overlapBatchController.js',
]

const valuesToRemove = ['BB_SERVER_MAP']

function localeHHMMSS(ms = 0) {
  if (!ms) ms = new Date().getTime()
  return new Date(ms).toLocaleTimeString()
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting initHacking.js`)

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home')
  }

  // Download everything fresh
  for (const filename of filesToDownload) {
    const path = baseUrl + filename

    await ns.scriptKill(filename, 'home')
    await ns.rm(filename)
    await ns.sleep(50)

    ns.tprint(`[${localeHHMMSS()}] Downloading ${filename}`)
    const ok = await ns.wget(path + '?ts=' + Date.now(), filename)

    if (!ok) {
      ns.tprint(`[WARN] Failed to download ${filename}`)
    }
  }

  // Clear cached map so spider rebuilds
  valuesToRemove.forEach((key) => localStorage.removeItem(key))

  // Decide what system to run
  let nextScript = 'runHacking.js'
  if (USE_OVERLAP_BATCH) {
    nextScript = 'overlapBatchController.js'
  }

  ns.tprint(`[${localeHHMMSS()}] Starting killAll.js → ${nextScript}`)
  ns.run('killAll.js', 1, nextScript)

  // Give killAll/spider/startup chain time to settle
  await ns.sleep(15000)

  if (!ns.isRunning('playerServers.js', 'home')) {
    ns.tprint(`[${localeHHMMSS()}] Starting playerServers.js`)
    ns.run('playerServers.js', 1)
  }
}