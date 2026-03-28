/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const servers = discoverAllServers(ns).filter(s => s !== "home").sort();
  const hackLevel = ns.getHackingLevel();
  const openers = getAvailableOpeners(ns);

  const rooted = [];
  const unrooted = [];

  for (const host of servers) {
    const reqHack = ns.getServerRequiredHackingLevel(host);
    const reqPorts = ns.getServerNumPortsRequired(host);
    const hasRoot = ns.hasRootAccess(host);
    const maxMoney = ns.getServerMaxMoney(host);
    const maxRam = ns.getServerMaxRam(host);

    const hackOk = hackLevel >= reqHack;
    const portsOk = openers.count >= reqPorts;
    const rootableNow = !hasRoot && hackOk && portsOk;

    const row = {
      host,
      reqHack,
      reqPorts,
      maxMoney,
      maxRam,
      hackOk,
      portsOk,
      rootableNow,
    };

    if (hasRoot) rooted.push(row);
    else unrooted.push(row);
  }

  rooted.sort((a, b) => {
    if (b.maxMoney !== a.maxMoney) return b.maxMoney - a.maxMoney;
    return a.reqHack - b.reqHack;
  });

  unrooted.sort((a, b) => {
    if (a.rootableNow !== b.rootableNow) return a.rootableNow ? -1 : 1;
    if (a.reqHack !== b.reqHack) return a.reqHack - b.reqHack;
    return a.reqPorts - b.reqPorts;
  });

  ns.tprint("");
  ns.tprint("========== NETWORK STATUS ==========");
  ns.tprint(`Hack level: ${hackLevel}`);
  ns.tprint(`Port openers on home: ${openers.count} (${openers.names.join(", ") || "none"})`);
  ns.tprint(`Total discovered: ${servers.length}`);
  ns.tprint(`Rooted: ${rooted.length}`);
  ns.tprint(`Not rooted: ${unrooted.length}`);
  ns.tprint("");

  ns.tprint("----- ROOTED SERVERS -----");
  if (rooted.length === 0) {
    ns.tprint("None");
  } else {
    for (const s of rooted) {
      ns.tprint(
        fmtRootedLine(ns, s)
      );
    }
  }

  ns.tprint("");
  ns.tprint("----- NOT ROOTED YET -----");
  if (unrooted.length === 0) {
    ns.tprint("None");
  } else {
    for (const s of unrooted) {
      ns.tprint(
        fmtUnrootedLine(s)
      );
    }
  }

  ns.tprint("");
  ns.tprint("Legend:");
  ns.tprint("[NOW] = you can root it right now");
  ns.tprint("[LVL] = need more hacking level");
  ns.tprint("[PORT] = need more port openers");
}

function discoverAllServers(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();
    for (const neighbor of ns.scan(host)) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return [...seen];
}

function getAvailableOpeners(ns) {
  const exeNames = [
    "BruteSSH.exe",
    "FTPCrack.exe",
    "relaySMTP.exe",
    "HTTPWorm.exe",
    "SQLInject.exe",
  ];

  const names = exeNames.filter(name => ns.fileExists(name, "home"));
  return {
    count: names.length,
    names,
  };
}

function fmtRootedLine(ns, s) {
  const money = s.maxMoney > 0 ? ns.formatNumber(s.maxMoney, 2) : "0";
  const ram = s.maxRam > 0 ? `${ns.formatNumber(s.maxRam, 1)}GB` : "0GB";

  return [
    padRight(s.host, 22),
    `hack:${padLeft(String(s.reqHack), 4)}`,
    `ports:${padLeft(String(s.reqPorts), 1)}`,
    `money:${padLeft(money, 10)}`,
    `ram:${padLeft(ram, 8)}`
  ].join("  ");
}

function fmtUnrootedLine(s) {
  let tag = "[LVL]";
  if (s.rootableNow) tag = "[NOW]";
  else if (s.hackOk && !s.portsOk) tag = "[PORT]";
  else if (!s.hackOk && s.portsOk) tag = "[LVL]";
  else if (!s.hackOk && !s.portsOk) tag = "[LVL+PORT]";

  return [
    tag,
    padRight(s.host, 22),
    `hack:${padLeft(String(s.reqHack), 4)}`,
    `ports:${padLeft(String(s.reqPorts), 1)}`
  ].join("  ");
}

function padRight(str, len) {
  str = String(str);
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padLeft(str, len) {
  str = String(str);
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}