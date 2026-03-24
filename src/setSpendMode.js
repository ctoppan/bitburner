/** @param {NS} ns **/
export async function main(ns) {
  const MODE_KEY = "bb_spend_mode_v1";
  const AUG_RESERVE_KEY = "bb_aug_reserve_v1";
  const validModes = new Set(["growth", "balanced", "save_for_augs"]);

  const modeArg = String(ns.args[0] ?? "").trim();
  const reserveArg = ns.args[1];

  if (!modeArg || modeArg === "help" || modeArg === "--help" || modeArg === "-h") {
    ns.tprint("Usage: run setSpendMode.js [growth|balanced|save_for_augs] [augReserve]");
    ns.tprint("Examples:");
    ns.tprint("  run setSpendMode.js growth");
    ns.tprint("  run setSpendMode.js balanced");
    ns.tprint("  run setSpendMode.js save_for_augs 75000000000");
    return;
  }

  if (!validModes.has(modeArg)) {
    ns.tprint(`Invalid mode: ${modeArg}`);
    ns.tprint("Valid modes: growth, balanced, save_for_augs");
    return;
  }

  try {
    localStorage.setItem(MODE_KEY, JSON.stringify(modeArg));

    if (reserveArg !== undefined) {
      const reserve = Number(reserveArg);
      if (!Number.isFinite(reserve) || reserve < 0) {
        ns.tprint(`Invalid aug reserve: ${reserveArg}`);
        return;
      }
      localStorage.setItem(AUG_RESERVE_KEY, JSON.stringify(reserve));
      ns.tprint(`Spend mode set to ${modeArg} with aug reserve ${ns.formatNumber(reserve)}`);
    } else {
      ns.tprint(`Spend mode set to ${modeArg}`);
    }
  } catch (err) {
    ns.tprint(`Failed to store spend mode: ${String(err)}`);
  }
}
