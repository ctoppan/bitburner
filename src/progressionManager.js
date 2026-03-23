const settings = {
  intervalMs: 15000,
  gangFactionPriority: ['Slum Snakes', 'Tetrads', 'The Syndicate', 'Speakers for the Dead', 'The Dark Army', 'NiteSec'],
  crimeScripts: {
    karma: 'karmaReducer.js',
    money: 'commitCrime.js',
  },
  gangKarmaThreshold: -54000,
  crimeFailureCooldownMs: 120000,
  crimeFailureDisableThreshold: 3,
  keys: {
    crimeFailureUntil: 'BB_CRIME_FAILURE_UNTIL',
    crimeFailureCount: 'BB_CRIME_FAILURE_COUNT',
    crimeAutomationDisabled: 'BB_CRIME_AUTOMATION_DISABLED',
    crimeAutomationDisabledNoticeAt: 'BB_CRIME_AUTOMATION_DISABLED_NOTICE_AT',
  },
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

function getCrimeFailureUntil() {
  return Number(getItem(settings.keys.crimeFailureUntil) || 0);
}

function getCrimeFailureCount() {
  return Number(getItem(settings.keys.crimeFailureCount) || 0);
}

function isCrimeAutomationDisabled() {
  return !!getItem(settings.keys.crimeAutomationDisabled);
}

function noteCrimeFailure() {
  const nextCount = getCrimeFailureCount() + 1;
  setItem(settings.keys.crimeFailureCount, nextCount);
  setItem(settings.keys.crimeFailureUntil, Date.now() + settings.crimeFailureCooldownMs);

  if (nextCount >= settings.crimeFailureDisableThreshold) {
    setItem(settings.keys.crimeAutomationDisabled, true);
  }
}

function clearCrimeFailureState() {
  setItem(settings.keys.crimeFailureUntil, 0);
  setItem(settings.keys.crimeFailureCount, 0);
  setItem(settings.keys.crimeAutomationDisabled, false);
  setItem(settings.keys.crimeAutomationDisabledNoticeAt, 0);
}

function printCrimeAutomationDisabledOnce(ns) {
  if (!isCrimeAutomationDisabled()) return;

  const alreadyNotifiedAt = Number(getItem(settings.keys.crimeAutomationDisabledNoticeAt) || 0);
  if (alreadyNotifiedAt) return;

  const failureCount = getCrimeFailureCount();
  ns.tprint(
    `[${localeHHMMSS()}] Crime automation disabled after ${failureCount} failed start attempts. ` +
    `Run commitCrime.js or karmaReducer.js manually later if you want to retry.`
  );
  setItem(settings.keys.crimeAutomationDisabledNoticeAt, Date.now());
}

function shouldBackOffCrime(ns) {
  const failureUntil = getCrimeFailureUntil();
  if (Date.now() < failureUntil) {
    const remainingSec = Math.ceil((failureUntil - Date.now()) / 1000);
    ns.print(`[${localeHHMMSS()}] Crime automation cooling down for ${remainingSec}s after a start failure`);
    return true;
  }
  return false;
}

function ensureCrimeLoop(ns) {
  if (!canCommitCrimes(ns)) return;
  if (ns.scriptRunning('gangManager.js', 'home')) return;
  if (isCrimeAutomationDisabled()) {
    printCrimeAutomationDisabledOnce(ns);
    return;
  }
  if (shouldBackOffCrime(ns)) return;

  const wantedScript = selectCrimeScript(ns);
  const otherScript = wantedScript === settings.crimeScripts.karma ? settings.crimeScripts.money : settings.crimeScripts.karma;

  stopScriptIfRunning(ns, otherScript);

  if (!ns.scriptRunning(wantedScript, 'home')) {
    const started = startScriptIfNotRunning(ns, wantedScript);
    if (started) {
      ns.tprint(`[${localeHHMMSS()}] Starting crime progression loop with ${wantedScript}`);
    } else {
      noteCrimeFailure();
      printCrimeAutomationDisabledOnce(ns);
    }
  }
}

function refreshFailureStateFromChildScripts(ns) {
  if (isCrimeAutomationDisabled()) {
    printCrimeAutomationDisabledOnce(ns);
  }

  if (ns.scriptRunning(settings.crimeScripts.karma, 'home') || ns.scriptRunning(settings.crimeScripts.money, 'home')) {
    return;
  }

  const failureUntil = getCrimeFailureUntil();
  if (failureUntil > Date.now()) {
    noteCrimeFailure();
    printCrimeAutomationDisabledOnce(ns);
  }
}

function printStatus(ns) {
  const faction = getFactionToCreateGang(ns) || 'none';
  const karma = getKarma(ns);
  const canCreateNow = canUseGangApi(ns) && !inGang(ns) && !!faction;
  const failureUntil = getCrimeFailureUntil();
  const coolingDown = Date.now() < failureUntil;
  const crimeFailures = getCrimeFailureCount();
  const crimeDisabled = isCrimeAutomationDisabled();
  ns.print(`[${localeHHMMSS()}] Progression status | inGang=${inGang(ns)} | gangFaction=${faction} | karma=${karma.toFixed(2)} | canCreate=${canCreateNow} | crimeCooldown=${coolingDown} | crimeFailures=${crimeFailures} | crimeDisabled=${crimeDisabled}`);
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

    refreshFailureStateFromChildScripts(ns);

    if (canUseGangApi(ns) && inGang(ns)) {
      clearCrimeFailureState();
      ensureGangManager(ns);
    } else {
      ensureCrimeLoop(ns);
    }

    printStatus(ns);
    await ns.sleep(settings.intervalMs);
  }
}
