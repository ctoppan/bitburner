# Bitburner Automation Starter

This repo is an opinionated Bitburner automation stack built around a tiny bootstrap, a full-repo downloader, an auto-tuning overlap batch controller, purchased-server scaling, and a money-vs-growth spending toggle.

## Folder Layout

```text
src/
  bootstrap/
  hacking/main/
  hacking/batch/
  xp/
  share/
  stockmarket/
  gang/
  crime/
  utils/
  manual/browser/
```

## Quick Start

1. Create a fresh `start.js` on `home`.
2. Paste in the bootstrap below.
3. Run `run start.js`.

```javascript
/** @param {NS} ns **/
export async function main(ns) {
  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const repoBase = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src";
  const downloader = "bootstrap/start-download-only.js";
  const nextScript = "/bootstrap/initHacking.js";
  const url = `${repoBase}/${downloader}?ts=${Date.now()}`;

  ns.tprint(`[start.js] Refreshing ${downloader}...`);

  if (ns.fileExists(downloader, "home")) {
    ns.rm(downloader, "home");
  }

  const ok = await ns.wget(url, downloader);

  if (!ok || !ns.fileExists(downloader, "home")) {
    ns.tprint(`[start.js] Failed to download ${downloader}`);
    return;
  }

  ns.tprint(`[start.js] Launching ${downloader} -> ${nextScript}...`);
  ns.spawn(downloader, 1, nextScript);
}
```

## Runtime Flow

The normal boot path is:

1. `start.js`
2. `/bootstrap/start-download-only.js`
3. `/bootstrap/initHacking.js`
4. `/hacking/main/killAll.js`
5. `/hacking/main/spider.js`
6. `/hacking/batch/overlapBatchController.js`
7. `/hacking/main/playerServers.js`

## Main Components

### `/bootstrap/initHacking.js`

This is the real entry point after the bootstrap sync.

It:
- downloads the current script set from GitHub
- clears old runtime state used by the hacking stack
- starts `/hacking/main/killAll.js` for a clean reset
- passes default startup args into `/hacking/batch/overlapBatchController.js`
- launches `/hacking/main/playerServers.js`

### `/hacking/batch/overlapBatchController.js`

This is the primary hacking engine.

Normal usage is:

```text
run /hacking/batch/overlapBatchController.js
```

### `/utils/setSpendMode.js`

Changes the saved spend mode used by `/hacking/main/playerServers.js`.

Examples:

```text
run /utils/setSpendMode.js growth
run /utils/setSpendMode.js balanced
run /utils/setSpendMode.js save_for_augs 75000000000
```

## Script Groups

- Bootstrapping: `/bootstrap/*`
- Main hacking: `/hacking/main/*`
- Batch hacking: `/hacking/batch/*`
- XP grinding: `/xp/*`
- Sharing: `/share/*`
- Stock market: `/stockmarket/*`
- Gang: `/gang/*`
- Crime and karma: `/crime/*`
- Utilities: `/utils/*`
- Browser-only helpers: `/manual/browser/*`

## Notes

- `start.js` is still the tiny manual bootstrap you paste on `home`.
- The maintained repo copy of that bootstrap lives at `src/bootstrap/start.js`.
- The downloader now mirrors folder structure automatically, so files from `src/hacking/main/` land in `home/hacking/main/` in game.
