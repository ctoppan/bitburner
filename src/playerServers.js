const settings = {
  maxPlayerServers: 25,
  gbRamCost: 55000,
  maxGbRam: 1048576,
  minGbRam: 64,
  totalMoneyAllocation: 0.9,
  actions: {
    BUY: "buy",
    UPGRADE: "upgrade",
  },
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

function removeServer(serverMap, host) {
  if (serverMap?.servers?.[host]) {
    delete serverMap.servers[host];
    serverMap.lastUpdate = Date.now();
    setItem(settings.keys.serverMap, serverMap);
  }
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

function moneyBudget(ns) {
  return ns.getServerMoneyAvailable("home") * settings.totalMoneyAllocation;
}

function maxAffordableRam(ns, startingRam, maxRam) {
  let ram = Math.max(settings.minGbRam, startingRam);

  while (ram * 2 <= maxRam && moneyBudget(ns) >= ns.getPurchasedServerCost(ram * 2)) {
    ram *= 2;
  }

  return Math.min(ram, maxRam);
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting playerServers.js`);

  settings.maxGbRam = ns.getPurchasedServerMaxRam();
  settings.maxPlayerServers = ns.getPurchasedServerLimit();

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  while (true) {
    let didChange = false;
    let serverMap = ensureServerMap();
    let purchasedServers = getPurchasedServers(ns);

    const action =
      purchasedServers.length < settings.maxPlayerServers
        ? settings.actions.BUY
        : settings.actions.UPGRADE;

    if (action === settings.actions.BUY) {
      const smallestCurrentServer = purchasedServers.length
        ? ns.getServerMaxRam(purchasedServers[0])
        : 0;

      let targetRam = Math.max(settings.minGbRam, smallestCurrentServer || settings.minGbRam);

      if (targetRam === settings.minGbRam) {
        // Try to buy the largest uniform server size we can reasonably sustain.
        while (
          targetRam * 2 <= settings.maxGbRam &&
          moneyBudget(ns) >= ns.getPurchasedServerCost(targetRam * 2) * settings.maxPlayerServers
        ) {
          targetRam *= 2;
        }
      } else {
        targetRam = maxAffordableRam(ns, targetRam, settings.maxGbRam);
      }

      if (moneyBudget(ns) >= ns.getPurchasedServerCost(targetRam)) {
        let hostname = `pserv-${targetRam}-${createUUID()}`;
        hostname = ns.purchaseServer(hostname, targetRam);

        if (hostname) {
          ns.tprint(
            `[${localeHHMMSS()}] Bought new server: ${hostname} (${ns.getServerMaxRam(hostname)} GB)`
          );
          updateServer(ns, serverMap, hostname);
          didChange = true;
        }
      }
    } else {
      purchasedServers = getPurchasedServers(ns);
      if (purchasedServers.length === 0) {
        await ns.sleep(5000);
        continue;
      }

      const smallestServer = purchasedServers[0];
      const largestServer = purchasedServers[purchasedServers.length - 1];

      const smallestCurrentServer = Math.max(
        ns.getServerMaxRam(smallestServer),
        settings.minGbRam
      );

      const biggestCurrentServer = ns.getServerMaxRam(largestServer);
      let targetRam = biggestCurrentServer;

      if (smallestCurrentServer >= settings.maxGbRam) {
        ns.tprint(`[${localeHHMMSS()}] All servers maxxed. Exiting.`);
        ns.exit();
        return;
      }

      if (smallestCurrentServer === biggestCurrentServer) {
        // If the fleet is uniform, jump as high as we can afford.
        while (
          targetRam * 2 <= settings.maxGbRam &&
          moneyBudget(ns) >= ns.getPurchasedServerCost(targetRam * 2)
        ) {
          targetRam *= 2;
        }
      } else {
        // If the fleet is mixed, bring the smallest ones up toward the top tier.
        targetRam = biggestCurrentServer;
      }

      targetRam = Math.min(targetRam, settings.maxGbRam);

      while (true) {
        purchasedServers = getPurchasedServers(ns);
        if (purchasedServers.length === 0) break;

        const candidate = purchasedServers[0];
        const currentRam = ns.getServerMaxRam(candidate);

        if (targetRam <= currentRam) break;
        if (moneyBudget(ns) < ns.getPurchasedServerCost(targetRam)) break;

        const usedRam = ns.getServerUsedRam(candidate);
        if (usedRam > 0) {
          await ns.killall(candidate);
          await ns.sleep(50);
        }

        const deleted = ns.deleteServer(candidate);
        if (!deleted) break;

        removeServer(serverMap, candidate);

        let hostname = `pserv-${targetRam}-${createUUID()}`;
        hostname = ns.purchaseServer(hostname, targetRam);

        if (!hostname) break;

        ns.tprint(
          `[${localeHHMMSS()}] Upgraded: ${candidate} into server: ${hostname} (${targetRam} GB)`
        );

        serverMap = ensureServerMap();
        updateServer(ns, serverMap, hostname);
        didChange = true;

        // Small delay so other scripts can react to changed fleet.
        await ns.sleep(25);
      }
    }

    if (!didChange) {
      await ns.sleep(5123);
    } else {
      await ns.sleep(250);
    }
  }
}