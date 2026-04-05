/** @param {NS} ns **/
export async function main(ns) {
  const XP_SCRIPT = "xp/xpDistributor.js";
  const MONEY_SCRIPT = "hacking/batch/overlapBatchController.js";

  // Tuning knobs
  const HOME_RESERVE_XP = 64;
  const HOME_RESERVE_MONEY = 128;

  const XP_HACK_THRESHOLD = 2200;     // below this, favor XP mode
  const DAEDALUS_HACK_GOAL = 2500;    // invite target
  const MIN_MONEY_SERVER = 5_000_000; // ignore tiny servers for money mode
  const MAX_SEC_GAP = 25;             // ignore very unprepped targets
  const LOOP_MS = 30_000;             // reevaluate every 30s

  const manualTarget = ns.args[0] ? String(ns.args[0]) : null;
  const forceMode = ns.args[1] ? String(ns.args[1]).toLowerCase() : null; // "xp" or "money"

  ns.disableLog("ALL");

  while (true) {
    try {
      const rooted = getRootedServers(ns);
      const player = ns.getPlayer();
      const hack = ns.getHackingLevel();

      const moneyTarget = manualTarget || pickBestMoneyTarget(ns, rooted, player);
      const xpTarget = pickBestXpTarget(ns, rooted, player) || "n00dles";

      let mode = "money";
      if (forceMode === "xp" || forceMode === "money") {
        mode = forceMode;
      } else {
        mode = decideMode(ns, hack, moneyTarget);
      }

      const currentMoneyPid = findRunningByFile(ns, MONEY_SCRIPT, "home");
      const currentXpPid = findRunningByFile(ns, XP_SCRIPT, "home");

      if (mode === "xp") {
        if (currentMoneyPid !== 0) {
          ns.kill(currentMoneyPid);
          ns.tprint(`[smart] Stopped money controller PID ${currentMoneyPid}`);
        }

        if (currentXpPid === 0) {
          const pid = ns.run(XP_SCRIPT, 1, xpTarget);
          ns.tprint(`[smart] XP mode -> ${xpTarget} (pid ${pid})`);
        } else {
          ns.tprint(`[smart] XP mode already running -> ${xpTarget}`);
        }
      } else {
        if (currentXpPid !== 0) {
          ns.kill(currentXpPid);
          ns.tprint(`[smart] Stopped XP distributor PID ${currentXpPid}`);
        }

        const desiredArgs = buildMoneyArgs(ns, moneyTarget, hack);
        const shouldRestart = !isSameMoneyRun(ns, MONEY_SCRIPT, desiredArgs);

        if (shouldRestart && currentMoneyPid !== 0) {
          ns.kill(currentMoneyPid);
          await ns.sleep(200);
        }

        if (shouldRestart || currentMoneyPid === 0) {
          const pid = ns.run(MONEY_SCRIPT, 1, ...desiredArgs);
          ns.tprint(`[smart] MONEY mode -> ${moneyTarget} args=${JSON.stringify(desiredArgs)} pid=${pid}`);
        } else {
          ns.tprint(`[smart] MONEY mode already running -> ${moneyTarget}`);
        }
      }
    } catch (err) {
      ns.tprint(`[smart] ERROR: ${String(err)}`);
    }

    await ns.sleep(LOOP_MS);
  }
}

function decideMode(ns, hack, moneyTarget) {
  const moneyReady = moneyTarget && isMoneyTargetReadyEnough(ns, moneyTarget);

  // Favor XP below threshold, unless a very strong money target is ready.
  if (hack < 1800) return "xp";
  if (hack < 2200 && !moneyReady) return "xp";

  // Once close to Daedalus, favor money for the 100b push unless no good target exists.
  if (hack >= 2200 && moneyReady) return "money";

  return "xp";
}

