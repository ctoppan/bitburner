/** @param {NS} ns **/
export async function main(ns) {
  if (ns.getHostname() !== 'home') {
    throw new Error('Run the script from home');
  }

  const repoBase = 'https://raw.githubusercontent.com/ctoppan/bitburner/master/src';
  const file = 'initHacking.js';
  const url = `${repoBase}/${file}?ts=${Date.now()}`;

  ns.tprint(`[start.js] Refreshing ${file}...`);

  if (ns.fileExists(file, 'home')) {
    ns.rm(file, 'home');
  }

  const ok = await ns.wget(url, file);

  if (!ok || !ns.fileExists(file, 'home')) {
    ns.tprint(`[start.js] Failed to download ${file}`);
    return;
  }

  ns.tprint(`[start.js] Launching ${file}...`);
  ns.spawn(file, 1);
}
