import { readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

function findEntryPoints(dir: string): Record<string, string> {
	const entries: Record<string, string> = {};

	function walk(currentDir: string) {
		const items = readdirSync(currentDir, { withFileTypes: true });
		for (const item of items) {
			const fullPath = join(currentDir, item.name);
			if (item.isDirectory()) {
				walk(fullPath);
			} else if (item.name === "index.ts" && !item.name.includes(".test.")) {
				// Use the parent directory path as the entry name
				// e.g. "functions/token-vending/index.ts" -> "token-vending/index"
				const rel = relative(dir, fullPath);
				const name = join(dirname(rel), "index");
				entries[name] = fullPath;
			}
		}
	}

	walk(dir);
	return entries;
}

const entryPoints = findEntryPoints("./functions");

export default {
	noExternal: [/(.*)/],
	entry: entryPoints,
};
