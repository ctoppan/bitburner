const settings = {
  maxPlayerServers: 25,
  minGbRam: 64,
  totalMoneyAllocation: 0.9,
  minUpgradeMultiplier: 2,
  loopSleepMs: 5123,

<<<<<<< HEAD
  // Fallback only when Singularity home-upgrade cost APIs are unavailable.
  targetHomeRamCost: 316.788e9,
  targetHomeCoreCost: 421.875e9,
=======
  // Pre-Singularity fallback for home upgrades:
  // Update these to the next visible costs from the Home screen after each purchase.
  targetHomeRamCost: 316.788e15,
  targetHomeCoreCost: 421.875e15,
>>>>>>> bf1671abcf49c15a03be46d532777b0bf4081580

  // Prefer RAM unless cores are much cheaper
  preferHomeRamOverCores: true,
  coreCostVsRamCostThreshold: 0.6,

  // Keep a little extra above the chosen target so spenders do not
  // hover right below your goal.
  homeReserveBufferMultiplier: 1.1,

  // Manual home-upgrade reminders are disabled by default to avoid repeated popup spam.
  canAffordReminderMs: 60000,
  enableHomeUpgradeReminder: false,

  keys: {
    serverMap: 'BB_SERVER_MAP',
  },
};

function getItem(key) {
  const item = localStorage.getItem(key);
  return item ? JSON.parse(item) : undefined;
}

function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

