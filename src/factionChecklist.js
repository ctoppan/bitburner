/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const player = ns.getPlayer();
  const joined = new Set(player.factions || []);
  const invitations = new Set(getInvitations(ns));
  const hack = ns.getHackingLevel();
  const money = player.money ?? ns.getServerMoneyAvailable("home");
  const city = player.city ?? "Unknown";
  const karma = ns.heart.break();
  const kills = player.numPeopleKilled ?? 0;
  const stats = getCombatStats(player);
  const augmentCount = getAugmentationCount(ns);
  const companyRep = getCompanyRepMap(ns);
  const backdoorMap = getBackdoorMap(ns, ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z", "fulcrumassets"]);
  const hacknet = getHacknetTotals(ns);
  const jobInfo = getJobInfo(player);

  const state = {
    joined,
    invitations,
    hack,
    money,
    city,
    karma,
    kills,
    stats,
    augmentCount,
    companyRep,
    backdoorMap,
    hacknet,
    jobInfo,
  };

  const factions = buildFactionDefinitions();
  const results = factions.map((f) => evaluateFaction(f, state));

  const joinedRows = results.filter((r) => r.status === "JOINED");
  const invitedRows = results.filter((r) => r.status === "INVITED");
  const lockedRows = results.filter((r) => r.status === "MISSING");

  lockedRows.sort((a, b) => a.sortScore - b.sortScore || a.name.localeCompare(b.name));

  ns.tprint("\n=== Faction Checklist ===\n");
  ns.tprint(`City: ${city}`);
  ns.tprint(`Money: ${fmtMoney(ns, money)}`);
  ns.tprint(`Hacking: ${hack}`);
  ns.tprint(`Combat: STR ${stats.strength} / DEF ${stats.defense} / DEX ${stats.dexterity} / AGI ${stats.agility}`);
  ns.tprint(`Karma: ${karma.toFixed(2)}`);
  ns.tprint(`Kills: ${kills}`);
  ns.tprint(`Owned/Purchased Augs: ${augmentCount}`);
  ns.tprint(`Outstanding Invites: ${[...invitations].join(", ") || "none"}\n`);

  printRows(ns, "ALREADY JOINED", joinedRows, false);
  printRows(ns, "INVITES READY", invitedRows, false);
  printRows(ns, "MISSING FACTIONS", lockedRows, true);
}

function printRows(ns, title, rows, includeTodo) {
  ns.tprint(`=== ${title} ===`);
  if (rows.length === 0) {
    ns.tprint("None\n");
    return;
  }

  for (const row of rows) {
    ns.tprint(`\n${row.name} [${row.category}] - ${row.status}`);
    if (row.blocks.length > 0) {
      ns.tprint(`Conflicts: ${row.blocks.join(", ")}`);
    }
    if (row.status === "JOINED") {
      ns.tprint("You already have this faction.");
      continue;
    }
    if (row.status === "INVITED") {
      ns.tprint("Invitation is waiting in the Factions menu.");
      continue;
    }
    if (includeTodo) {
      for (const line of row.missing) {
        ns.tprint(` - ${line}`);
      }
      if (row.notes.length > 0) {
        ns.tprint(`Notes: ${row.notes.join(" | ")}`);
      }
    }
  }
  ns.tprint("");
}

function evaluateFaction(faction, state) {
  if (state.joined.has(faction.name)) {
    return { ...faction, status: "JOINED", missing: [], notes: [], sortScore: -2 };
  }
  if (state.invitations.has(faction.name)) {
    return { ...faction, status: "INVITED", missing: [], notes: [], sortScore: -1 };
  }

  const blockedBy = faction.blocks.filter((name) => state.joined.has(name));
  const missing = [];
  const notes = [];

  for (const req of faction.requirements) {
    const result = req.check(state);
    if (!result.ok) missing.push(result.text);
  }

  for (const note of faction.notes || []) notes.push(note);
  if (blockedBy.length > 0) notes.unshift(`Currently blocked by rival faction(s): ${blockedBy.join(", ")}`);

  return {
    ...faction,
    status: "MISSING",
    missing,
    notes,
    sortScore: blockedBy.length * 1000 + missing.length,
  };
}

