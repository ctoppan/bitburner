const settings = {
  intervalMs: 15000,
  gangFactionPriority: ['Slum Snakes', 'Tetrads', 'The Syndicate', 'Speakers for the Dead', 'The Dark Army', 'NiteSec'],
  crimeScripts: {
    karma: 'karmaReducer.js',
    money: 'commitCrime.js',
  },
  gangKarmaThreshold: -54000,
};

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

function getSingularity(ns) {
  try {
    return ns.singularity ?? null;
  } catch {
    return null;
  }
}

function canUseGangApi(ns) {
  try {
    return !!ns.gang;
  } catch {
    return false;
  }
}

function canUsePlayerApi(ns) {
  try {
    return typeof ns.getPlayer === 'function';
  } catch {
    return false;
  }
}

function canCommitCrimes(ns) {
  const singularity = getSingularity(ns);
  return !!(singularity && typeof singularity.commitCrime === 'function');
}

function inGang(ns) {
  if (!canUseGangApi(ns)) return false;

  try {
    return ns.gang.inGang();
  } catch {
    return false;
  }
}

function getPlayer(ns) {
  if (!canUsePlayerApi(ns)) return null;

  try {
    return ns.getPlayer();
  } catch {
    return null;
  }
}

function getKarma(ns) {
  try {
    return typeof ns.heart?.break === 'function' ? ns.heart.break() : 0;
  } catch {
    return 0;
  }
}

function getFactionToCreateGang(ns) {
  const player = getPlayer(ns);
  const factions = Array.isArray(player?.factions) ? player.factions : [];

  for (const faction of settings.gangFactionPriority) {
    if (factions.includes(faction)) {
      return faction;
    }
  }

  return '';
}

function tryCreateGang(ns) {
  if (!canUseGangApi(ns) || inGang(ns)) return false;

  const faction = getFactionToCreateGang(ns);
  if (!faction) return false;

  try {
    const created = ns.gang.createGang(faction);
    if (created) {
      ns.tprint(`[${localeHHMMSS()}] Created gang with ${faction}`);
    }
    return created;
  } catch {
    return false;
  }
}

function startScriptIfNotRunning(ns, script, args = []) {
  if (ns.isRunning(script, 'home', ...args)) return true;
  const pid = ns.run(script, 1, ...args);
  return pid !== 0;
}

function stopScriptIfRunning(ns, script) {
  try {
    if (ns.scriptRunning(script, 'home')) {
      ns.scriptKill(script, 'home');
    }
  } catch {}
}

function stopAllCrimeScripts(ns) {
  stopScriptIfRunning(ns, settings.crimeScripts.karma);
  stopScriptIfRunning(ns, settings.crimeScripts.money);
}

function ensureGangManager(ns) {
  stopAllCrimeScripts(ns);

  if (!ns.scriptRunning('prepareGang.js', 'home')) {
    ns.tprint(`[${localeHHMMSS()}] Running prepareGang.js`);
    ns.run('prepareGang.js', 1);
  }

  if (!ns.scriptRunning('gangManager.js', 'home')) {
    ns.tprint(`[${localeHHMMSS()}] Starting gangManager.js`);
    ns.run('gangManager.js', 1);
  }
}

function selectCrimeScript(ns) {
  const faction = getFactionToCreateGang(ns);
  const karma = getKarma(ns);

  if (faction && karma > settings.gangKarmaThreshold) {
    return settings.crimeScripts.karma;
  }

  return settings.crimeScripts.money;
}

function ensureCrimeLoop(ns) {
  if (!canCommitCrimes(ns)) return;
  if (ns.scriptRunning('gangManager.js', 'home')) return;

  const wantedScript = selectCrimeScript(ns);
  const otherScript = wantedScript === settings.crimeScripts.karma ? settings.crimeScripts.money : settings.crimeScripts.karma;

  stopScriptIfRunning(ns, otherScript);

  if (!ns.scriptRunning(wantedScript, 'home')) {
    const started = startScriptIfNotRunning(ns, wantedScript);
    if (started) {
      ns.tprint(`[${localeHHMMSS()}] Starting crime progression loop with ${wantedScript}`);
    }
  }
}

function printStatus(ns) {
  const faction = getFactionToCreateGang(ns) || 'none';
  const karma = getKarma(ns);
  const canCreateNow = canUseGangApi(ns) && !inGang(ns) && !!faction;
  ns.print(`[${localeHHMMSS()}] Progression status | inGang=${inGang(ns)} | gangFaction=${faction} | karma=${karma.toFixed(2)} | canCreate=${canCreateNow}`);
}

export async function main(ns) {
  ns.disableLog('ALL');
  ns.tprint(`[${localeHHMMSS()}] Starting progressionManager.js`);

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home');
  }

  while (true) {
    if (canUseGangApi(ns) && !inGang(ns)) {
      tryCreateGang(ns);
    }

    if (canUseGangApi(ns) && inGang(ns)) {
      ensureGangManager(ns);
    } else {
      ensureCrimeLoop(ns);
    }

    printStatus(ns);
    await ns.sleep(settings.intervalMs);
  }
}