function buildMoneyArgs(ns, target, hack) {
  // overlapBatchController.js usage from your earlier runs:
  // run overlapBatchController.js <hackPercent> <spacingMs> <homeReserveGB> <something> [target]
  //
  // We will use a slightly more aggressive config for money.
  let hackPct = 0.10;
  let spacing = 50;
  let reserve = 128;
  let extra = 20;

  if (hack >= 1500) hackPct = 0.15;
  if (hack >= 2200) hackPct = 0.20;
  if (hack >= 2600) hackPct = 0.25;

  if (target === "n00dles") {
    // never use n00dles as real money target
    hackPct = 0.03;
    spacing = -1;
    reserve = 64;
    extra = 30;
  }

  return [hackPct, spacing, reserve, extra, target];
}

function pickBestXpTarget(ns, servers, player) {
  const candidates = servers
    .filter((s) => {
      if (!ns.hasRootAccess(s)) return false;
      if (ns.getServerRequiredHackingLevel(s) > player.skills.hacking) return false;
      return true;
    })
    .map((s) => {
      const minSec = ns.getServerMinSecurityLevel(s);
      const req = ns.getServerRequiredHackingLevel(s);
      const chance = ns.formulas?.hacking
        ? ns.formulas.hacking.hackChance(ns.getServer(s), player)
        : ns.hackAnalyzeChance(s);

      return { s, minSec, req, chance };
    })
    .sort((a, b) => {
      if (a.req !== b.req) return a.req - b.req;
      if (a.minSec !== b.minSec) return a.minSec - b.minSec;
      return b.chance - a.chance;
    });

  return candidates.length ? candidates[0].s : null;
}

function pickBestMoneyTarget(ns, servers, player) {
  const candidates = [];

  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    if (s === "home") continue;

    const req = ns.getServerRequiredHackingLevel(s);
    if (req > player.skills.hacking) continue;

    const maxMoney = ns.getServerMaxMoney(s);
    if (maxMoney < 5_000_000) continue;

    const minSec = ns.getServerMinSecurityLevel(s);
    const curSec = ns.getServerSecurityLevel(s);
    const secGap = curSec - minSec;
    if (secGap > 25) continue;

    let score = maxMoney / Math.max(1, minSec);

    const chance = ns.formulas?.hacking
      ? ns.formulas.hacking.hackChance(ns.getServer(s), player)
      : ns.hackAnalyzeChance(s);

    score *= Math.max(0.15, chance);

    // favor targets that are relatively ready
    const curMoney = ns.getServerMoneyAvailable(s);
    const moneyFrac = maxMoney > 0 ? curMoney / maxMoney : 0;
    score *= 0.5 + moneyFrac * 0.5;

    candidates.push({
      s,
      score,
      maxMoney,
      minSec,
      curSec,
      moneyFrac,
      chance,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates.length ? candidates[0].s : "n00dles";
}

function isMoneyTargetReadyEnough(ns, target) {
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);

  if (maxMoney <= 0) return false;

  const moneyFrac = curMoney / maxMoney;
  const secGap = curSec - minSec;

  return moneyFrac >= 0.60 && secGap <= 10;
}

function getRootedServers(ns) {
  const seen = new Set();
  const queue = ["home"];
  const out = [];

  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);

    for (const n of ns.scan(host)) {
      if (!seen.has(n)) queue.push(n);
    }
  }

  return out;
}

function findRunningByFile(ns, file, host = "home") {
  const procs = ns.ps(host);
  const found = procs.find((p) => p.filename === file);
  return found ? found.pid : 0;
}

function isSameMoneyRun(ns, file, desiredArgs, host = "home") {
  const procs = ns.ps(host);
  const proc = procs.find((p) => p.filename === file);
  if (!proc) return false;
  if (!proc.args || proc.args.length !== desiredArgs.length) return false;

  for (let i = 0; i < desiredArgs.length; i++) {
    if (String(proc.args[i]) !== String(desiredArgs[i])) return false;
  }
  return true;
}