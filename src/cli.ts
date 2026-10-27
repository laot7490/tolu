import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import fg from "fast-glob";
import { convertFiles } from "./convert.js";
import { banner, err, info, ok, version } from "./log.js";

type BuildOptions = {
	output: string;
	watch?: boolean;
};

async function resolveInputs(inputs: string[]): Promise<string[]> {
	const files = await fg(inputs, {
		absolute: true,
		onlyFiles: true,
	});
	files.sort();
	return files;
}

async function runGenerate(inputs: string[], output: string): Promise<void> {
	const files = await resolveInputs(inputs);
	if (files.length === 0) {
		err(`No files matched: ${inputs.join(", ")}`);
		process.exitCode = 1;
		return;
	}

	const start = Date.now();
	const lua = convertFiles(files);
	const outPath = path.resolve(output);
	await mkdir(path.dirname(outPath), { recursive: true });
	await writeFile(outPath, lua, "utf8");

	const n = files.length;
	ok(`wrote ${outPath} (${n} file${n === 1 ? "" : "s"}) in ${Date.now() - start}ms`);
}

async function watchGenerate(inputs: string[], output: string): Promise<void> {
	const { default: chokidar } = await import("chokidar");

	banner("watching for changes...");
	await runGenerate(inputs, output);

	const watcher = chokidar.watch(inputs, {
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
	});

	info(`Watching ${inputs.join(", ")} (Ctrl+C to stop)\n`);

	const regenerate = async () => {
		try {
			await runGenerate(inputs, output);
		} catch (e) {
			err(e instanceof Error ? e.message : String(e));
		}
	};

	watcher.on("add", regenerate);
	watcher.on("change", regenerate);
	watcher.on("unlink", regenerate);
	watcher.on("error", (e) => {
		err(`Watcher error: ${e instanceof Error ? e.message : String(e)}`);
	});
}

async function buildAction(inputs: string[], options: BuildOptions): Promise<void> {
	if (!inputs.length) {
		err("At least one input file or glob is required");
		process.exit(1);
	}

	if (options.watch) {
		await watchGenerate(inputs, options.output);
		return;
	}

	banner("generating types...");
	await runGenerate(inputs, options.output);
	if (process.exitCode) process.exit(process.exitCode);
}

const program = new Command();

program.name("tolu").description("Convert TypeScript types to EmmyLua annotations").version(version);

program
	.command("build")
	.alias("generate")
	.description("Convert TypeScript types to EmmyLua annotations")
	.argument("[inputs...]", "TypeScript files or globs")
	.requiredOption("-o, --output <file>", "Output .lua file")
	.option("-w, --watch", "Watch inputs and regenerate on change")
	.action(async (inputs: string[], options: BuildOptions) => {
		try {
			await buildAction(inputs, options);
		} catch (e) {
			err(e instanceof Error ? e.message : String(e));
			process.exit(1);
		}
	});

if (process.argv.length <= 2) {
	program.help();
} else {
	program.parse(process.argv);
}
