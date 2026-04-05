/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const reservePct = clamp(Number(ns.args[0] ?? 0.20), 0, 0.90);
  const minCashReserve = Math.max(0, Number(ns.args[1] ?? 5e9));
  const tradeBudgetPct = clamp(Number(ns.args[2] ?? 0.25), 0.01, 1.0);
  const minForecastEdge = Number(ns.args[3] ?? 0.05);
  const pollMs = Math.max(1000, Number(ns.args[4] ?? 6000));

  // New args for coordinating with home-upgrade saving
  const homeUpgradeTarget = Math.max(0, Number(ns.args[5] ?? 0));
  const homeReserveBuffer = Math.max(1, Number(ns.args[6] ?? 1.1));

  if (!hasTixApi(ns)) {
    ns.tprint("ERROR stockTrader.js requires WSE + TIX API access.");
    ns.tprint("Buy WSE Account and TIX API Access first.");
    return;
  }

  const has4S =
    safeCall(() => ns.stock.has4SDataTIXAPI?.(), false) ||
    safeCall(() => ns.stock.has4SData?.(), false);

  const canShort =
    safeCall(() => ns.stock.canShort?.(), false);

  const constants = safeCall(() => ns.stock.getConstants?.(), {}) || {};
  const commission =
    constants.StockMarketCommission ??
    constants.commission ??
    100000;

  const symbols = ns.stock.getSymbols();
  const lastPrice = Object.fromEntries(symbols.map((s) => [s, ns.stock.getPrice(s)]));

  ns.ui.openTail();

  while (true) {
    const snapshots = symbols.map((sym) => snapshot(ns, sym, has4S, lastPrice[sym], canShort));
    for (const s of snapshots) lastPrice[s.sym] = s.price;

    // Always allow sells first
    for (const s of snapshots) {
      maybeSell(ns, s, has4S, commission);
    }

    const cash = ns.getServerMoneyAvailable("home");

    const baseReserve = Math.max(minCashReserve, cash * reservePct);
    const protectedHomeReserve =
      homeUpgradeTarget > 0 ? Math.ceil(homeUpgradeTarget * homeReserveBuffer) : 0;
    const reserve = Math.max(baseReserve, protectedHomeReserve);

    // Once the home target itself is reachable, stop opening new stock positions.
    // This protects the manual click window.
    const hardLockForHome = homeUpgradeTarget > 0 && cash >= homeUpgradeTarget;

    let spendable = hardLockForHome ? 0 : Math.max(0, cash - reserve);

    const ranked = snapshots
      .filter((s) => s.signal !== 0)
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    for (const s of ranked) {
      if (spendable <= commission * 2) break;

      const perTradeBudget = Math.max(0, spendable * tradeBudgetPct);
      const used = maybeBuy(ns, s, has4S, canShort, perTradeBudget, commission, minForecastEdge);
      spendable -= used;
    }

    render(ns, symbols, has4S, canShort, {
      reservePct,
      minCashReserve,
      tradeBudgetPct,
      homeUpgradeTarget,
      homeReserveBuffer,
      hardLockForHome,
      reserve,
      spendable,
    });

    await ns.sleep(pollMs);
  }
}

function snapshot(ns, sym, has4S, prevPrice, canShort) {
  const price = ns.stock.getPrice(sym);
  const vol = safeCall(() => ns.stock.getVolatility(sym), 0) || 0;
  const pos = ns.stock.getPosition(sym);
  const [longShares, longAvg, shortShares, shortAvg] = pos;

  let forecast = 0.5;
  if (has4S) {
    forecast = safeCall(() => ns.stock.getForecast(sym), 0.5) || 0.5;
  }

  let signal = 0;
  let score = 0;

  if (has4S) {
    signal = forecast > 0.5 ? 1 : forecast < 0.5 ? -1 : 0;
    score = Math.abs(forecast - 0.5) * (1 + vol * 10);
  } else {
    const delta = price - prevPrice;
    signal = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    score = Math.abs(delta / Math.max(1, prevPrice));
  }

  if (!canShort && signal < 0) {
    signal = 0;
    score = 0;
  }

  return {
    sym,
    price,
    vol,
    forecast,
    signal,
    score,
    longShares,
    longAvg,
    shortShares,
    shortAvg,
  };
}

