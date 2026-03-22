# Bitburner scripts collection

Welcome to my log of
[Bitburner](https://danielyxie.github.io/bitburner/) scripts. They are
written using the in-game language of NetscriptJS, which is a mutation
of Javascript.

If you want to play the game itself - click on the name above.

------------------------------------------------------------------------

## Requirements

The script has been modified to be able to start on 8 GB (the default
starting RAM for a player) on the `home` server.

As you expand RAM and unlock port programs, performance improves
significantly. Purchased servers and batching will greatly increase
income in mid/late game.

------------------------------------------------------------------------

## Installation

1.  Create a new script called `start.js`:

        nano start.js

2.  Paste the following:

``` javascript
/** @param {NS} ns **/
export async function main(ns) {
  if (ns.getHostname() !== "home") {
    throw new Error("Run the script from home");
  }

  const repoBase = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src";
  const file = "initHacking.js";
  const url = `${repoBase}/${file}?ts=${Date.now()}`;

  ns.tprint(`[start.js] Refreshing ${file}...`);

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
```

3.  Run:

```{=html}
<!-- -->
```
    run start.js

------------------------------------------------------------------------

## Important Notes

-   This fork uses **ctoppan/bitburner** as the source of truth.
-   All scripts are downloaded from this repo each time `start.js` runs.
-   Files are refreshed each run.
-   If you modify scripts locally, commit them here or they will be
    overwritten.

------------------------------------------------------------------------

## Batching System

Files included:

-   prepTarget.js
-   batchHack.js
-   batchGrow.js
-   batchWeaken.js
-   batchController.js

### Usage

Prep target:

    run prepTarget.js rho-construction

Run batcher:

    run batchController.js rho-construction

Optional:

    run batchController.js rho-construction 0.08 200

------------------------------------------------------------------------

## Important

Do NOT run both: - mainHack.js - batchController.js

They will conflict.

------------------------------------------------------------------------

Enjoy breaking the simulation 😉
