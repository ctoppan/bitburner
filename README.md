# Bitburner Automation Repo

This repo keeps your **home server clean and disposable** while all real
scripts live in GitHub.

You only keep a tiny bootstrap locally. Everything else syncs from
GitHub.

------------------------------------------------------------------------

## 🚀 Quick Start (Fresh Game or Reset)

Create the one-time installer:

    nano installscripts.js

Paste:

``` js
/** @param {NS} ns **/
export async function main(ns) {
  const url = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src/bootstrap/start.js";
  const file = "bootstrap/start.js";

  await ns.wget(`${url}?ts=${Date.now()}`, file);
  ns.spawn(file, 1);
}
```

Run:

    run installscripts.js

------------------------------------------------------------------------

## 🔄 What Happens

### Step 1: installscripts.js

-   Downloads `bootstrap/start.js`
-   Runs it

### Step 2: bootstrap/start.js

-   Downloads `bootstrap/start-download-only.js`
-   Runs it
-   Passes `/bootstrap/initHacking.js` as the next script

### Step 3: start-download-only.js

-   Syncs the entire repo from GitHub
-   Launches `/bootstrap/initHacking.js`

------------------------------------------------------------------------

## 🧹 Clean Reset

    run bootstrap/cleanup.js
    run installscripts.js

------------------------------------------------------------------------

## 📁 Folder Structure

    /bootstrap/        → startup, downloader, cleanup
    /hacking/main/     → core hacking logic
    /hacking/batch/    → batch scripts (HWGW)
    /xp/               → XP grinding scripts
    /share/            → faction rep sharing
    /stockmarket/      → stock trading
    /gang/             → gang automation
    /crime/            → crime scripts
    /utils/            → helpers (scan, root, etc)
    /manual/browser/   → browser/manual helpers

------------------------------------------------------------------------

## ▶️ Common Commands

Start everything:

    run installscripts.js

Clean and resync:

    run bootstrap/cleanup.js
    run installscripts.js

Spread hacking:

    run hacking/main/spread-hack.js

Network status:

    run utils/network-status.js

XP grinding:

    run xp/xpGrind.js

Share scripts:

    run share/share-home.js

------------------------------------------------------------------------

## 💡 Philosophy

-   home is temporary
-   GitHub is the source of truth
-   scripts are grouped by purpose
-   everything is modular and scalable

------------------------------------------------------------------------

## 🔧 Tips

Always use full paths:

``` js
ns.exec("/hacking/main/hack.js", host, threads);
```

If something breaks, it is almost always a path issue.

You can safely wipe and re-download at any time.
