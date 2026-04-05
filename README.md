# Bitburner Automation Repo

This repo keeps your **home server clean and disposable** while all real
scripts live in GitHub.

You only keep a tiny bootstrap locally. Everything else syncs from
GitHub.

------------------------------------------------------------------------

## Quick Start

Create the one-time installer:

    nano installscripts.js

Paste:

```js
/** @param {NS} ns */
export async function main(ns) {
  const url = "https://raw.githubusercontent.com/ctoppan/bitburner-automation/sf4-starter/src/bootstrap/start.js"
  const file = "bootstrap/start.js"

  await ns.wget(`${url}?ts=${Date.now()}`, file)
  ns.spawn(file, 1)
}
```

Run:

    run installscripts.js

------------------------------------------------------------------------

## What Happens On Startup

### Step 1: installscripts.js

- downloads `/bootstrap/start.js`
- runs it

### Step 2: bootstrap/start.js

- downloads `/bootstrap/start-download-only.js`
- runs it
- passes `/bootstrap/initHacking.js` as the next script

### Step 3: start-download-only.js

- syncs the repo from GitHub
- launches `/bootstrap/initHacking.js`

### Step 4: initHacking.js

- runs `killAll.js`
- starts `/bootstrap/hackOrchestrator.js`
- the orchestrator handles the early XP phase and later money phase automatically

------------------------------------------------------------------------

## Default Automation Flow

### Early run

The orchestrator keeps the run XP-heavy until your hacking level is high enough.

It will:

- run `/hacking/spread-hack.js`
- run `/xp/xpGrind.js`
- run `/xp/xpDistributor.js`
- run `/hacking/batch/overlapBatchController.js` with tighter spacing for fast ramp

### Mid and late run

Once you cross the hack threshold, the orchestrator:

- restarts `/hacking/batch/overlapBatchController.js` with money-oriented args
- stops `spread-hack`
- stops `xpGrind`
- stops `xpDistributor`

Default thresholds are tuned for a fast post-reset climb:

    /bootstrap/hackOrchestrator.js 0.03 0.08 1024 30 80 2500 15000

That means:

- XP phase hack percent: `0.03`
- money phase hack percent: `0.08`
- reserve `1024` GB on home
- XP spacing `30` ms
- money spacing `80` ms
- switch around `2500` hacking
- re-check every `15000` ms

------------------------------------------------------------------------

## Gang Manager

`/gang/gangManager_v2.js` now supports a third focus argument.

Usage:

    run gang/gangManager_v2.js [reserve] [mode] [focus]

Examples:

    run gang/gangManager_v2.js
    run gang/gangManager_v2.js 5e9 money normal
    run gang/gangManager_v2.js 110e9 money rep
    run gang/gangManager_v2.js 110e9 money repverbose

Arguments:

- `reserve` is the hard money floor to protect on home
- `mode` is `money`, `balanced`, or `safe`
- `focus` is one of:
  - `normal` for default behavior
  - `rep` to bias toward respect growth
  - `verbose` to print cycle status
  - `repverbose` to do both

What changed:

- it will not spend gang gear money below the reserve floor
- it buys gear from surplus only, with a per-cycle budget cap
- `rep` focus keeps more pressure on respect growth
- `verbose` prints reserve, spending, worker split, and wanted penalty each cycle

For keeping the Daedalus money unlock safe, a good default is:

    run gang/gangManager_v2.js 110e9 money rep

------------------------------------------------------------------------

## Reset Advisor

Use this to sanity-check whether the run should still push money, push rep, or reset soon.

Usage:

    run utils/resetAdvisor.js [reserve] [daedalusMoneyGate] [hackGate]

Example:

    run utils/resetAdvisor.js 110e9 100e9 2500

It prints:

- current home money
- reserve target
- Daedalus money target
- hacking level vs target
- whether Daedalus is already joined
- gang status if applicable
- a simple reset-ready recommendation

------------------------------------------------------------------------

## Common Commands

Start the full automation stack:

    run installscripts.js

Clean and resync:

    run bootstrap/cleanup.js
    run installscripts.js

Manual orchestrator start:

    run bootstrap/hackOrchestrator.js

Gang rep push with reserve protection:

    run gang/gangManager_v2.js 110e9 money rep

Gang rep push with extra logging:

    run gang/gangManager_v2.js 110e9 money repverbose

Reset status check:

    run utils/resetAdvisor.js 110e9 100e9 2500

Spread hacking only:

    run hacking/spread-hack.js

XP grinding only:

    run xp/xpGrind.js

------------------------------------------------------------------------

## Folder Structure

    /bootstrap/        -> startup, downloader, orchestrator, cleanup
    /hacking/main/     -> core hacking logic
    /hacking/batch/    -> batch scripts
    /xp/               -> XP grinding scripts
    /share/            -> faction rep sharing
    /stockmarket/      -> stock trading
    /gang/             -> gang automation
    /crime/            -> crime scripts
    /utils/            -> helpers and status scripts
    /manual/browser/   -> browser/manual helpers

------------------------------------------------------------------------

## Philosophy

- home is temporary
- GitHub is the source of truth
- early run should ramp XP quickly
- mid and late run should stabilize money automatically
- gang spending should never sabotage your major money gates
- reset decisions should be easy to check, not guess

------------------------------------------------------------------------

## Tips

Always use full paths:

```js
ns.exec("/hacking/main/hack.js", host, threads)
```

If something breaks, it is usually a path mismatch or a missing synced file.

You can safely wipe and re-download at any time.
