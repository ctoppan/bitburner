const settings = {
  maxPlayerServers: 25,
  minGbRam: 64,
  totalMoneyAllocation: 0.9,
  minUpgradeMultiplier: 2,
  loopSleepMs: 5123,

  // Pre-Singularity fallback for home upgrades:
  // Set these to the next visible costs from the Home screen.
  targetHomeRamCost: 316.788e9,
  targetHomeCoreCost: 421.875e9,

  // Prefer RAM unless cores are much cheaper
  preferHomeRamOverCores: true,
  coreCostVsRamCostThreshold: 0.6,

  // Keep a little extra above the chosen target so pserv spending
  // does not stall just under the amount you want to save.
  homeReserveBufferMultiplier: 1.1,

  // Reminder behavior
  canAffordReminderMs: 60000,

  keys: {
    serverMap: "BB_SERVER_MAP",
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
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (dt + Math.random() * 16) % 16 | 0;
    dt = Math.floor(dt / 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function ensureServerMap() {
  let serverMap = getItem(settings.keys.serverMap);
  if (!serverMap || typeof serverMap !== "object") {
    serverMap = {
      lastUpdate: Date.now(),
      servers: {},
    };
  }
  if (!serverMap.servers || typeof serverMap.servers !== "object") {
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
    connections: ["home"],
    parent: "home",
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

function getHomeUpgradePlan() {
  const ramCost = settings.targetHomeRamCost;
  const coreCost = settings.targetHomeCoreCost;

  let target = "ram";
  let cost = ramCost;

  if (!settings.preferHomeRamOverCores) {
    if (coreCost < ramCost) {
      target = "cores";
      cost = coreCost;
    }
    return { target, cost, ramCost, coreCost };
  }

  if (coreCost < ramCost * settings.coreCostVsRamCostThreshold) {
    target = "cores";
    cost = coreCost;
  }

  return { target, cost, ramCost, coreCost };
}

function reserveForHome() {
  const plan = getHomeUpgradePlan();
  return Math.ceil(plan.cost * settings.homeReserveBufferMultiplier);
}

function moneyBudget(ns) {
  const money = ns.getServerMoneyAvailable("home");
  const reserve = reserveForHome();
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
  const now = Date.now();
  if (now - lastReminderAt < settings.canAffordReminderMs) return false;

  const money = ns.getServerMoneyAvailable("home");
  const plan = getHomeUpgradePlan();

  if (money >= plan.cost) {
    ns.tprint(
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

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const maxGbRam = ns.getPurchasedServerMaxRam();
  let lastPlanSummary = "";

  while (true) {
    let didChange = false;
    let serverMap = ensureServerMap();
    removeMissingServers(ns, serverMap);

    const money = ns.getServerMoneyAvailable("home");
    const homePlan = getHomeUpgradePlan();
    const reserve = reserveForHome();
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