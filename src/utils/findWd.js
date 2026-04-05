/** @param {NS} ns **/
export async function main(ns) {
    const start = "home";
    const target = "w0r1d_d43m0n";

    if (!ns.serverExists(target)) {
        ns.tprint(`ERROR: ${target} not found.`);
        return;
    }

    const path = findPath(ns, start, target);
    if (!path) {
        ns.tprint(`ERROR: No path found from ${start} to ${target}.`);
        return;
    }

    const connectPath = path.join("; connect ");
    ns.tprint(`Path to ${target}:`);
    ns.tprint(connectPath);
    ns.tprint("");
    ns.tprint("Paste this into terminal:");
    ns.tprint(`home; connect ${connectPath}`);
}

function findPath(ns, start, target) {
    const queue = [[start]];
    const seen = new Set([start]);

    while (queue.length > 0) {
        const path = queue.shift();
        const host = path[path.length - 1];

        if (host === target) {
            return path.slice(1);
        }

        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push([...path, next]);
            }
        }
    }

    return null;
}