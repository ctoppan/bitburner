import { settings, setItem } from "/utils/common.js";

const hackPrograms = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];

function getPlayerDetails(ns) {
  let portHacks = 0;

  for (const hackProgram of hackPrograms) {
    if (ns.fileExists(hackProgram, "home")) {
      portHacks += 1;
    }
  }

  return {
    hackingLevel: ns.getHackingLevel(),
    portHacks,
  };
}

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

function openPorts(ns, host) {
  if (ns.fileExists("BruteSSH.exe", "home")) {
    try {
      ns.brutessh(host);
    } catch {}
  }

  if (ns.fileExists("FTPCrack.exe", "home")) {
    try {
      ns.ftpcrack(host);
    } catch {}
  }

  if (ns.fileExists("relaySMTP.exe", "home")) {
    try {
      ns.relaysmtp(host);
    } catch {}
  }

  if (ns.fileExists("HTTPWorm.exe", "home")) {
    try {
      ns.httpworm(host);
    } catch {}
  }

  if (ns.fileExists("SQLInject.exe", "home")) {
    try {
      ns.sqlinject(host);
    } catch {}
  }
}

/** @param {NS} ns **/
export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting spider.js`);

  const scriptToRunAfter = String(ns.args[0] ?? "");
  const scriptArgs = ns.args.slice(1);

  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const serverMap = { servers: {}, lastUpdate: Date.now() };
  const scanArray = ["home"];

  while (scanArray.length) {
    const host = scanArray.shift();

    serverMap.servers[host] = {
      host,
      ports: ns.getServerNumPortsRequired(host),
      hackingLevel: ns.getServerRequiredHackingLevel(host),
      maxMoney: ns.getServerMaxMoney(host),
      growth: ns.getServerGrowth(host),
      minSecurityLevel: ns.getServerMinSecurityLevel(host),
      baseSecurityLevel: ns.getServerBaseSecurityLevel(host),
      ram: ns.getServerMaxRam(host),
      files: ns.ls(host),
    };

    const playerDetails = getPlayerDetails(ns);

    if (!ns.hasRootAccess(host)) {
      if (
        serverMap.servers[host].ports <= playerDetails.portHacks &&
        serverMap.servers[host].hackingLevel <= playerDetails.hackingLevel
      ) {
        openPorts(ns, host);

        try {
          ns.nuke(host);
        } catch {}
      }
    }

    const connections = ns.scan(host) || ["home"];
    serverMap.servers[host].connections = connections;

    for (const nextHost of connections) {
      if (!serverMap.servers[nextHost]) {
        scanArray.push(nextHost);
      }
    }
  }

  let hasAllParents = false;

  while (!hasAllParents) {
    hasAllParents = true;

    for (const hostname of Object.keys(serverMap.servers)) {
      const server = serverMap.servers[hostname];

      if (!server.parent) hasAllParents = false;

      if (hostname === "home") {
        server.parent = "home";
        server.children = server.children ? server.children : [];
      }

      if (hostname.includes("pserv-")) {
        server.parent = "home";
        server.children = [];

        if (serverMap.servers[server.parent].children) {
          serverMap.servers[server.parent].children.push(hostname);
        } else {
          serverMap.servers[server.parent].children = [hostname];
        }
      }

      if (!server.parent) {
        if (server.connections.length === 1) {
          server.parent = server.connections[0];
          server.children = [];

          if (serverMap.servers[server.parent].children) {
            serverMap.servers[server.parent].children.push(hostname);
          } else {
            serverMap.servers[server.parent].children = [hostname];
          }
        } else {
          if (!server.children) {
            server.children = [];
          }

          if (server.children.length) {
            const parent = server.connections.filter((name) => !server.children.includes(name));

            if (parent.length === 1) {
              server.parent = parent.shift();

              if (serverMap.servers[server.parent].children) {
                serverMap.servers[server.parent].children.push(hostname);
              } else {
                serverMap.servers[server.parent].children = [hostname];
              }
            }
          }
        }
      }
    }
  }

  setItem(settings().keys.serverMap, serverMap);

  if (!scriptToRunAfter) {
    ns.tprint(`[${localeHHMMSS()}] Spawning mainHack.js`);
    ns.spawn("/hacking/main/mainHack.js", 1);
  } else {
    ns.tprint(
      `[${localeHHMMSS()}] Spawning ${scriptToRunAfter}${scriptArgs.length ? ` ${scriptArgs.join(" ")}` : ""}`
    );
    ns.spawn(scriptToRunAfter, 1, ...scriptArgs);
  }
}