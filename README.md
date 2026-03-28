# Bitburner Automation Repo

This repo is designed to keep your **home server clean and disposable**
while all real scripts live in GitHub.

You only keep a tiny bootstrap locally. Everything else syncs from
GitHub.

------------------------------------------------------------------------

## 🚀 Quick Start (Fresh Game or Reset)

Paste this into the terminal:

    nano start.js

Then paste:

``` js
/** @param {NS} ns **/
export async function main(ns) {
  const url = "https://raw.githubusercontent.com/ctoppan/bitburner/master/src/bootstrap/start-download-only.js";
  const file = "bootstrap/start-download-only.js";

  await ns.wget(`${url}?ts=${Date.now()}`, file);
  ns.spawn(file, 1);
}
```

Run:

    run start.js

------------------------------------------------------------------------

## 🔄 What Happens

`start.js` does:

1.  downloads `bootstrap/start-download-only.js`
2.  runs it
3.  that script pulls your entire repo from GitHub
4.  then launches:

```{=html}
<!-- -->
```
    bootstrap/initHacking.js

------------------------------------------------------------------------

## 🧹 Clean Reset

Wipe all scripts on home (except cleanup):

    run bootstrap/cleanup.js

Then re-sync:

    run start.js

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

### Start everything

    run start.js

### Clean and resync

    run bootstrap/cleanup.js
    run start.js

### Run spread hacking manually

    run hacking/main/spread-hack.js

### Check network status

    run utils/network-status.js

### Run XP grinding

    run xp/xpGrind.js

### Run share scripts

    run share/share-home.js

------------------------------------------------------------------------

## 💡 Philosophy

-   home is temporary
-   GitHub is the source of truth
-   scripts are grouped by purpose
-   everything is modular and scalable

------------------------------------------------------------------------

## 🔧 Tips

Always use full paths in scripts:

``` js
ns.exec("/hacking/main/hack.js", host, threads);
```

If something breaks after reorganizing, it is almost always a path
issue.

You can safely wipe and re-download at any time.

------------------------------------------------------------------------

## 🔮 Future Upgrades (optional)

-   smart sync (only changed files)
-   auto-root + deploy pipeline
-   multi-target batching
-   dynamic server allocation
