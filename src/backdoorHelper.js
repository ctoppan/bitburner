/** @param {NS} ns **/
export async function main(ns) {
  const targets = [
    "CSEC",
    "avmnite-02h",
    "I.I.I.I",
    "run4theh111z",
    "fulcrumassets",
  ];

  const network = scanAll(ns);
  const paths = buildPaths(ns, "home");
  const level = ns.getHackingLevel();

  const ready = [];
  const later = [];

  for (const target of targets) {
    if (!network.has(target)) {
      later.push({
        target,
        reason: "not found on network yet",
      });
      continue;
    }

    const reqHack = ns.getServerRequiredHackingLevel(target);
    const hasRoot = ns.hasRootAccess(target);
    const path = paths[target] || [];
    const command = ["home", ...path].map((s) => `connect ${s}`).join("; ");

    const info = {
      target,
      reqHack,
      hasRoot,
      path,
      command,
    };

    if (!hasRoot) {
      later.push({
        ...info,
        reason: "no root access yet",
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

  ready.sort((a, b) => a.reqHack - b.reqHack);
  later.sort((a, b) => {
    const aReq = a.reqHack ?? 999999;
    const bReq = b.reqHack ?? 999999;
    return aReq - bReq;
  });

  ns.tprint("\n=== Backdoor Helper ===\n");
  ns.tprint(`Your hacking level: ${level}\n`);

  ns.tprint("=== READY NOW ===");
  if (ready.length === 0) {
    ns.tprint("None\n");
  } else {
    for (const item of ready) {
      ns.tprint(`\nTarget: ${item.target}`);
      ns.tprint(`Required hack: ${item.reqHack}`);
      ns.tprint(`Path: home -> ${item.path.join(" -> ")}`);
      ns.tprint(`Command:\n${item.command}; backdoor\n`);
    }
  }

  ns.tprint("=== NOT READY YET ===");
  if (later.length === 0) {
    ns.tprint("None\n");
  } else {
    for (const item of later) {
      ns.tprint(`\nTarget: ${item.target}`);
      if (item.reqHack !== undefined) {
        ns.tprint(`Required hack: ${item.reqHack}`);
      }
      if (item.path && item.path.length > 0) {
        ns.tprint(`Path: home -> ${item.path.join(" -> ")}`);
      }
      ns.tprint(`Reason: ${item.reason}`);
      if (item.command) {
        ns.tprint(`Command:\n${item.command}; backdoor\n`);
      }
    }
  }

  ns.tprint("=== CONDENSED CONNECTS ===");

  if (ready.length === 0 && later.length === 0) {
    ns.tprint("None");
    return;
  }

  for (const item of ready) {
    ns.tprint(`[READY] ${item.target}: ${item.command}; backdoor`);
  }

  for (const item of later) {
    if (item.command) {
      ns.tprint(`[LATER] ${item.target}: ${item.command}; backdoor  // ${item.reason}`);
    } else {
      ns.tprint(`[LATER] ${item.target}: ${item.reason}`);
    }
  }
}

function scanAll(ns) {
  const visited = new Set();
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();
    if (visited.has(host)) continue;

    visited.add(host);

    for (const neighbor of ns.scan(host)) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

function buildPaths(ns, start) {
  const paths = {};
  const queue = [[start, []]];
  const visited = new Set();

  while (queue.length > 0) {
    const [node, path] = queue.shift();
    if (visited.has(node)) continue;

    visited.add(node);
    paths[node] = path;

    for (const neighbor of ns.scan(node)) {
      if (!visited.has(neighbor)) {
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }

  return paths;
}