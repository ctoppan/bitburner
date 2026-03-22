# Bitburner scripts collection

Welcome to my log of [Bitburner](https://danielyxie.github.io/bitburner/) scripts. They are written using the in-game language of NetscriptJS, which is a mutation of Javascript.

If you want to play the game itself - click on the name above.

## Requirements

The script has been modified to be able to start on 8 GB (the default starting RAM for a player) on the `home` server. Obviously, when you expand the memory available, you'll get extra perks - being able to buy and manage player-owned servers, as well as using spare RAM to do actions.

The script can be slow to get going, but it'll get there eventually. Getting access to more port hackers will improve the performance.

## Installation

1. Create a new script called `start.js`:

nano start.js

2. Paste the following content:

```javascript
/** @param {NS} ns **/
export async function main(ns) {
  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const repoBase = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src";
  const file = "initHacking.js";
  const url = `${repoBase}/${file}?ts=${Date.now()}`;

  ns.tprint(`[start.js] Refreshing ${file}...`);

  // 🔥 Force overwrite
  if (ns.fileExists(file, "home")) {
    ns.rm(file);
  }

  const ok = await ns.wget(url, file);

  if (!ok || !ns.fileExists(file, "home")) {
    ns.tprint(`[start.js] Failed to download ${file}`);
    return;
  }

  ns.tprint(`[start.js] Launching ${file}...`);
  ns.spawn(file, 1);
}
```javascript

Exit nano and run:

run start.js

Important Notes
This fork uses ctoppan/bitburner as the source of truth instead of the original repository.
All scripts (including mainHack.js) will be downloaded from this repo when you run start.js.
If you modify scripts, make sure to commit them here or they may be overwritten on the next run.
How it Works
start.js downloads and launches initHacking.js
initHacking.js downloads all required scripts
spider.js builds a network map
mainHack.js handles targeting and hacking
playerServers.js manages purchased servers
Customization

If you want to tweak behavior:

Edit mainHack.js to change targeting or batching logic
Edit playerServers.js to control server upgrades
Adjust RAM reservations and timing in scripts for performance tuning
Tips
Early game: focus on hack XP until your level rises
Mid game: prioritize high-money servers with good weaken times
Late game: consider batching (HWGW) for maximum profit
Troubleshooting
If scripts seem stuck for long periods:
Check weaken times (some servers take a long time early on)
If scripts overwrite your changes:
Make sure initHacking.js points to this repo, not upstream
If nothing runs:
Ensure you are on home before running start.js
