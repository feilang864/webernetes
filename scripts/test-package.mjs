import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const temporaryRoot = mkdtempSync(join(tmpdir(), "webernetes-package-"));
const packageDirectory = join(temporaryRoot, "project", "node_modules", "@ngrok");

try {
	mkdirSync(packageDirectory, { recursive: true });

	execFileSync("pnpm", ["pack", "--pack-destination", temporaryRoot], {
		cwd: packageRoot,
		stdio: "pipe",
	});

	const tarballName = readdirSync(temporaryRoot).find((name) => name.endsWith(".tgz"));
	if (tarballName === undefined) {
		throw new Error("pnpm pack did not create a tarball");
	}
	const tarball = join(temporaryRoot, tarballName);
	execFileSync("tar", ["-xzf", tarball, "-C", packageDirectory]);
	renameSync(join(packageDirectory, "package"), join(packageDirectory, "webernetes"));

	execFileSync(
		process.execPath,
		["--input-type=module", "--eval", 'await import("@ngrok/webernetes");'],
		{
			cwd: join(temporaryRoot, "project"),
			stdio: "inherit",
		},
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}