function createUUID() {
  let dt = Date.now();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (dt + Math.random() * 16) % 16 | 0;
    dt = Math.floor(dt / 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getSingularity(ns) {
  try {
    return ns.singularity ?? null;
  } catch {
    return null;
  }
}

function ensureServerMap() {
  let serverMap = getItem(settings.keys.serverMap);
  if (!serverMap || typeof serverMap !== 'object') {
    serverMap = {
      lastUpdate: Date.now(),
      servers: {},
    };
  }
  if (!serverMap.servers || typeof serverMap.servers !== 'object') {
    serverMap.servers = {};
  }
  return serverMap;
}

function updateServer(ns, serverMap, host) {
  if (!ns.serverExists(host)) return;

  serverMap.servers[host] = {
    host,
    ports: ns.getServerNumPortsRequired(host),
    hackingLevel: ns.getServerRequiredHackingLevel(host),
    maxMoney: ns.getServerMaxMoney(host),
    growth: ns.getServerGrowth(host),
    minSecurityLevel: ns.getServerMinSecurityLevel(host),
    baseSecurityLevel: ns.getServerBaseSecurityLevel(host),
    ram: ns.getServerMaxRam(host),
    connections: ['home'],
    parent: 'home',
    children: [],
  };

  for (const hostname of Object.keys(serverMap.servers)) {
    if (!ns.serverExists(hostname)) {
      delete serverMap.servers[hostname];
    }
  }

  serverMap.lastUpdate = Date.now();
  setItem(settings.keys.serverMap, serverMap);
}

function removeMissingServers(ns, serverMap) {
  for (const hostname of Object.keys(serverMap.servers)) {
    if (!ns.serverExists(hostname)) {
      delete serverMap.servers[hostname];
    }
  }
  serverMap.lastUpdate = Date.now();
  setItem(settings.keys.serverMap, serverMap);
}

function getPurchasedServers(ns) {
  const purchasedServers = ns.getPurchasedServers();

  purchasedServers.sort((a, b) => {
    const ramDiff = ns.getServerMaxRam(a) - ns.getServerMaxRam(b);
    if (ramDiff !== 0) return ramDiff;
    return a.localeCompare(b);
  });

  return purchasedServers;
}

function getDynamicHomeUpgradeCosts(ns) {
  const singularity = getSingularity(ns);
  let ramCost = settings.targetHomeRamCost;
  let coreCost = settings.targetHomeCoreCost;

  try {
    if (singularity && typeof singularity.getUpgradeHomeRamCost === 'function') {
      const value = singularity.getUpgradeHomeRamCost();
      if (typeof value === 'number' && isFinite(value) && value > 0) {
        ramCost = value;
      }
    }
  } catch {}

  try {
    if (singularity && typeof singularity.getUpgradeHomeCoresCost === 'function') {
      const value = singularity.getUpgradeHomeCoresCost();
      if (typeof value === 'number' && isFinite(value) && value > 0) {
        coreCost = value;
      }
    }
  } catch {}

  return { ramCost, coreCost };
}

function getHomeUpgradePlan(ns) {
  const { ramCost, coreCost } = getDynamicHomeUpgradeCosts(ns);

  let target = 'ram';
  let cost = ramCost;

  if (!settings.preferHomeRamOverCores) {
    if (coreCost < ramCost) {
      target = 'cores';
      cost = coreCost;
    }
    return { target, cost, ramCost, coreCost };
  }

  if (coreCost < ramCost * settings.coreCostVsRamCostThreshold) {
    target = 'cores';
    cost = coreCost;
  }

  return { target, cost, ramCost, coreCost };
}

function reserveForHome(ns) {
  const plan = getHomeUpgradePlan(ns);
  return Math.ceil(plan.cost * settings.homeReserveBufferMultiplier);
}

function moneyBudget(ns) {
  const money = ns.getServerMoneyAvailable('home');
  const plan = getHomeUpgradePlan(ns);

  if (money >= plan.cost) return 0;

  const reserve = reserveForHome(ns);
  const spendable = money - reserve;

  if (spendable <= 0) return 0;
  return spendable * settings.totalMoneyAllocation;
}

function highestAffordablePurchaseRam(ns, minRam, maxRam) {
  let ram = Math.max(settings.minGbRam, minRam);

  if (moneyBudget(ns) < ns.getPurchasedServerCost(ram)) {
    return 0;
  }

  while (ram * 2 <= maxRam && moneyBudget(ns) >= ns.getPurchasedServerCost(ram * 2)) {
    ram *= 2;
  }

  return ram;
}

function highestAffordableUpgradeRam(ns, host, currentRam, maxRam) {
  let candidate = currentRam * 2;
  let best = currentRam;

  while (candidate <= maxRam) {
    const cost = ns.getPurchasedServerUpgradeCost(host, candidate);
    if (moneyBudget(ns) >= cost) {
      best = candidate;
      candidate *= 2;
    } else {
      break;
    }
  }

  return best;
}

function formatMoney(ns, amount) {
  return ns.formatNumber(amount, 3);
}

let lastReminderAt = 0;

function maybeRemindHomeUpgrade(ns) {
  if (!settings.enableHomeUpgradeReminder) return false;

  const now = Date.now();
  if (now - lastReminderAt < settings.canAffordReminderMs) return false;

  const money = ns.getServerMoneyAvailable('home');
  const plan = getHomeUpgradePlan(ns);

  if (money >= plan.cost) {
    ns.print(
      `[${localeHHMMSS()}] HOME UPGRADE READY: Buy home ${plan.target} manually ` +
      `(targetCost=${formatMoney(ns, plan.cost)}, cash=${formatMoney(ns, money)})`
    );
    lastReminderAt = now;
    return true;
  }

  return false;
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting playerServers.js`);

  settings.maxPlayerServers = ns.getPurchasedServerLimit();

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home');
  }

  const maxGbRam = ns.getPurchasedServerMaxRam();
  let lastPlanSummary = '';

  while (true) {
    let didChange = false;
    let serverMap = ensureServerMap();
    removeMissingServers(ns, serverMap);

    const money = ns.getServerMoneyAvailable('home');
    const homePlan = getHomeUpgradePlan(ns);
    const reserve = reserveForHome(ns);
    const budget = moneyBudget(ns);

    maybeRemindHomeUpgrade(ns);

    const planSummary =
      `home target=${homePlan.target}, ` +
      `ramCost=${formatMoney(ns, homePlan.ramCost)}, ` +
      `coreCost=${formatMoney(ns, homePlan.coreCost)}, ` +
      `reserve=${formatMoney(ns, reserve)}, ` +
      `budget=${formatMoney(ns, budget)}, ` +
      `money=${formatMoney(ns, money)}`;

    if (planSummary !== lastPlanSummary) {
      ns.tprint(`[${localeHHMMSS()}] ${planSummary}`);
      lastPlanSummary = planSummary;
    }

    let purchasedServers = getPurchasedServers(ns);

    if (budget <= 0) {
      await ns.sleep(settings.loopSleepMs);
      continue;
    }

    if (purchasedServers.length < settings.maxPlayerServers) {
      const smallestCurrentServer = purchasedServers.length
        ? ns.getServerMaxRam(purchasedServers[0])
        : settings.minGbRam;

      const targetRam = highestAffordablePurchaseRam(
        ns,
        Math.max(settings.minGbRam, smallestCurrentServer),
        maxGbRam
      );

      if (targetRam > 0 && budget >= ns.getPurchasedServerCost(targetRam)) {
        let hostname = `pserv-${targetRam}-${createUUID()}`;
        hostname = ns.purchaseServer(hostname, targetRam);

        if (hostname) {
          ns.tprint(
            `[${localeHHMMSS()}] Bought new server: ${hostname} (${ns.getServerMaxRam(hostname)} GB)`
          );
          serverMap = ensureServerMap();
          updateServer(ns, serverMap, hostname);
          didChange = true;
        }
      }
    } else {
      purchasedServers = getPurchasedServers(ns);
      if (purchasedServers.length === 0) {
        await ns.sleep(settings.loopSleepMs);
        continue;
      }

      const smallestServer = purchasedServers[0];
      const currentRam = ns.getServerMaxRam(smallestServer);

      if (currentRam >= maxGbRam) {
        ns.tprint(`[${localeHHMMSS()}] All servers maxxed. Exiting.`);
        ns.exit();
        return;
      }

      const targetRam = highestAffordableUpgradeRam(ns, smallestServer, currentRam, maxGbRam);

      if (
        targetRam > currentRam &&
        targetRam >= currentRam * settings.minUpgradeMultiplier
      ) {
        const usedRam = ns.getServerUsedRam(smallestServer);
        if (usedRam > 0) {
          await ns.killall(smallestServer);
          await ns.sleep(50);
        }

        const ok = ns.upgradePurchasedServer(smallestServer, targetRam);
        if (ok) {
          ns.tprint(
            `[${localeHHMMSS()}] Upgraded: ${smallestServer} (${currentRam} GB -> ${targetRam} GB)`
          );
          serverMap = ensureServerMap();
          updateServer(ns, serverMap, smallestServer);
          didChange = true;
        }
      }
    }

    await ns.sleep(didChange ? 250 : settings.loopSleepMs);
  }
}
