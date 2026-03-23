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

function getCurrentWork(singularity) {
  try {
    if (singularity && typeof singularity.getCurrentWork === 'function') {
      return singularity.getCurrentWork();
    }
  } catch {}
  return null;
}

function playerHasOngoingWork(ns) {
  const singularity = getSingularity(ns);
  const currentWork = getCurrentWork(singularity);
  if (currentWork) return true;

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

function normalizeCrimeName(ns, crime) {
  try {
    const crimeType = ns.enums?.CrimeType;
    if (!crimeType) return crime;
    if (crimeType[crime]) return crimeType[crime];
    for (const value of Object.values(crimeType)) {
      if (String(value).toLowerCase() === String(crime).toLowerCase()) return value;
    }
  } catch {}
  return crime;
}

function tryCommitCrime(singularity, crime, focus) {
  try {
    const result = singularity.commitCrime(crime, focus);
    return result !== false && result !== 0 && result !== null && result !== undefined;
  } catch {
    return false;
  }
}

function stopActionIfPossible(singularity) {
  try {
    if (singularity && typeof singularity.stopAction === 'function') {
      singularity.stopAction();
      return true;
    }
  } catch {}
  return false;
}

function startCrime(ns, crime) {
  const singularity = getSingularity(ns);
  if (!singularity || typeof singularity.commitCrime !== 'function') return false;

  const variants = [
    normalizeCrimeName(ns, crime),
    crime,
    String(crime).toLowerCase(),
  ];

  for (const variant of variants) {
    if (tryCommitCrime(singularity, variant, settings.focus)) return true;
    if (tryCommitCrime(singularity, variant)) return true;
  }

  stopActionIfPossible(singularity);

  for (const variant of variants) {
    if (tryCommitCrime(singularity, variant, settings.focus)) return true;
    if (tryCommitCrime(singularity, variant)) return true;
  }

  return false;
}

function getCrimeTime(ns, crime) {
  const singularity = getSingularity(ns);
  const variants = [normalizeCrimeName(ns, crime), crime];

  for (const variant of variants) {
    try {
      if (singularity && typeof singularity.getCrimeStats === 'function') {
        const stats = singularity.getCrimeStats(variant);
        if (stats && typeof stats.time === 'number' && stats.time > 0) {
          return stats.time;
        }
      }
    } catch {}
  }

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

  const crimeCandidates = ['Homicide', 'Mug someone', 'Rob store', 'Shoplift'];

  while (true) {
    const crimesStop = getItem(settings.keys.crimesStop);
    const karma = getKarma(ns);

    if (crimesStop || karma <= settings.stopAtKarma) {
      break;
    }

    while (playerHasOngoingWork(ns)) {
      await ns.sleep(settings.pollMs);
    }

    let started = false;
    let crimeToCommit = crimeCandidates[0];
    let crimeTime = 3000;

    for (const candidate of crimeCandidates) {
      crimeToCommit = candidate;
      crimeTime = getCrimeTime(ns, candidate);
      ns.tprint(`[${localeHHMMSS()}] Committing crime: ${candidate} (karma ${karma.toFixed(2)})`);
      if (startCrime(ns, candidate)) {
        started = true;
        break;
      }
    }

    if (!started) {
      ns.tprint(`[WARN ${localeHHMMSS()}] Failed to start any crime, stopping karmaReducer.js`);
      localStorage.setItem('BB_CRIME_FAILURE_UNTIL', JSON.stringify(Date.now() + 120000));
      break;
    }

    await ns.sleep(crimeTime + 50);
  }

  setItem(settings.keys.crimesStop, false);
}
