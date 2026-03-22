/** @param {NS} ns **/
export async function main(ns) {
  const target = ns.args[0];
  const hackPct = Number(ns.args[1] ?? 0.05);
  const spacer = Number(ns.args[2] ?? 200);

  if (!target) {
    ns.tprint("Usage: run batchController.js <target> [hackPct=0.05] [spacer=200]");
    return;
  }

  const scripts = ["batchHack.js", "batchGrow.js", "batchWeaken.js"];
  for (const script of scripts) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`Missing ${script} on home`);
      return;
    }
  }

  ns.disableLog("ALL");

  while (true) {
    const sec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    if (sec > minSec + 0.5 || money < maxMoney * 0.99) {
      ns.print(`Target not prepped: ${target}`);
      ns.print(`Security: ${sec.toFixed(2)} / ${minSec.toFixed(2)}`);
      ns.print(`Money: ${ns.formatNumber(money, 2)} / ${ns.formatNumber(maxMoney, 2)}`);
      ns.print("Run prepTarget.js first or let another prep system finish.");
      await ns.sleep(5000);
      continue;
    }

    const hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, maxMoney * hackPct)));
    const hackSec = ns.hackAnalyzeSecurity(hackThreads, target);

    const growThreads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - hackPct)));
    const growSec = ns.growthAnalyzeSecurity(growThreads, target);

    const weaken1Threads = Math.ceil(hackSec / 0.05);
    const weaken2Threads = Math.ceil(growSec / 0.05);

    const hackTime = ns.getHackTime(target);
    const growTime = ns.getGrowTime(target);
    const weakenTime = ns.getWeakenTime(target);

    const landing0 = Date.now() + weakenTime + 2000;
    const hackDelay = Math.max(0, landing0 - spacer * 3 - Date.now() - hackTime);
    const weaken1Delay = Math.max(0, landing0 - spacer * 2 - Date.now() - weakenTime);
    const growDelay = Math.max(0, landing0 - spacer * 1 - Date.now() - growTime);
    const weaken2Delay = Math.max(0, landing0 - Date.now() - weakenTime);

    const plan = [
      ["batchHack.js", hackThreads, hackDelay],
      ["batchWeaken.js", weaken1Threads, weaken1Delay],
      ["batchGrow.js", growThreads, growDelay],
      ["batchWeaken.js", weaken2Threads, weaken2Delay],
    ];

    const hosts = getUsableHosts(ns, scripts);
    if (hosts.length === 0) {
      ns.print("No usable hosts.");
      await ns.sleep(5000);
      continue;
    }

    const ok = await deployBatch(ns, hosts, target, plan);
    if (!ok) {
      ns.print("Not enough RAM for full batch. Waiting...");
      await ns.sleep(5000);
      continue;
    }

    ns.clearLog();
    ns.print(`Target: ${target}`);
    ns.print(`Hack%: ${(hackPct * 100).toFixed(1)}%`);
    ns.print(`Threads: H ${hackThreads} | W1 ${weaken1Threads} | G ${growThreads} | W2 ${weaken2Threads}`);
    ns.print(`Times: H ${fmt(hackTime)} | G ${fmt(growTime)} | W ${fmt(weakenTime)}`);
    ns.print(`Next batch launched.`);

    await ns.sleep(spacer * 4 + 500);
  }
}

function getUsableHosts(ns, scripts) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  const hosts = [];

  while (queue.length > 0) {
    const host = queue.shift();

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }

    if (!ns.hasRootAccess(host)) continue;
    if (ns.getServerMaxRam(host) < 2) continue;

    for (const script of scripts) {
      ns.scp(script, host, "home");
    }

    hosts.push(host);
  }

  hosts.sort((a, b) => freeRam(ns, b) - freeRam(ns, a));
  return hosts;
}

function freeRam(ns, host) {
  const reserve = host === "home" ? 32 : 0;
  return Math.max(0, ns.getServerMaxRam(host) - ns.getServerUsedRam(host) - reserve);
}

async function deployBatch(ns, hosts, target, plan) {
  const remaining = plan.map(([script, threads, delay]) => ({
    script,
    threads,
    delay,
    ram: ns.getScriptRam(script, "home"),
  }));

  for (const job of remaining) {
    let need = job.threads;

    for (const host of hosts) {
      const available = Math.floor(freeRam(ns, host) / job.ram);
      if (available <= 0) continue;

      const use = Math.min(need, available);
      if (use > 0) {
        ns.exec(job.script, host, use, target, job.delay);
        need -= use;
      }

      if (need <= 0) break;
    }

    if (need > 0) {
      return false;
    }
  }

  return true;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
}