const settings = {
  keys: {
    crimes: 'BB_CRIMES',
  },
  crimes: [
    'Shoplift',
    'Rob Store',
    'Mug',
    'Larceny',
    'Deal Drugs',
    'Bond Forgery',
    'Traffick Illegal Arms',
    'Homicide',
    'Grand Theft Auto',
    'Kidnap and Ransom',
    'Assassination',
    'Heist',
  ],
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

function getCrimeChance(ns, crime) {
  try {
    if (ns.singularity && typeof ns.singularity.getCrimeChance === 'function') {
      return ns.singularity.getCrimeChance(crime);
    }
  } catch {}

  try {
    if (typeof ns.getCrimeChance === 'function') {
      return ns.getCrimeChance(crime);
    }
  } catch {}

  return 0;
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting getCrimesData.js`);

  const scriptToRunAfter = ns.args[0] || 'getCrimesData2.js';

  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home');
  }

  const crimesCache = getItem(settings.keys.crimes) || {};
  const crimes = {};

  for (const crime of settings.crimes) {
    const chance = getCrimeChance(ns, crime);
    crimes[crime] = { ...crimesCache[crime], chance };
  }

  setItem(settings.keys.crimes, crimes);

  if (scriptToRunAfter) {
    ns.tprint(`[${localeHHMMSS()}] Spawning ${scriptToRunAfter}`);
    ns.spawn(scriptToRunAfter, 1);
  }
}
