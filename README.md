# Bitburner Automation Starter

This repo is an opinionated Bitburner automation stack built around a small bootstrap, a safer hacking controller, optional gang automation, and a money-vs-growth spending toggle.

## Goals

- keep startup simple
- avoid runaway batch spam that can freeze the game
- automate hacking and purchased-server scaling
- support gang progression without auto-starting crime scripts
- let you switch between scaling hard and saving cash for augments
- use multi-target parallel hacking when the fleet is large enough to benefit

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

## Runtime Flow

The normal boot path is:

1. `start.js`
2. `initHacking.js`
3. `killAll.js`
4. `spider.js`
5. `overlapBatchController.js`
6. `playerServers.js`
7. `progressionManager.js`

## Main Components

### `initHacking.js`

This is the real entry point.

It:
- downloads the current script set from GitHub
- clears old runtime state used by the hacking stack
- starts `killAll.js` for a clean reset
- launches `playerServers.js`
- launches `progressionManager.js`

### `overlapBatchController.js`

This is the primary hacking engine.

It now supports:
- dynamic target scoring
- multi-target parallel hacking
- prep detection and prep jobs per target
- RAM-aware scaling
- dynamic hack percent, spacing, and batch ceilings
- top-target display in the tail window
- tuner state publishing for `playerServers.js`

When there is a lot of free fleet RAM, it will spread work across multiple profitable targets instead of trying to force everything into one server.

### `playerServers.js`

This script manages purchased servers and cooperates with the hacking tuner.

It supports three spend modes:
- `growth`
- `balanced`
- `save_for_augs`

It reads the current mode from local storage so you can switch modes without editing the script.

### `progressionManager.js`

This script handles progression outside pure hacking.

It currently focuses on gang-side progression.

Crime scripts are manual-only by default.

## Spend Modes

Use `setSpendMode.js` to switch modes.

### Growth mode

Aggressively buys and upgrades purchased servers.

```text
run setSpendMode.js growth
```

### Balanced mode

Moderate reinvestment.

```text
run setSpendMode.js balanced
```

### Save-for-augs mode

Preserves a large reserve for augment purchases.

```text
run setSpendMode.js save_for_augs 75000000000
```

That example keeps about `75b` reserved before `playerServers.js` spends more on purchased servers.

## Helper Scripts

### `setSpendMode.js`

Changes the saved spend mode used by `playerServers.js`.

Examples:

```text
run setSpendMode.js growth
run setSpendMode.js balanced
run setSpendMode.js save_for_augs 75000000000
```

### `fleetfree.js`

Shows total, used, and free RAM across the full rooted fleet.

```text
run fleetfree.js
```

Use this instead of `free` when you want to judge how much of the actual fleet is being used.

### `stopXpGrind.js`

Manual helper for stopping XP-distribution scripts.

## Automated Scripts

These normally should not be started by hand during normal play:

- `initHacking.js`
- `killAll.js`
- `spider.js`
- `overlapBatchController.js`
- `playerServers.js`
- `progressionManager.js`
- `prepTarget.js`
- `batchHack.js`
- `batchGrow.js`
- `batchWeaken.js`

## Manual Scripts

### Browser-only helpers

Do not run these with `run` or `exec`.

- `browserAutoHack.js`
- `hackingMission.js`

These are intended for the browser console and interact with the UI directly.

### Situational manual script

- `gangFastAscender.js`

### Optional manual crime scripts

These are manual-only by default:

- `commitCrime.js`
- `karmaReducer.js`
- `getCrimesData.js`
- `getCrimesData2.js`

Crime automation is no longer auto-started.

## Gang Automation

Gang automation assumes:
- the gang API is available
- you have joined a faction that can form a gang

`progressionManager.js` will try to create the gang automatically once those conditions are met and then hand off to `prepareGang.js` and `gangManager.js`.

## Why Money Can Look Low

If money seems stalled, it is often being reinvested into purchased servers.

Use:

```text
run setSpendMode.js save_for_augs 75000000000
```

when you want to bank money for augment purchases.

Use:

```text
run setSpendMode.js growth
```

when you want to scale the fleet as fast as possible.

## Safety Notes

### Only run one hacking controller family at a time

Do not mix:
- `mainHack.js`
- `runHacking.js`
- `batchController.js`
- `overlapBatchController.js`

If you want to switch controllers, run `start.js` again or kill the old controller first.

### Why the game can hang

The biggest risk is launching too many overlapping jobs too quickly.

This repo tries to reduce that risk by:
- using dynamic job and batch ceilings
- using more conservative spacing when needed
- avoiding multiple controller families running at once
- keeping `playerServers.js` and controller state coordinated

## Recommended Usage

### Normal fresh run

```text
run start.js
```

### Scale hard

```text
run setSpendMode.js growth
```

### Save for augments

```text
run setSpendMode.js save_for_augs 75000000000
```

### Check actual fleet usage

```text
run fleetfree.js
```

### Manual gang optimization later

```text
run gangFastAscender.js
```

## Repo Source

This repo pulls files from:
- `ctoppan/bitburner`

Running `start.js` refreshes local copies from the repo, so local manual edits will be overwritten unless they are committed upstream.
