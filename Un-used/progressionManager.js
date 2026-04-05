const settings = {
  intervalMs: 15000,
  gangFactionPriority: ['Slum Snakes', 'Tetrads', 'The Syndicate', 'Speakers for the Dead', 'The Dark Army', 'NiteSec'],
  autoStartCrime: false,
  keys: {
    crimeAutomationDisabledNoticeAt: 'BB_CRIME_AUTOMATION_DISABLED_NOTICE_AT',
  },
};

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now();
  return new Date(ms).toLocaleTimeString();
}

function getItem(key) {
  const item = localStorage.getItem(key);
  return item ? JSON.parse(item) : undefined;
}

function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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

function stopScriptIfRunning(ns, script) {
  try {
    if (ns.scriptRunning(script, 'home')) {
      ns.scriptKill(script, 'home');
    }
  } catch {}
}

function stopAllCrimeScripts(ns) {
  stopScriptIfRunning(ns, 'karmaReducer.js');
  stopScriptIfRunning(ns, 'commitCrime.js');
}

function printCrimeAutomationDisabledOnce(ns) {
  const alreadyNotifiedAt = Number(getItem(settings.keys.crimeAutomationDisabledNoticeAt) || 0);
  if (alreadyNotifiedAt) return;

  ns.tprint(
    `[${localeHHMMSS()}] Crime automation is disabled by default. ` +
    `Run commitCrime.js or karmaReducer.js manually if you want crime automation.`
  );
  setItem(settings.keys.crimeAutomationDisabledNoticeAt, Date.now());
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

export async function main(ns) {
  ns.disableLog('sleep');
  stopAllCrimeScripts(ns);
  printCrimeAutomationDisabledOnce(ns);

  while (true) {
    if (inGang(ns) || tryCreateGang(ns)) {
      ensureGangManager(ns);
    }

    await ns.sleep(settings.intervalMs);
  }
}
