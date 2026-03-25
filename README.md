# Bitburner Automation Starter

This repo is an opinionated Bitburner automation stack built around a small bootstrap, an auto-tuning overlap batch controller, purchased-server scaling, and a money-vs-growth spending toggle.

## Goals

- keep startup simple
- avoid runaway batch spam that can freeze the game
- auto-scale after fresh augment installs
- automate hacking and purchased-server scaling
- let you switch between scaling hard and saving cash for augments
- use multi-target parallel hacking when the fleet is large enough to benefit

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
  const file = "initHacking.js";
  const url = `${repoBase}/${file}?ts=${Date.now()}`;

  ns.tprint(`[start.js] Refreshing ${file}...`);

  if (ns.fileExists(file, "home")) {
    ns.rm(file, "home");
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

## Runtime Flow

The normal boot path is:

1. `start.js`
2. `initHacking.js`
3. `killAll.js`
4. `spider.js`
5. `overlapBatchController.js`
6. `playerServers.js`

## Main Components

### `initHacking.js`

This is the real entry point.

It:
- downloads the current script set from GitHub
- clears old runtime state used by the hacking stack
- starts `killAll.js` for a clean reset
- passes default startup args into `overlapBatchController.js`
- launches `playerServers.js`

Default overlap startup args are:

```text
0.03 150 128
```

That means:
- start at 3% hack target
- start at 150 ms spacing
- reserve 128 GB on `home`

These are only starting values. The overlap controller auto-tunes from there.

### `overlapBatchController.js`

This is the primary hacking engine.

It now supports:
- auto-tuned hack percent and spacer
- dynamic batch and job caps
- auto-scaling based on total fleet RAM
- prep detection with prep waves excluded from real batch counts
- anti-thrash target locking
- richer late-game target filtering
- RAM-aware batch sizing
- top-target display in the tail window
- tuner state publishing for `playerServers.js`

Normal usage is:

```text
run overlapBatchController.js
```

You can still override the starting point manually:

```text
run overlapBatchController.js 0.05 100 128
```

That means:
- start at 5% hack target
- start at 100 ms spacing
- reserve 128 GB on `home`

The controller still auto-tunes after launch.

### `playerServers.js`

This script manages purchased servers and cooperates with the hacking tuner.

It supports three spend modes:
- `growth`
- `balanced`
- `save_for_augs`

It reads the current mode from local storage so you can switch modes without editing the script.

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

### Optional manual scripts

- `gangFastAscender.js`
- `commitCrime.js`
- `karmaReducer.js`
- `getCrimesData.js`
- `getCrimesData2.js`

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
- excluding prep waves from real batch ceilings

## Recommended Usage

### Normal fresh run

```text
run start.js
```

### Direct controller run

```text
run overlapBatchController.js
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

## Repo Source

This repo pulls files from:
- `ctoppan/bitburner`

Running `start.js` refreshes local copies from the repo, so local manual edits will be overwritten unless they are committed upstream.