function buildFactionDefinitions() {
  return [
    {
      name: "CyberSec",
      category: "Early",
      blocks: [],
      requirements: [req("Backdoor CSEC", (s) => !!s.backdoorMap.CSEC)],
    },
    {
      name: "Tian Di Hui",
      category: "Early",
      blocks: [],
      requirements: [
        reqMoney(1e6),
        reqHack(50),
        reqCity(["Chongqing", "New Tokyo", "Ishima"]),
      ],
    },
    {
      name: "Netburners",
      category: "Early",
      blocks: [],
      requirements: [
        reqHack(80),
        reqText(
          "Hacknet total levels >= 100",
          (s) => s.hacknet.levels >= 100,
          (s) => `Raise Hacknet total levels to 100 (now ${s.hacknet.levels})`
        ),
        reqText(
          "Hacknet total RAM >= 8",
          (s) => s.hacknet.ram >= 8,
          (s) => `Raise Hacknet total RAM to 8 (now ${s.hacknet.ram})`
        ),
        reqText(
          "Hacknet total cores >= 4",
          (s) => s.hacknet.cores >= 4,
          (s) => `Raise Hacknet total cores to 4 (now ${s.hacknet.cores})`
        ),
      ],
    },
    {
      name: "Sector-12",
      category: "City",
      blocks: ["Chongqing", "New Tokyo", "Ishima", "Volhaven"],
      requirements: [reqCity(["Sector-12"]), reqMoney(15e6)],
    },
    {
      name: "Chongqing",
      category: "City",
      blocks: ["Sector-12", "Aevum", "Volhaven"],
      requirements: [reqCity(["Chongqing"]), reqMoney(20e6)],
    },
    {
      name: "New Tokyo",
      category: "City",
      blocks: ["Sector-12", "Aevum", "Volhaven"],
      requirements: [reqCity(["New Tokyo"]), reqMoney(20e6)],
    },
    {
      name: "Ishima",
      category: "City",
      blocks: ["Sector-12", "Aevum", "Volhaven"],
      requirements: [reqCity(["Ishima"]), reqMoney(30e6)],
    },
    {
      name: "Aevum",
      category: "City",
      blocks: ["Chongqing", "New Tokyo", "Ishima", "Volhaven"],
      requirements: [reqCity(["Aevum"]), reqMoney(40e6)],
    },
    {
      name: "Volhaven",
      category: "City",
      blocks: ["Sector-12", "Aevum", "Chongqing", "New Tokyo", "Ishima"],
      requirements: [reqCity(["Volhaven"]), reqMoney(50e6)],
    },
    {
      name: "NiteSec",
      category: "Hacking",
      blocks: [],
      requirements: [req("Backdoor avmnite-02h", (s) => !!s.backdoorMap["avmnite-02h"])],
    },
    {
      name: "The Black Hand",
      category: "Hacking",
      blocks: [],
      requirements: [req("Backdoor I.I.I.I", (s) => !!s.backdoorMap["I.I.I.I"])],
    },
    {
      name: "BitRunners",
      category: "Hacking",
      blocks: [],
      requirements: [req("Backdoor run4theh111z", (s) => !!s.backdoorMap["run4theh111z"])],
    },
    {
      name: "ECorp",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("ECorp", 200000)],
    },
    {
      name: "MegaCorp",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("MegaCorp", 200000)],
    },
    {
      name: "KuaiGong International",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("KuaiGong International", 200000)],
    },
    {
      name: "Four Sigma",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("Four Sigma", 200000)],
    },
    {
      name: "NWO",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("NWO", 200000)],
    },
    {
      name: "Blade Industries",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("Blade Industries", 200000)],
    },
    {
      name: "OmniTek Incorporated",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("OmniTek Incorporated", 200000)],
    },
    {
      name: "Bachman & Associates",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("Bachman & Associates", 200000)],
    },
    {
      name: "Clarke Incorporated",
      category: "Corp",
      blocks: [],
      requirements: [reqCompanyRep("Clarke Incorporated", 200000)],
    },
    {
      name: "Fulcrum Secret Technologies",
      category: "Corp",
      blocks: [],
      requirements: [
        reqCompanyRep("Fulcrum Technologies", 250000),
        req("Backdoor fulcrumassets", (s) => !!s.backdoorMap.fulcrumassets),
      ],
      notes: ["Company rep is earned at Fulcrum Technologies; the faction invite also needs fulcrumassets backdoored."],
    },
    {
      name: "Slum Snakes",
      category: "Crime",
      blocks: [],
      requirements: [reqCombatAll(30), reqKarma(-9), reqMoney(1e6)],
    },
    {
      name: "Tetrads",
      category: "Crime",
      blocks: [],
      requirements: [reqCity(["Chongqing", "New Tokyo", "Ishima"]), reqCombatAll(75), reqKarma(-18)],
    },
    {
      name: "Silhouette",
      category: "Crime",
      blocks: [],
      requirements: [
        reqText(
          "Have a CEO/CFO/CTO job",
          (s) => s.jobInfo.isExecutive,
          (s) => `Reach CTO, CFO, or CEO at a company (current job: ${s.jobInfo.label})`
        ),
        reqMoney(15e6),
        reqKarma(-22),
      ],
    },
    {
      name: "Speakers for the Dead",
      category: "Crime",
      blocks: [],
      requirements: [reqHack(100), reqCombatAll(300), reqKills(30), reqKarma(-45), reqNotGov()],
    },
    {
      name: "The Dark Army",
      category: "Crime",
      blocks: [],
      requirements: [reqHack(300), reqCombatAll(300), reqCity(["Chongqing"]), reqKills(5), reqKarma(-45), reqNotGov()],
    },
    {
      name: "The Syndicate",
      category: "Crime",
      blocks: [],
      requirements: [reqHack(200), reqCombatAll(200), reqCity(["Aevum", "Sector-12"]), reqMoney(10e6), reqKarma(-90), reqNotGov()],
    },
    {
      name: "The Covenant",
      category: "Endgame",
      blocks: [],
      requirements: [reqAugs(20), reqMoney(75e9), reqHack(850), reqCombatAll(850)],
    },
    {
      name: "Daedalus",
      category: "Endgame",
      blocks: [],
      requirements: [
        reqAugs(30),
        reqMoney(100e9),
        reqText(
          "Hacking 2500 or combat all 1500",
          (s) => s.hack >= 2500 || minCombat(s) >= 1500,
          (s) => `Reach hacking 2500 OR all combat stats 1500 (hack ${s.hack}; min combat ${minCombat(s)})`
        ),
      ],
    },
    {
      name: "Illuminati",
      category: "Endgame",
      blocks: [],
      requirements: [reqAugs(30), reqMoney(150e9), reqHack(1500), reqCombatAll(1200)],
    },
  ];
}

