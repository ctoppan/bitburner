# Bitburner Automation Starter

This repo is set up as an opinionated Bitburner automation stack with a small bootstrap, a safer hacking controller, and gang automation without auto-starting crime scripts.

The goals of this version are:
- keep startup simple
- avoid runaway batch spam that can freeze the game
- automate the common hacking -> gang progression path
- leave browser-only helpers manual

## Quick Start

1. Create a fresh `start.js` on `home`.
2. Paste in the bootstrap below.
3. Run `run start.js`.

```javascript
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
```

## What `start.js` Does

`start.js` is intentionally tiny.

It only:
- downloads the latest `initHacking.js`
- launches it

All real orchestration lives in `initHacking.js`.

## What `initHacking.js` Does

`initHacking.js` is the main entry point for the repo.

It:
- downloads the current script set from this repo
- clears old runtime state used by the hacking stack
- starts `killAll.js` to reset workers cleanly
- launches the safer overlap batch controller by default
- starts `playerServers.js`
- starts `progressionManager.js`

By default it uses a conservative overlap batch setup to reduce the odds of Bitburner hanging or black-screening from too many queued jobs.

## Automated Runtime Flow

After `run start.js`, the intended flow is:

1. `start.js`
2. `initHacking.js`
3. `killAll.js`
4. `overlapBatchController.js`
5. `playerServers.js`
6. `progressionManager.js`

### Hacking

The default hacking engine is:
- `overlapBatchController.js`

It manages:
- `prepTarget.js`
- `batchHack.js`
- `batchGrow.js`
- `batchWeaken.js`

This controller has been tuned to be safer than the older versions by capping active jobs and active batches.

### Crime and Gang Progression

`progressionManager.js` handles progression outside pure hacking.

It will:
- run crime automation if Singularity crime functions are available
- use `karmaReducer.js` when you already belong to a gang-capable faction but still need karma
- use `commitCrime.js` when money or general crime progression makes more sense
- attempt to create a gang automatically when possible
- start `prepareGang.js` and `gangManager.js` once the gang exists

## Scripts That Are Automated

These should generally not be started by hand during normal play:

- `initHacking.js`
- `killAll.js`
- `overlapBatchController.js`
- `playerServers.js`
- `progressionManager.js`

`playerServers.js` reserves money for the next manual home RAM/core purchase, but it no longer pops up repeated terminal warnings by default.
- `prepareGang.js`
- `gangManager.js`
- `prepTarget.js`
- `batchHack.js`
- `batchGrow.js`
- `batchWeaken.js`
- `grow.js`
- `hack.js`
- `weaken.js`
- `runHacking.js`
- `spider.js`
- `mainHack.js`

## Manual Scripts

These are the scripts that should stay manual and belong in a separate README section.

### Browser-only helpers

Do not run these with `run` or `exec`.

- `browserAutoHack.js`
- `hackingMission.js`

These interact with the browser DOM and are meant for the browser console, not the Netscript runtime.

### Situational manual script

- `gangFastAscender.js`

This is best treated as a manual gang utility rather than part of the default always-on automation path.

### Optional manual control scripts

These are runnable Netscript scripts, but they are manual-only by default:

- `commitCrime.js`
- `karmaReducer.js`
- `getCrimesData.js`
- `getCrimesData2.js`

You can still run them manually for testing or debugging.

## Safety Notes

### Do not run multiple hacking controllers together

Only run one controller family at a time.

Do not mix:
- `mainHack.js`
- `runHacking.js`
- `batchController.js`
- `overlapBatchController.js`

If you want to switch controllers, run `start.js` again or kill the old controller first.

### Why the game was hanging

The most likely cause was the hacking layer launching too many overlapping jobs too quickly.

This repo now uses safer defaults and additional caps in `overlapBatchController.js` to reduce that risk, but Bitburner can still get unstable if:
- you lower spacing too aggressively
- you raise hack percent too aggressively
- you launch multiple controller families at once
- home RAM gets crowded by too many side scripts

## Crime Script Notes

The crime scripts were updated to work more cleanly with modern Bitburner installs.

They now:
- prefer the newer Singularity crime functions when available
- use modern crime names
- avoid the deprecated `ns.isBusy()` path that can fail on newer installs
- handle crime timing more safely
- stop automatically once gang-karma thresholds are met in the homicide loop

Crime automation still depends on having access to the relevant Singularity functions.

## Gang Notes

Gang automation assumes:
- the gang API is available
- you have joined a faction that can form a gang

`progressionManager.js` will try to create the gang automatically once those conditions are met.

## Recommended Usage

For normal use:

```text
run start.js
```

For manual gang optimization later:

```text
run gangFastAscender.js
```

For browser helpers:
- open the browser console
- paste `browserAutoHack.js` or `hackingMission.js`

## Repo Source

This repo pulls files from:
- `ctoppan/bitburner`

Running `start.js` refreshes the local copies from the repo, so local manual edits will be overwritten unless they are committed upstream.


## Crime automation

Crime scripts are no longer auto-started. If you want to use them, run `commitCrime.js` or `karmaReducer.js` manually.
