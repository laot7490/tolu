import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export { version };

export function banner(action: string): void {
	console.log(`\n\x1b[36m⚡ tolu v${version}\x1b[0m \x1b[32m${action}\x1b[0m`);
}

export function ok(msg: string): void {
	console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

export function err(msg: string): void {
	console.log(`\x1b[31m✖ ${msg}\x1b[0m`);
}

export function info(msg: string): void {
	console.log(`\x1b[90mℹ ${msg}\x1b[0m`);
}

export function warn(msg: string): void {
	console.log(`\x1b[33m! ${msg}\x1b[0m`);
}