function getInvitations(ns) {
  try {
    if (ns.singularity?.checkFactionInvitations) return ns.singularity.checkFactionInvitations();
  } catch {}
  return [];
}

function getAugmentationCount(ns) {
  try {
    if (ns.singularity?.getOwnedAugmentations) {
      return ns.singularity.getOwnedAugmentations(true).length;
    }
  } catch {}
  return 0;
}

function getCompanyRepMap(ns) {
  const companies = [
    "ECorp",
    "MegaCorp",
    "KuaiGong International",
    "Four Sigma",
    "NWO",
    "Blade Industries",
    "OmniTek Incorporated",
    "Bachman & Associates",
    "Clarke Incorporated",
    "Fulcrum Technologies",
  ];

  const map = {};
  for (const company of companies) {
    try {
      if (ns.singularity?.getCompanyRep) map[company] = ns.singularity.getCompanyRep(company);
      else map[company] = 0;
    } catch {
      map[company] = 0;
    }
  }
  return map;
}

function getBackdoorMap(ns, servers) {
  const map = {};
  for (const server of servers) {
    try {
      map[server] = !!ns.getServer(server).backdoorInstalled;
    } catch {
      map[server] = false;
    }
  }
  return map;
}

function getHacknetTotals(ns) {
  const totals = { levels: 0, ram: 0, cores: 0 };
  try {
    const count = ns.hacknet.numNodes();
    for (let i = 0; i < count; i += 1) {
      const stats = ns.hacknet.getNodeStats(i);
      totals.levels += stats.level;
      totals.ram += stats.ram;
      totals.cores += stats.cores;
    }
  } catch {}
  return totals;
}

