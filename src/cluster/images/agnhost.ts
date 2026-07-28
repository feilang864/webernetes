import type { ProcessContext } from "../cri/index.js";
import { BaseImage } from "./base.js";

export class AgnhostImage extends BaseImage {
	static readonly imageName = "registry.k8s.io/e2e-test-images/agnhost";
	static readonly imageVersion = "2.40";

	readonly defaultCommand = ["agnhost"];
	private delayShutdownMs = 0;

	override async exec(ctx: ProcessContext, argv: readonly string[]): Promise<number> {
		const netexecIndex = argv.findIndex((arg) => arg.endsWith("agnhost") || arg === "netexec");
		const commandIndex = argv[netexecIndex] === "netexec" ? netexecIndex : netexecIndex + 1;
		if (argv[commandIndex] !== "netexec") {
			if (argv[0] === "agnhost") {
				return await ctx.waitUntilKilled();
			}
			return await super.exec(ctx, argv);
		}
		const args = argv.slice(commandIndex + 1);
		const port = parsePort(args) ?? 8080;
		this.delayShutdownMs = parseDelayShutdownMs(args);
		ctx.listenHttp(port, async (_ctx, request) => {
			const url = request.url;
			switch (url.pathname) {
				case "/healthz":
				case "/readyz":
					return { status: 200, body: "ok\n" };
				case "/exit":
					return this.exitResponse(ctx, url);
				case "/echo":
					return {
						status: Number(url.searchParams.get("code") ?? "200"),
						body: url.searchParams.get("msg") ?? "ok",
					};
				case "/redirect":
					return { status: 302, header: { Location: ["/echo"] }, body: "" };
				case "/shell":
					return await this.shellResponse(ctx, url.searchParams.get("cmd") ?? "");
				default:
					return { status: 404, body: "not found\n" };
			}
		});
		return await ctx.waitUntilKilled();
	}

	signalHandler(ctx: ProcessContext, signal: "SIGTERM" | "SIGKILL"): void {
		if (signal === "SIGTERM") {
			ctx.setTimeout(() => ctx.exit(0), this.delayShutdownMs);
		}
	}

	private exitResponse(ctx: ProcessContext, url: URL): { status: number; body: string } {
		const code = parseExitCode(url.searchParams.get("code"));
		const waitMs = parseDurationMs(url.searchParams.get("wait"));
		void (async () => {
			await ctx.sleep(waitMs);
			ctx.exit(code);
		})().catch(() => {});
		return { status: 200, body: "" };
	}

	private async shellResponse(
		ctx: ProcessContext,
		command: string,
	): Promise<{ status: number; body: string }> {
		let stdout = "";
		let stderr = "";
		let code = 0;
		for (const segment of command.split(";")) {
			const argv = this.splitShellWords(segment);
			if (argv.length === 0) {
				continue;
			}
			const process = ctx.exec(argv);
			code = await process.wait();
			stdout += process.stdout;
			stderr += process.stderr;
			if (code !== 0) {
				break;
			}
		}

		const response: { output?: string; error?: string } = {};
		if (stdout) {
			response.output = stdout;
		}
		if (code !== 0 || stderr) {
			response.error = stderr || `exit status ${code}`;
		}
		return { status: 200, body: JSON.stringify(response) };
	}
}

function parseExitCode(value: string | null): number {
	const code = Number(value ?? "0");
	if (!Number.isInteger(code) || code < 0 || code > 127) {
		return 0;
	}
	return code;
}

function parseDurationMs(value: string | null): number {
	if (!value) {
		return 0;
	}
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value);
	if (!match) {
		return 0;
	}
	const amount = Number(match[1]);
	switch (match[2] ?? "ns") {
		case "h":
			return amount * 60 * 60 * 1000;
		case "m":
			return amount * 60 * 1000;
		case "s":
			return amount * 1000;
		case "ms":
			return amount;
		default:
			return 0;
	}
}

function parseDelayShutdownMs(argv: readonly string[]): number {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		const [flag, inline] = arg.split("=", 2);
		if (flag !== "--delay-shutdown") {
			continue;
		}
		const seconds = Number(inline ?? argv[index + 1]);
		return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0;
	}
	return 0;
}

function parsePort(argv: readonly string[]): number | undefined {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		const [flag, inline] = arg.split("=", 2);
		if (flag !== "--http-port" && flag !== "-http-port") {
			continue;
		}
		const value = inline ?? argv[index + 1];
		const port = Number(value);
		return Number.isInteger(port) ? port : undefined;
	}
	return undefined;
}
