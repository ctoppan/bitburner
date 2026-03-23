const settings = {
  keys: {
    crimesStop: 'BB_CRIMES_STOP',
  },
  focus: false,
  pollMs: 250,
  stopAtKarma: -54000,
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

function getSingularity(ns) {
  try {
    return ns.singularity ?? null;
  } catch {
    return null;
  }
}

function canDoCrime(ns) {
  const singularity = getSingularity(ns);
  return !!(singularity && typeof singularity.commitCrime === 'function');
}

function playerHasOngoingWork(ns) {
  const singularity = getSingularity(ns);

  try {
    if (singularity && typeof singularity.isBusy === 'function') {
      return singularity.isBusy();
    }
  } catch {}

  try {
    if (singularity && typeof singularity.isWorking === 'function') {
      return singularity.isWorking();
    }
  } catch {}

  return false;
}

function getKarma(ns) {
  try {
    return typeof ns.heart?.break === 'function' ? ns.heart.break() : 0;
  } catch {
    return 0;
  }
}

function startCrime(ns, crime) {
  const singularity = getSingularity(ns);
  if (!singularity || typeof singularity.commitCrime !== 'function') return false;

  try {
    const result = singularity.commitCrime(crime, settings.focus);
    return result !== false;
  } catch {
    return false;
  }
}

function getCrimeTime(ns, crime) {
  const singularity = getSingularity(ns);

  try {
    if (singularity && typeof singularity.getCrimeStats === 'function') {
      const stats = singularity.getCrimeStats(crime);
      if (stats && typeof stats.time === 'number' && stats.time > 0) {
        return stats.time;
      }
    }
  } catch {}

  return 3000;
}

export async function main(ns) {
  ns.disableLog('sleep');
  ns.tprint(`[${localeHHMMSS()}] Starting karmaReducer.js`);

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home');
  }

  if (!canDoCrime(ns)) {
    ns.tprint(`[WARN ${localeHHMMSS()}] Crime automation requires the Singularity API. Exiting karmaReducer.js`);
    return;
  }

  const crimeToCommit = 'Homicide';
  const crimeTime = getCrimeTime(ns, crimeToCommit);

  while (true) {
    const crimesStop = getItem(settings.keys.crimesStop);
    const karma = getKarma(ns);

    if (crimesStop || karma <= settings.stopAtKarma) {
      break;
    }

    while (playerHasOngoingWork(ns)) {
      await ns.sleep(settings.pollMs);
    }

    ns.tprint(`[${localeHHMMSS()}] Committing crime: ${crimeToCommit} (karma ${karma.toFixed(2)})`);
    const started = startCrime(ns, crimeToCommit);

    if (!started) {
      ns.tprint(`[WARN ${localeHHMMSS()}] Failed to start ${crimeToCommit}, stopping karmaReducer.js`);
      break;
    }

    await ns.sleep(crimeTime + 50);
  }

  setItem(settings.keys.crimesStop, false);
}