function maybeSell(ns, s, has4S, commission) {
  const { sym, price, longShares, longAvg, shortShares, shortAvg } = s;

  if (longShares > 0) {
    const pnl = longShares * (price - longAvg) - commission;
    const shouldSell = has4S
      ? s.forecast < 0.5
      : s.signal < 0 || pnl < -commission * 2;

    if (shouldSell) {
      ns.stock.sellStock(sym, longShares);
    }
  }

  if (shortShares > 0) {
    const pnl = shortShares * (shortAvg - price) - commission;
    const shouldSell = has4S
      ? s.forecast > 0.5
      : s.signal > 0 || pnl < -commission * 2;

    if (shouldSell) {
      ns.stock.sellShort(sym, shortShares);
    }
  }
}

function maybeBuy(ns, s, has4S, canShort, budget, commission, minForecastEdge) {
  const { sym, price, longShares, shortShares } = s;
  if (budget <= commission * 2) return 0;

  const maxShares = ns.stock.getMaxShares(sym);
  const remainingLong = Math.max(0, maxShares - longShares);
  const remainingShort = Math.max(0, maxShares - shortShares);

  if (has4S && Math.abs(s.forecast - 0.5) < minForecastEdge) return 0;

  const affordableShares = Math.floor((budget - commission) / Math.max(1, price));
  if (affordableShares <= 0) return 0;

  if (s.signal > 0 && remainingLong > 0) {
    const shares = Math.min(remainingLong, affordableShares);
    if (shares > 0) {
      ns.stock.buyStock(sym, shares);
      return shares * price + commission;
    }
  }

  if (canShort && s.signal < 0 && remainingShort > 0) {
    const shares = Math.min(remainingShort, affordableShares);
    if (shares > 0) {
      ns.stock.buyShort(sym, shares);
      return shares * price + commission;
    }
  }

  return 0;
}

function render(ns, symbols, has4S, canShort, cfg) {
  ns.clearLog();

  const cash = ns.getServerMoneyAvailable("home");
  ns.print(`Mode: ${has4S ? "4S" : "Momentum"}${canShort ? " + Shorts" : ""}`);
  ns.print(`Cash: ${formatMoney(cash)}`);
  ns.print(`Reserve: ${formatMoney(cfg.reserve)}`);
  if (cfg.homeUpgradeTarget > 0) {
    ns.print(
      `Home target: ${formatMoney(cfg.homeUpgradeTarget)} x ${cfg.homeReserveBuffer.toFixed(2)} ` +
      `= ${formatMoney(Math.ceil(cfg.homeUpgradeTarget * cfg.homeReserveBuffer))}`
    );
    ns.print(`Home lock: ${cfg.hardLockForHome ? "ON" : "off"}`);
  }
  ns.print(`Spendable: ${formatMoney(cfg.spendable)}`);
  ns.print("");

  const rows = [];

  for (const sym of symbols) {
    const price = ns.stock.getPrice(sym);
    const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);
    const forecast = has4S ? safeCall(() => ns.stock.getForecast(sym), 0.5) : 0.5;
    const vol = safeCall(() => ns.stock.getVolatility(sym), 0) || 0;

    const longPnl = longShares > 0 ? longShares * (price - longAvg) : 0;
    const shortPnl = shortShares > 0 ? shortShares * (shortAvg - price) : 0;
    const totalShares = longShares + shortShares;

    if (totalShares > 0 || (has4S && Math.abs(forecast - 0.5) >= 0.03)) {
      rows.push({
        sym,
        forecast,
        vol,
        longShares,
        shortShares,
        pnl: longPnl + shortPnl,
      });
    }
  }

  rows.sort((a, b) => Math.abs((b.forecast ?? 0.5) - 0.5) - Math.abs((a.forecast ?? 0.5) - 0.5));

  for (const r of rows.slice(0, 12)) {
    const side =
      r.longShares > 0 ? `L ${r.longShares}` :
      r.shortShares > 0 ? `S ${r.shortShares}` :
      "-";

    ns.print(
      `${r.sym.padEnd(6)} | ${side.toString().padEnd(10)} | ` +
      `F ${(r.forecast ?? 0.5).toFixed(3)} | ` +
      `V ${r.vol.toFixed(3)} | ` +
      `PnL ${formatMoney(r.pnl)}`
    );
  }
}

function hasTixApi(ns) {
  return safeCall(() => ns.stock.hasTIXAPIAccess?.(), false);
}

function safeCall(fn, fallback) {
  try {
    const v = fn();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return n.toFixed(2);
}