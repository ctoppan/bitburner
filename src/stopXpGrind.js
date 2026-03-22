/** @param {NS} ns **/
export async function main(ns) {
  const worker = "xpGrind.js";
  const seen = new Set(["home"]);
  const queue = ["home"];
  let killed = 0;

  while (queue.length > 0) {
    const host = queue.shift();

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }

    for (const proc of ns.ps(host)) {
      if (proc.filename === worker) {
        try {
          ns.kill(proc.pid);
          killed++;
        } catch {}
      }
    }
  }

  ns.tprint(`Stopped ${killed} xpGrind.js processes.`);
}