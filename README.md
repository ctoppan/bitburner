# Bitburner Automation Starter (Enhanced)

This repo is an opinionated Bitburner automation stack with:

* dynamic hacking controller (auto-tunes itself)
* smart purchased server scaling
* optional gang automation
* safe defaults to prevent game freezes
* manual toggles for **money vs growth**

---

## 🚀 Quick Start

1. Create `start.js` on `home`
2. Paste the bootstrap below
3. Run:

```txt
run start.js
```

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

---

## 🧠 System Overview

### Boot Flow

```text
start.js
→ initHacking.js
→ killAll.js
→ overlapBatchController.js
→ playerServers.js
→ progressionManager.js
```

---

## 💰 Hacking Engine (Core)

### overlapBatchController.js

This is the main engine.

It dynamically:

* selects most profitable targets
* scales batch size based on RAM
* adjusts hack %, spacing, concurrency
* prevents runaway job spam
* uses **adaptive tuning**

### Key Features

* dynamic target switching
* RAM-aware scaling (PB-safe)
* anti-thrashing target logic
* fleet utilization tracking
* real-time tuning display

---

## ⚙️ Dynamic Investment System

### playerServers.js (NEW MODES)

You now have **3 spending modes**:

### 🔥 growth

* aggressively buys/upgrades servers
* fastest long-term scaling
* low visible cash

```txt
run setSpendMode.js growth
```

---

### ⚖️ balanced

* moderate reinvestment
* default mode

```txt
run setSpendMode.js balanced
```

---

### 💸 save_for_augs

* preserves money for augment purchases
* minimal server spending

```txt
run setSpendMode.js save_for_augs 75000000000
```

(75b reserve example)

---

## 🧰 New Helper Scripts

### setSpendMode.js

Switch modes without editing code:

```txt
run setSpendMode.js growth
run setSpendMode.js balanced
run setSpendMode.js save_for_augs 75000000000
```

---

### fleetfree.js

Check RAM usage:

```txt
run fleetfree.js
```

Output:

* total RAM
* used RAM
* free RAM

---

## 📈 Growth vs Cash Strategy

### Growth Mode (scale faster)

Run:

```txt
run setSpendMode.js growth
```

Use when:

* early/mid game
* building server fleet
* not buying augs yet

---

### Cash Mode (buy augs)

Run:

```txt
run setSpendMode.js save_for_augs 75000000000
```

Use when:

* close to augment purchase
* need liquid money
* want to stop reinvestment

---

## 🧑‍🤝‍🧑 Faction + Augment Strategy

Best approach:

1. Work for faction (BitRunners, etc.)
2. Switch to `save_for_augs`
3. Let hacking stack generate cash
4. Buy key augments
5. Install
6. Return to `growth`

---

## 🤖 Scripts That Auto-Run

Do NOT run manually:

* initHacking.js
* killAll.js
* overlapBatchController.js
* playerServers.js
* progressionManager.js
* spider.js
* prepTarget.js
* batchHack.js
* batchGrow.js
* batchWeaken.js

---

## 🧪 Manual Scripts

### Useful tools

* `setSpendMode.js`
* `fleetfree.js`
* `stopXpGrind.js`

---

### Optional manual scripts

* commitCrime.js
* karmaReducer.js
* getCrimesData.js
* getCrimesData2.js

⚠️ Crime automation is **disabled by default**

---

### Browser-only (DO NOT run via Netscript)

* browserAutoHack.js
* hackingMission.js

Use in browser console only.

---

## 🧠 Gang Automation

Handled by:

* progressionManager.js
* prepareGang.js
* gangManager.js

Auto:

* creates gang when possible
* starts management

Manual helper:

```txt
run gangFastAscender.js
```

---

## ⚠️ Safety Notes

### Avoid crashes / black screen

Do NOT:

* run multiple controllers
* reduce spacer too aggressively
* increase hack % too fast

---

### Only run ONE controller

Do NOT mix:

* overlapBatchController.js
* mainHack.js
* runHacking.js
* batchController.js

---

## 🧩 Why Money Sometimes Looks Low

If you see low money:

✔️ likely cause:

* being reinvested into servers

Fix:

```txt
run setSpendMode.js save_for_augs
```

---

## 📊 Understanding Your Output

Controller window shows:

* `avail` → free RAM
* `jobs/batches` → concurrency usage
* `hackPct` → aggressiveness
* `target score` → profitability
* `invest` → current strategy

---

## 🔁 Updating Scripts

Run:

```txt
run start.js
```

This will:

* re-download all scripts
* reset system cleanly

---

## 📦 Repo Source

Pulled from:

* `ctoppan/bitburner`

Local changes will be overwritten unless committed upstream.

---

## 🧭 Recommended Play Loop

```text
Start fresh
→ run start.js
→ growth mode
→ scale servers
→ switch to save_for_augs
→ buy augments
→ install
→ repeat
```

---

## 💡 Pro Tips

* Big fleets need multi-target scaling (future upgrade)
* Don’t over-stack augments (price multiplier explodes)
* Always switch to cash mode before buying

---

## ✅ Summary

This stack now gives you:

* 🔁 self-tuning hacking engine
* 🧠 dynamic investment logic
* 💰 manual control over spending vs saving
* 🚫 safer execution (no freezes)
* ⚡ fast scaling to late-game

---

Enjoy the climb 🚀
