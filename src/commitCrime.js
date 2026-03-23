const settings = {
  keys: {
    crimes: 'BB_CRIMES',
    crimesStop: 'BB_CRIMES_STOP',
  },
  intervalToRecheck: 10 * 60 * 1000,
  focus: false,
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

function getCrimeTime(stats) {
  if (!stats) return 1000;

  for (const key of ['time', 'crimeTime']) {
    if (typeof stats[key] === 'number' && isFinite(stats[key]) && stats[key] > 0) {
      return stats[key];
    }
  }

  return 1000;
}

function queueCrimeDataRefresh(ns) {
  ns.tprint(`[${localeHHMMSS()}] Spawning getCrimesData.js`);
  ns.spawn('getCrimesData.js', 1);
}

function selectCrime(crimes) {
  const crimesList = Object.keys(crimes).filter((crime) => crimes[crime]?.stats && typeof crimes[crime]?.chance === 'number');

  crimesList.sort((a, b) => crimes[b].chance - crimes[a].chance);
  const solidChanceCrimes = crimesList.filter((crime) => crimes[crime].chance >= 0.8);
  const topCrimesList = solidChanceCrimes.length > 3 ? solidChanceCrimes : crimesList.slice(0, 3);

  let bestCrime = crimesList[0] || 'Shoplift';
  let bestCrimeWeight = -Infinity;

  for (const crime of topCrimesList) {
    const stats = crimes[crime].stats;
    const money = typeof stats.money === 'number' ? stats.money : 0;
    const intelligenceExp = typeof stats.intelligence_exp === 'number' ? stats.intelligence_exp : 0;
    const time = Math.max(1, getCrimeTime(stats));
    const chance = Math.max(0, crimes[crime].chance || 0);

    const crimeWeight =
      chance *
      (money / time) *
      ((intelligenceExp * 0.1 + 1) / (intelligenceExp * 0.1 + 2));

    if (crimeWeight > bestCrimeWeight) {
      bestCrime = crime;
      bestCrimeWeight = crimeWeight;
    }
  }

  return bestCrime;
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

export async function main(ns) {
  ns.disableLog('sleep');
  ns.tprint(`[${localeHHMMSS()}] Starting commitCrime.js`);

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home');
  }

  if (!canDoCrime(ns)) {
    ns.tprint(`[WARN ${localeHHMMSS()}] Crime automation requires the Singularity API. Exiting commitCrime.js`);
    return;
  }

  const crimes = getItem(settings.keys.crimes);
  if (!crimes) {
    queueCrimeDataRefresh(ns);
    return;
  }

  const crimeToCommit = selectCrime(crimes);
  const crimeStats = crimes[crimeToCommit]?.stats;
  const crimeTime = getCrimeTime(crimeStats);
  const endTime = Date.now() + settings.intervalToRecheck;

  while (true) {
    const crimesStop = getItem(settings.keys.crimesStop);
    if (crimesStop || Date.now() > endTime) break;

    while (playerHasOngoingWork(ns)) {
      await ns.sleep(200);
    }

    ns.tprint(`[${localeHHMMSS()}] Committing crime: ${crimeToCommit}`);
    const started = startCrime(ns, crimeToCommit);

    if (!started) {
      ns.tprint(`[WARN ${localeHHMMSS()}] Failed to start crime ${crimeToCommit}, backing off`);
      localStorage.setItem('BB_CRIME_FAILURE_UNTIL', JSON.stringify(Date.now() + 120000));
      break;
    }

    await ns.sleep(crimeTime + 50);
  }

  const crimesStop = getItem(settings.keys.crimesStop);
  if (!crimesStop) {
    queueCrimeDataRefresh(ns);
  } else {
    setItem(settings.keys.crimesStop, false);
  }
}
