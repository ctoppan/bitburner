/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("scan");
  ns.disableLog("getHackingLevel");
  ns.disableLog("getServerRequiredHackingLevel");
  ns.disableLog("hasRootAccess");

  const targets = [
    { server: "CSEC", faction: "CyberSec" },
    { server: "avmnite-02h", faction: "NiteSec" },
    { server: "I.I.I.I", faction: "The Black Hand" },
    { server: "run4theh111z", faction: "BitRunners" },
    { server: "fulcrumassets", faction: "Fulcrum Secret Technologies" },
  ];

  const network = scanAll(ns);
  const paths = buildPaths(ns, "home");
  const level = ns.getHackingLevel();
  const invitations = getInvitations(ns);

  const ready = [];
  const later = [];
  const done = [];

  for (const entry of targets) {
    const target = entry.server;

    if (!network.has(target)) {
      later.push({
        ...entry,
        reason: "not found on network yet",
      });
      continue;
    }

    const server = ns.getServer(target);
    const reqHack = ns.getServerRequiredHackingLevel(target);
    const hasRoot = ns.hasRootAccess(target);
    const backdoorInstalled = !!server.backdoorInstalled;
    const path = paths[target] || [];
    const connectChain = ["home", ...path].map((s) => `connect ${s}`).join("; ");
    const command = `${connectChain}; backdoor`;

    const info = {
      ...entry,
      reqHack,
      hasRoot,
      backdoorInstalled,
      path,
      command,
      invited: invitations.includes(entry.faction),
    };

    if (backdoorInstalled) {
      done.push({
        ...info,
        reason: info.invited ? "backdoor installed, invitation pending" : "backdoor already installed",
      });
    } else if (!hasRoot) {
      later.push({
        ...info,
        reason: `need root access (${server.numOpenPortsRequired} ports required)`,
      });
    } else if (level < reqHack) {
      later.push({
        ...info,
        reason: `need hack level ${reqHack}`,
      });
    } else {
      ready.push(info);
    }
  }

  const sortByReq = (a, b) => (a.reqHack ?? 999999) - (b.reqHack ?? 999999);
  ready.sort(sortByReq);
  later.sort(sortByReq);
  done.sort(sortByReq);

  ns.tprint("\n=== Backdoor Helper ===\n");
  ns.tprint(`Your hacking level: ${level}`);
  ns.tprint(`Outstanding faction invites: ${invitations.length ? invitations.join(", ") : "none"}\n`);

  printSection(ns, "ALREADY DONE", done, (item) => {
    ns.tprint(`\nTarget: ${item.server}`);
    ns.tprint(`Faction: ${item.faction}`);
    ns.tprint(`Required hack: ${item.reqHack}`);
    if (item.path.length > 0) ns.tprint(`Path: home -> ${item.path.join(" -> ")}`);
    ns.tprint(`Status: ${item.reason}`);
    if (item.invited) ns.tprint("Note: you can join from the Factions menu now.");
  });

  printSection(ns, "READY NOW", ready, (item) => {
    ns.tprint(`\nTarget: ${item.server}`);
    ns.tprint(`Faction: ${item.faction}`);
    ns.tprint(`Required hack: ${item.reqHack}`);
    ns.tprint(`Path: home -> ${item.path.join(" -> ")}`);
    ns.tprint(`Command:\n${item.command}\n`);
  });

  printSection(ns, "NOT READY YET", later, (item) => {
    ns.tprint(`\nTarget: ${item.server}`);
    ns.tprint(`Faction: ${item.faction}`);
    if (item.reqHack !== undefined) ns.tprint(`Required hack: ${item.reqHack}`);
    if (item.path && item.path.length > 0) ns.tprint(`Path: home -> ${item.path.join(" -> ")}`);
    ns.tprint(`Reason: ${item.reason}`);
    if (item.command) ns.tprint(`Command:\n${item.command}\n`);
  });

  ns.tprint("=== CONDENSED CONNECTS ===");
  for (const item of done) {
    ns.tprint(`[DONE] ${item.server}: ${item.reason}`);
  }
  for (const item of ready) {
    ns.tprint(`[READY] ${item.server}: ${item.command}`);
  }
  for (const item of later) {
    ns.tprint(
      item.command
        ? `[LATER] ${item.server}: ${item.command}  // ${item.reason}`
        : `[LATER] ${item.server}: ${item.reason}`
    );
  }
}

function printSection(ns, title, items, printer) {
  ns.tprint(`=== ${title} ===`);
  if (items.length === 0) {
    ns.tprint("None\n");
    return;
  }
  for (const item of items) printer(item);
}

function getInvitations(ns) {
  try {
    if (ns.singularity?.checkFactionInvitations) {
      return ns.singularity.checkFactionInvitations();
    }
  } catch {
    // ignore if Singularity API is unavailable in this BitNode
  }
  return [];
}

function scanAll(ns) {
  const visited = new Set();
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();
    if (visited.has(host)) continue;
    visited.add(host);

    for (const neighbor of ns.scan(host)) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return visited;
}

function buildPaths(ns, start) {
  const paths = { [start]: [] };
  const queue = [start];

  while (queue.length > 0) {
    const node = queue.shift();
    for (const neighbor of ns.scan(node)) {
      if (paths[neighbor]) continue;
      paths[neighbor] = [...paths[node], neighbor];
      queue.push(neighbor);
    }
  }

  return paths;
}