function getCombatStats(player) {
  const s = player.skills || {};
  return {
    strength: s.strength ?? player.strength ?? 0,
    defense: s.defense ?? player.defense ?? 0,
    dexterity: s.dexterity ?? player.dexterity ?? 0,
    agility: s.agility ?? player.agility ?? 0,
  };
}

function getJobInfo(player) {
  const jobs = player.jobs || {};
  const entries = Object.entries(jobs);
  const executiveTitles = new Set([
    "Chief Technology Officer",
    "Chief Financial Officer",
    "Chief Executive Officer",
    "CTO",
    "CFO",
    "CEO",
  ]);
  const hit = entries.find(([, title]) => executiveTitles.has(title));
  if (hit) {
    return { isExecutive: true, label: `${hit[1]} @ ${hit[0]}` };
  }
  if (entries.length === 0) {
    return { isExecutive: false, label: "none" };
  }
  return {
    isExecutive: false,
    label: entries.map(([company, title]) => `${title} @ ${company}`).join(", "),
  };
}

function req(label, predicate) {
  return reqText(label, predicate, () => label);
}

function reqText(label, predicate, missingText) {
  return {
    check(state) {
      return predicate(state)
        ? { ok: true, text: label }
        : { ok: false, text: typeof missingText === "function" ? missingText(state) : missingText };
    },
  };
}

function reqMoney(amount) {
  return reqText(
    `Money >= ${amount}`,
    (s) => s.money >= amount,
    (s) => `Earn ${formatMoney(amount)} (now ${formatMoney(s.money)})`
  );
}

function reqHack(amount) {
  return reqText(
    `Hacking >= ${amount}`,
    (s) => s.hack >= amount,
    (s) => `Raise hacking to ${amount} (now ${s.hack})`
  );
}

function reqCity(cities) {
  return reqText(
    `Be in ${cities.join(" / ")}`,
    (s) => cities.includes(s.city),
    (s) => `Travel to ${cities.join(" or ")} (now in ${s.city})`
  );
}

function reqCombatAll(amount) {
  return reqText(
    `All combat stats >= ${amount}`,
    (s) => minCombat(s) >= amount,
    (s) =>
      `Train all combat stats to ${amount} (now STR ${s.stats.strength}, DEF ${s.stats.defense}, DEX ${s.stats.dexterity}, AGI ${s.stats.agility})`
  );
}

function reqKarma(amount) {
  return reqText(
    `Karma <= ${amount}`,
    (s) => s.karma <= amount,
    (s) => `Lower karma to ${amount} or less (now ${s.karma.toFixed(2)})`
  );
}

function reqKills(amount) {
  return reqText(
    `Kills >= ${amount}`,
    (s) => s.kills >= amount,
    (s) => `Reach ${amount} kills (now ${s.kills})`
  );
}

function reqAugs(amount) {
  return reqText(
    `Owned augmentations >= ${amount}`,
    (s) => s.augmentCount >= amount,
    (s) => `Own/purchase at least ${amount} augmentations (now ${s.augmentCount})`
  );
}

function reqCompanyRep(company, amount) {
  return reqText(
    `${company} rep >= ${amount}`,
    (s) => (s.companyRep[company] || 0) >= amount,
    (s) => `Gain ${amount.toLocaleString()} reputation at ${company} (now ${(s.companyRep[company] || 0).toLocaleString()})`
  );
}

function reqNotGov() {
  return reqText(
    "Not employed by CIA/NSA",
    (s) => !/CIA|NSA/.test(s.jobInfo.label),
    (s) => `Leave CIA/NSA employment first (current job: ${s.jobInfo.label})`
  );
}

function minCombat(state) {
  return Math.min(
    state.stats.strength,
    state.stats.defense,
    state.stats.dexterity,
    state.stats.agility
  );
}

function formatMoney(n) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}t`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtMoney(ns, n) {
  try {
    return ns.formatNumber ? `$${ns.formatNumber(n)}` : formatMoney(n);
  } catch {
    return formatMoney(n);
  }
}