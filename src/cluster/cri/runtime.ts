import type { Clock } from "../../clock";
import { getClock } from "../../clock-context";
import { Channel, ReadOnlyChannel, select } from "../../go/channel";
import * as context from "../../go/context";
import * as time from "../../go/time";
import type { KubeConfig } from "../../client/config";
import {
	AppsV1Api,
	CoreV1Api,
	DiscoveryV1Api,
	type KubeClient,
	type V1Container,
} from "../../client";
import { newCommandTimedOutError } from "../cri-client/pkg";
import { getLatencyProvider } from "../../latency";
import type { DnsHandler, DnsListener } from "../cni/dns";
import * as http from "../cni/http";
import { ClusterNetwork, type NetworkRegistration } from "../cni/network";
import { parseContainerID } from "../kubelet/container/runtime";
import type { ImageDefinition, ImageSignal } from "./image";
import { ImageRegistry } from "./image";
import type { ImageManagerService, RuntimeService, ServiceError } from "./apis/services";
import type {
	Container,
	ContainerConfig,
	ContainerFilter,
	ContainerPort,
	CheckpointContainerRequest,
	ContainerStatus,
	ContainerStatusResponse,
	ExecSyncResponse,
	Image,
	ImageFilter,
	ImageFsInfoResponse,
	ImageSpec,
	ImageStatusResponse,
	MetricDescriptor,
	PodSandbox,
	PodSandboxConfig,
	PodSandboxFilter,
	PodSandboxMetrics,
	PodSandboxState,
	PodSandboxStatus,
	PodSandboxStatusResponse,
	StatusResponse,
	UpdateRuntimeConfigRequest,
	VersionResponse,
} from "./runtime/v1/api";

function rawContainerID(id: string): string {
	const parsed = parseContainerID(id);
	return parsed.isEmpty() ? id.replace(/^"+|"+$/g, "") : parsed.id;
}

function errorFromUnknown(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function latencyMillis(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

async function waitForLatency(ctx: context.Context, latencyMs: number): Promise<void> {
	if (!(latencyMs > 0)) {
		return;
	}
	const selected = await select()
		.case(ctx.done(), () => ctx.err() ?? context.Canceled)
		.case(time.after(ctx, latencyMs), () => undefined);
	if (selected) {
		throw selected;
	}
}

export interface ExecOptions {
	timeoutMs?: number;
}

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface RuntimeOptions {
	ctx: context.Context;
	kubeConfig: KubeConfig;
	network: ClusterNetwork;
	podCIDR: string;
	imageRegistry: ImageRegistry;
	idPrefix?: string;
}

export interface RuntimeDiagnostics {
	sandboxCount(): number;
	containerCount(): number;
	processCount(): number;
	processListenerCount(): number;
}

class ProcessExit extends Error {
	constructor(readonly code: number) {
		super(`process exited with code ${code}`);
	}
}

type ProcessTask = () => void | Promise<void>;

function isMissingExecutable(cmd: readonly string[], exitCode: number, stderr: string): boolean {
	const command = cmd[0];
	return command !== undefined && exitCode === 127 && stderr === `${command}: not found\n`;
}

function missingExecutableError(containerId: string, command: string): Error {
	return new Error(
		`rpc error: code = Unknown desc = failed to exec in container: failed to start exec in container ${containerId}: OCI runtime exec failed: exec failed: unable to start container process: exec: "${command}": executable file not found in $PATH`,
	);
}

function containerHash(config: ContainerConfig): number {
	const value = config.annotations?.["io.kubernetes.container.hash"];
	if (value === undefined) {
		return 0;
	}
	const parsed = Number.parseInt(value, 16);
	return Number.isFinite(parsed) ? parsed : 0;
}

export type ProcessState = "Created" | "Running" | "Exited";

export class InProcessRuntimeService
	implements RuntimeService, ImageManagerService, RuntimeDiagnostics
{
	readonly clock: Clock;
	readonly kubeConfig: KubeConfig;
	readonly network: ClusterNetwork;
	readonly imageRegistry: ImageRegistry;
	private readonly podCIDR: string;
	private readonly idPrefix: string;
	private readonly sandboxes = new Map<string, PodSandboxInstance>();
	private readonly containers = new Map<string, ContainerInstance>();
	private readonly processes = new Map<number, ProcessInstance>();
	private readonly ctx: context.Context;
	private readonly cancelContext: context.CancelFunc;
	private nextSandboxId = 1;
	private nextContainerId = 1;
	private nextPid = 1;

	constructor(options: RuntimeOptions) {
		this.clock = getClock(options.ctx);
		this.kubeConfig = options.kubeConfig;
		this.network = options.network;
		this.imageRegistry = options.imageRegistry;
		this.podCIDR = options.podCIDR;
		this.idPrefix = options.idPrefix ?? "";
		[this.ctx, this.cancelContext] = context.withCancel(options.ctx);
	}

	// --------------------------------------------------------------------------
	// RuntimeVersioner
	// --------------------------------------------------------------------------
	async version(
		_ctx: context.Context,
		apiVersion: string,
	): Promise<[response: VersionResponse, err: ServiceError]> {
		return [
			{
				version: apiVersion,
				runtimeName: "simulator",
				runtimeVersion: "0.0.0",
				runtimeApiVersion: apiVersion,
			},
			undefined,
		];
	}

	// --------------------------------------------------------------------------
	// PodSandboxManager
	// --------------------------------------------------------------------------
	async runPodSandbox(
		_ctx: context.Context,
		config: PodSandboxConfig,
		_runtimeHandler?: string,
	): Promise<[podSandboxId: string, err: ServiceError]> {
		try {
			const sandbox = new PodSandboxInstance(
				`${this.idPrefix}sandbox-${this.nextSandboxId++}`,
				config,
				this.clock.nowMs(),
			);
			sandbox.setNetworkRegistration(this.network.setupPodSandbox(sandbox, this.podCIDR));
			this.sandboxes.set(sandbox.id, sandbox);
			return [sandbox.id, undefined];
		} catch (error) {
			return ["", errorFromUnknown(error)];
		}
	}

	async stopPodSandbox(ctx: context.Context, podSandboxId: string): Promise<ServiceError> {
		const sandbox = this.sandboxes.get(rawContainerID(podSandboxId));
		if (!sandbox) {
			return undefined;
		}
		try {
			for (const container of sandbox.containers.values()) {
				await container.stop(ctx);
			}
			sandbox.unregisterNetwork();
			return undefined;
		} catch (error) {
			return errorFromUnknown(error);
		}
	}

	async removePodSandbox(ctx: context.Context, podSandboxId: string): Promise<ServiceError> {
		const rawPodSandboxId = rawContainerID(podSandboxId);
		const sandbox = this.sandboxes.get(rawPodSandboxId);
		if (!sandbox) {
			return undefined;
		}
		const stopErr = await this.stopPodSandbox(ctx, rawPodSandboxId);
		if (stopErr) {
			return stopErr;
		}
		for (const container of [...sandbox.containers.values()]) {
			const removeErr = await this.removeContainer(ctx, container.id);
			if (removeErr) {
				return removeErr;
			}
		}
		this.sandboxes.delete(rawPodSandboxId);
		return undefined;
	}

	async podSandboxStatus(
		_ctx: context.Context,
		podSandboxId: string,
		_verbose?: boolean,
	): Promise<[response: PodSandboxStatusResponse | undefined, err: ServiceError]> {
		const [sandbox, err] = this.sandbox(podSandboxId);
		if (err || !sandbox) {
			return [undefined, err];
		}
		return [
			{
				status: sandbox.status(),
				containersStatuses: [...sandbox.containers.values()].map((container) => container.status()),
				timestamp: this.clock.nowMs(),
			},
			undefined,
		];
	}

	async listPodSandbox(
		_ctx: context.Context,
		filter?: PodSandboxFilter,
	): Promise<[items: PodSandbox[], err: ServiceError]> {
		return [
			[...this.sandboxes.values()]
				.filter((sandbox) => this.matchesPodSandboxFilter(sandbox, filter))
				.map((sandbox) => this.toPodSandbox(sandbox)),
			undefined,
		];
	}

	// --------------------------------------------------------------------------
	// Local lifecycle
	// --------------------------------------------------------------------------
	async close(): Promise<void> {
		this.cancelContext();
		for (const sandbox of [...this.sandboxes.values()]) {
			const err = await this.removePodSandbox(this.ctx, sandbox.id);
			if (err) {
				throw err;
			}
		}
		for (const process of [...this.processes.values()]) {
			await process.kill("SIGKILL");
		}
	}

	// --------------------------------------------------------------------------
	// RuntimeDiagnostics
	// --------------------------------------------------------------------------
	sandboxCount(): number {
		return this.sandboxes.size;
	}

	containerCount(): number {
		return this.containers.size;
	}

	processCount(): number {
		return this.processes.size;
	}

	processListenerCount(): number {
		return [...this.processes.values()].reduce(
			(total, process) => total + process.listenerCount(),
			0,
		);
	}

	// --------------------------------------------------------------------------
	// ContainerManager
	// --------------------------------------------------------------------------
	async createContainer(
		_ctx: context.Context,
		podSandboxId: string,
		config: ContainerConfig,
		sandboxConfig: PodSandboxConfig,
	): Promise<[containerId: string, err: ServiceError]> {
		const [sandbox, sandboxErr] = this.sandbox(podSandboxId);
		if (sandboxErr || !sandbox) {
			return ["", sandboxErr];
		}
		if (sandbox.uid !== sandboxConfig.metadata.uid) {
			return [
				"",
				new Error(`sandbox config uid ${sandboxConfig.metadata.uid} does not match ${sandbox.uid}`),
			];
		}
		if (!this.imageRegistry.has(config.image.image)) {
			return ["", new Error(`image ${config.image.image} not found`)];
		}
		const container = new ContainerInstance(
			`${this.idPrefix}container-${this.nextContainerId++}`,
			sandbox,
			config,
			() => this.imageRegistry.create(config.image.image),
			this,
		);
		sandbox.containers.set(container.id, container);
		this.containers.set(container.id, container);
		return [container.id, undefined];
	}

	async startContainer(_ctx: context.Context, containerId: string): Promise<ServiceError> {
		const [container, err] = this.container(containerId);
		if (err || !container) {
			return err;
		}
		try {
			container.start();
			return undefined;
		} catch (error) {
			return errorFromUnknown(error);
		}
	}

	async stopContainer(
		ctx: context.Context,
		containerId: string,
		timeout?: number,
	): Promise<ServiceError> {
		const [container, err] = this.container(rawContainerID(containerId));
		if (err || !container) {
			return err;
		}
		try {
			await container.stop(ctx, timeout ?? 0);
			return undefined;
		} catch (error) {
			return errorFromUnknown(error);
		}
	}

	async removeContainer(ctx: context.Context, containerId: string): Promise<ServiceError> {
		const rawId = rawContainerID(containerId);
		const container = this.containers.get(rawId);
		if (!container) {
			return undefined;
		}
		try {
			await container.stop(ctx);
			container.sandbox.containers.delete(container.id);
			this.containers.delete(rawId);
			return undefined;
		} catch (error) {
			return errorFromUnknown(error);
		}
	}

	async listContainers(
		_ctx: context.Context,
		filter?: ContainerFilter,
	): Promise<[containers: Container[], err: ServiceError]> {
		return [
			[...this.containers.values()]
				.filter((container) => this.matchesContainerFilter(container, filter))
				.map((container) => this.toCRIContainer(container)),
			undefined,
		];
	}

	async containerStatus(
		_ctx: context.Context,
		containerId: string,
		_verbose?: boolean,
	): Promise<[response: ContainerStatusResponse | undefined, err: ServiceError]> {
		const [container, err] = this.container(rawContainerID(containerId));
		if (err || !container) {
			return [undefined, err];
		}
		return [{ status: container.status() }, undefined];
	}

	async execSync(
		ctx: context.Context,
		containerId: string,
		cmd: string[],
		timeoutSeconds?: number,
	): Promise<[response: ExecSyncResponse | undefined, err: ServiceError]> {
		const [container, err] = this.container(containerId);
		if (err || !container) {
			return [undefined, err];
		}
		const timeoutMs = timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
		try {
			const process = container.exec(cmd, { timeoutMs });
			const exitCode = await this.waitForProcess(ctx, process, timeoutMs, cmd);
			if (isMissingExecutable(cmd, exitCode, process.stderr)) {
				return [undefined, missingExecutableError(containerId, cmd[0] ?? "")];
			}
			return [{ exitCode, stdout: process.stdout, stderr: process.stderr }, undefined];
		} catch (error) {
			return [undefined, errorFromUnknown(error)];
		}
	}

	async checkpointContainer(
		_ctx: context.Context,
		_options: CheckpointContainerRequest,
	): Promise<ServiceError> {
		return new Error("checkpointContainer is not supported");
	}

	// --------------------------------------------------------------------------
	// ImageManagerService
	// --------------------------------------------------------------------------
	async pullImage(
		_ctx: context.Context,
		image: ImageSpec,
		_credentials: unknown[],
		_podSandboxConfig?: PodSandboxConfig,
	): Promise<[imageRef: string, err: Error | undefined]> {
		if (!this.imageRegistry.has(image.image)) {
			return [
				"",
				new Error(
					`rpc error: code = NotFound desc = failed to pull and unpack image "${image.image}": failed to resolve reference "${image.image}": ${image.image}: not found`,
				),
			];
		}
		// TODO(samwho): inject latency here to simulate real pulling.
		return [image.image, undefined];
	}

	async imageStatus(
		_ctx: context.Context,
		image: ImageSpec,
		_verbose?: boolean,
	): Promise<[response: ImageStatusResponse | undefined, err: ServiceError]> {
		if (!this.imageRegistry.has(image.image)) {
			return [{ image: undefined }, undefined];
		}
		return [
			{
				image: this.toRuntimeAPIImage(image),
			},
			undefined,
		];
	}

	async listImages(
		_ctx: context.Context,
		filter?: ImageFilter,
	): Promise<[images: Image[], err: ServiceError]> {
		const images: Image[] = [];
		for (const image of this.imageRegistry.list()) {
			if (filter?.image?.image !== undefined && filter.image.image !== image) {
				continue;
			}
			images.push(this.toRuntimeAPIImage({ image }));
		}
		return [images, undefined];
	}

	async removeImage(_ctx: context.Context, image: ImageSpec): Promise<ServiceError> {
		// Kubernetes expects removing an image that is not local to be a no-op.
		this.imageRegistry.remove(image.image);
		return undefined;
	}

	async imageFsInfo(
		_ctx: context.Context,
	): Promise<[response: ImageFsInfoResponse, err: ServiceError]> {
		return [{ imageFilesystems: [], containerFilesystems: [] }, undefined];
	}

	// --------------------------------------------------------------------------
	// RuntimeService
	// --------------------------------------------------------------------------
	async status(
		_ctx: context.Context,
		_verbose?: boolean,
	): Promise<[response: StatusResponse, err: ServiceError]> {
		return [
			{
				status: {
					conditions: [
						{ type: "RuntimeReady", status: true },
						{ type: "NetworkReady", status: true },
					],
				},
			},
			undefined,
		];
	}

	async updateRuntimeConfig(
		_ctx: context.Context,
		_config: UpdateRuntimeConfigRequest,
	): Promise<ServiceError> {
		return new Error("updateRuntimeConfig is not supported");
	}

	async listMetricDescriptors(
		_ctx: context.Context,
	): Promise<[descriptors: MetricDescriptor[], err: ServiceError]> {
		return [[], new Error("listMetricDescriptors is not supported")];
	}

	async listPodSandboxMetrics(
		_ctx: context.Context,
	): Promise<[metrics: PodSandboxMetrics[], err: ServiceError]> {
		return [[], new Error("listPodSandboxMetrics is not supported")];
	}

	createProcess(
		container: ContainerInstance,
		argv: readonly string[],
		run: (context: ProcessContext, argv: readonly string[]) => Promise<number>,
		signalHandler?: (context: ProcessContext, signal: ImageSignal) => Promise<void> | void,
	): ProcessInstance {
		const process = new ProcessInstance(
			this.ctx,
			this.nextPid++,
			container,
			argv,
			run,
			signalHandler,
			this,
		);
		this.processes.set(process.pid, process);
		void process.wait().finally(() => {
			this.processes.delete(process.pid);
		});
		return process;
	}

	async sleep(ctx: context.Context, ms: number, exitCode: () => number): Promise<void> {
		if (ctx.err()) {
			return Promise.reject(new ProcessExit(exitCode()));
		}
		const selected = await select()
			.case(ctx.done(), () => "done")
			.case(time.after(ctx, ms), () => "timeout");
		if (selected === "done") {
			throw new ProcessExit(exitCode());
		}
	}

	// --------------------------------------------------------------------------
	// Private helpers
	// --------------------------------------------------------------------------
	private async waitForProcess(
		ctx: context.Context,
		process: ProcessInstance,
		timeoutMs: number | undefined,
		cmd: readonly string[],
	): Promise<number> {
		const waitCh = new Channel<number>(1);
		void process.wait().then((code) => {
			waitCh.trySend(code);
			return undefined;
		});

		if (timeoutMs === undefined) {
			const selected = await select()
				.case(waitCh, ({ value }) => ({ type: "exit" as const, code: value ?? 0 }))
				.case(ctx.done(), () => ({ type: "canceled" as const }));
			if (selected.type === "exit") {
				return selected.code;
			}
			await process.kill("SIGKILL");
			return process.abortExitCode;
		}

		let timeoutHandle: number | undefined;
		const timeoutCh = new Channel<void>(1);
		timeoutHandle = this.clock.setTimeout(() => {
			timeoutCh.trySend(undefined);
		}, timeoutMs);
		try {
			const selected = await select()
				.case(waitCh, ({ value }) => ({ type: "exit" as const, code: value ?? 0 }))
				.case(ctx.done(), () => ({ type: "canceled" as const }))
				.case(timeoutCh, () => ({ type: "timeout" as const }));
			if (selected.type === "exit") {
				return selected.code;
			}
			await process.kill("SIGKILL");
			if (selected.type === "timeout") {
				throw newCommandTimedOutError(cmd);
			}
			return process.abortExitCode;
		} finally {
			if (timeoutHandle !== undefined) {
				this.clock.clearTimeout(timeoutHandle);
			}
		}
	}

	private sandbox(
		podSandboxId: string,
	): [sandbox: PodSandboxInstance | undefined, err: ServiceError] {
		const rawId = rawContainerID(podSandboxId);
		const sandbox = this.sandboxes.get(rawId);
		if (!sandbox) {
			return [undefined, new Error(`pod sandbox ${podSandboxId} not found`)];
		}
		return [sandbox, undefined];
	}

	private container(
		containerId: string,
	): [container: ContainerInstance | undefined, err: ServiceError] {
		const rawId = rawContainerID(containerId);
		const container = this.containers.get(rawId);
		if (!container) {
			return [undefined, new Error(`container ${containerId} not found`)];
		}
		return [container, undefined];
	}

	private toRuntimeAPIImage(image: ImageSpec): Image {
		return {
			id: image.image,
			repoTags: [image.image],
			repoDigests: [],
			size: 0,
			spec: image,
			pinned: false,
		};
	}

	private toPodSandbox(sandbox: PodSandboxInstance): PodSandbox {
		const status = sandbox.status();
		return {
			id: status.id,
			metadata: { ...status.metadata },
			state: status.state,
			createdAt: status.createdAt,
			labels: { ...status.labels },
			annotations: { ...status.annotations },
		};
	}

	private toCRIContainer(container: ContainerInstance): Container {
		const status = container.status();
		return {
			id: status.id,
			podSandboxId: container.sandbox.id,
			metadata: { ...container.config.metadata },
			image: { ...container.config.image },
			imageRef: status.imageRef,
			state: status.state,
			createdAt: status.createdAt,
			labels: { ...(container.config.labels ?? {}) },
			annotations: { ...(container.config.annotations ?? {}) },
			imageId: status.imageRef,
		};
	}

	private matchesPodSandboxFilter(
		sandbox: PodSandboxInstance,
		filter: PodSandboxFilter | undefined,
	): boolean {
		if (!filter) {
			return true;
		}
		if (filter.id !== undefined && rawContainerID(filter.id) !== sandbox.id) {
			return false;
		}
		if (filter.state !== undefined && filter.state.state !== sandbox.status().state) {
			return false;
		}
		return this.matchesLabels(sandbox.status().labels, filter.labelSelector);
	}

	private matchesContainerFilter(
		container: ContainerInstance,
		filter: ContainerFilter | undefined,
	): boolean {
		if (!filter) {
			return true;
		}
		if (filter.id !== undefined && rawContainerID(filter.id) !== container.id) {
			return false;
		}
		if (
			filter.podSandboxId !== undefined &&
			rawContainerID(filter.podSandboxId) !== container.sandbox.id
		) {
			return false;
		}
		if (filter.state !== undefined && filter.state.state !== container.status().state) {
			return false;
		}
		return this.matchesLabels(container.config.labels ?? {}, filter.labelSelector);
	}

	private matchesLabels(
		labels: Record<string, string>,
		selector: Record<string, string> | undefined,
	): boolean {
		return Object.entries(selector ?? {}).every(([key, value]) => labels[key] === value);
	}
}

export class PodSandboxInstance {
	readonly labels: ReadonlyMap<string, string>;
	readonly annotations: ReadonlyMap<string, string>;
	readonly containers = new Map<string, ContainerInstance>();
	private registration: NetworkRegistration | undefined;
	private state: PodSandboxState = "NotReady";

	constructor(
		readonly id: string,
		readonly config: PodSandboxConfig,
		readonly createdAt: number,
	) {
		this.uid = config.metadata.uid;
		this.name = config.metadata.name;
		this.namespace = config.metadata.namespace;
		this.attempt = config.metadata.attempt;
		this.labels = new Map(Object.entries(config.labels ?? {}));
		this.annotations = new Map(Object.entries(config.annotations ?? {}));
	}

	readonly uid: string;
	readonly name: string;
	readonly namespace: string;
	readonly attempt: number;

	get ip(): string {
		return this.networkRegistration().ip;
	}

	setNetworkRegistration(registration: NetworkRegistration): void {
		this.registration = registration;
		this.state = "Ready";
	}

	networkRegistration(): NetworkRegistration {
		if (!this.registration) {
			throw new Error(`pod ${this.uid} is not registered on the network`);
		}
		return this.registration;
	}

	unregisterNetwork(): void {
		this.registration?.unregister();
		this.registration = undefined;
		this.state = "NotReady";
	}

	status(): PodSandboxStatus {
		const network = this.registration ? { ip: this.registration.ip } : undefined;
		return {
			id: this.id,
			metadata: this.config.metadata,
			state: this.state,
			createdAt: this.createdAt,
			network,
			labels: Object.fromEntries(this.labels),
			annotations: Object.fromEntries(this.annotations),
		};
	}
}

export class ContainerInstance {
	readonly command: readonly string[];
	readonly args: readonly string[];
	readonly env: ReadonlyMap<string, string>;
	readonly ports: readonly ContainerPort[];
	readonly restartCount: number;
	readonly createdAt: number;
	readonly apiContainer: V1Container;
	readonly fs = new ContainerFileSystem();
	private readonly image: ImageDefinition;
	private state: ContainerStatus["state"] = "Created";
	private mainProcess: ProcessInstance | undefined;
	private startedAtMs: number | undefined;
	private finishedAtMs: number | undefined;
	private lastExitCode: number | undefined;

	constructor(
		readonly id: string,
		readonly sandbox: PodSandboxInstance,
		readonly config: ContainerConfig,
		private readonly imageFactory: () => ImageDefinition | undefined,
		private readonly runtime: InProcessRuntimeService,
	) {
		this.name = config.metadata.name;
		this.restartCount = config.metadata.attempt;
		this.imageRef = config.image.image;
		this.command = config.command ?? [];
		this.args = config.args ?? [];
		this.env = new Map(Object.entries(config.env ?? {}));
		this.ports = config.ports ?? [];
		this.createdAt = runtime.clock.nowMs();
		this.apiContainer = config.sourceContainer;
		this.image = this.createImage();
	}

	readonly name: string;
	readonly imageRef: string;

	start(): ProcessInstance {
		if (this.state === "Running") {
			throw new Error(`container ${this.id} is already running`);
		}
		const argv = this.startArgv();
		const process = this.runtime.createProcess(
			this,
			argv,
			this.image.exec.bind(this.image),
			this.image.signalHandler?.bind(this.image),
		);
		this.state = "Running";
		this.startedAtMs = this.runtime.clock.nowMs();
		this.finishedAtMs = undefined;
		this.lastExitCode = undefined;
		this.mainProcess = process;
		void process.wait().then((exitCode) => {
			if (this.mainProcess !== process) {
				return undefined;
			}
			this.state = "Exited";
			this.finishedAtMs = process.finishedAt;
			this.lastExitCode = exitCode;
			return undefined;
		});
		process.start();
		return process;
	}

	exec(argv: string[], _options: ExecOptions = {}): ProcessInstance {
		const process = this.runtime.createProcess(this, argv, this.image.exec.bind(this.image));
		process.start();
		return process;
	}

	async stop(ctx: context.Context, timeoutSeconds = 0): Promise<void> {
		const process = this.mainProcess;
		if (process && process.state !== "Exited") {
			if (timeoutSeconds <= 0) {
				await process.kill("SIGKILL");
			} else {
				const signal = this.config.stopSignal ?? "SIGTERM";
				const timeoutMs = timeoutSeconds * 1000;
				const latencyMs = Math.min(
					latencyMillis(
						getLatencyProvider(ctx).containerTerminationLatency(ctx, {
							container: this.apiContainer,
						}),
					),
					timeoutMs,
				);
				if (latencyMs > 0) {
					await waitForLatency(ctx, latencyMs);
				}
				if (latencyMs >= timeoutMs) {
					await process.kill("SIGKILL");
				} else {
					await process.kill(signal);
				}
				if (!(await this.waitForProcessExitOrTimeout(ctx, process, timeoutMs - latencyMs))) {
					await process.kill("SIGKILL");
				}
			}
			await process.wait();
		}
		this.state = "Exited";
		this.finishedAtMs = this.runtime.clock.nowMs();
	}

	private async waitForProcessExitOrTimeout(
		ctx: context.Context,
		process: ProcessInstance,
		timeoutMs: number,
	): Promise<boolean> {
		const exited = new Channel<void>(1);
		void process.wait().then(() => {
			exited.trySend(undefined);
			return undefined;
		});
		const selected = await select()
			.case(exited, () => "exited" as const)
			.case(time.after(ctx, timeoutMs), () => "timedOut" as const)
			.case(ctx.done(), () => "canceled" as const);
		if (selected === "canceled") {
			throw ctx.err() ?? context.Canceled;
		}
		return selected === "exited";
	}

	status(): ContainerStatus {
		return {
			id: this.id,
			name: this.name,
			image: { ...this.config.image },
			imageRef: this.imageRef,
			imageId: this.imageRef,
			imageRuntimeHandler: "",
			hash: containerHash(this.config),
			state: this.state,
			restartCount: this.restartCount,
			createdAt: this.createdAt,
			startedAt: this.startedAtMs,
			finishedAt: this.finishedAtMs,
			exitCode: this.lastExitCode,
			labels: { ...(this.config.labels ?? {}) },
			annotations: { ...(this.config.annotations ?? {}) },
			ready: this.state === "Running",
		};
	}

	private createImage(): ImageDefinition {
		const image = this.imageFactory();
		if (!image) {
			throw new Error(`image ${this.imageRef} not found`);
		}
		return image;
	}

	private startArgv(): readonly string[] {
		const command = this.command.length > 0 ? this.command : (this.image.defaultCommand ?? []);
		return [...command, ...this.args];
	}
}

export class ProcessInstance {
	private processState: ProcessState = "Created";
	private finishedAtMs: number | undefined;
	private processExitCode: number | undefined;
	private killedExitCode: number | undefined;
	private stdoutBuffer = "";
	private stderrBuffer = "";
	readonly ctx: context.Context;
	private readonly cancelContext: context.CancelFunc;
	private readonly timeoutHandles = new Set<number>();
	private readonly intervalHandles = new Set<number>();
	private readonly listeners: Array<{ close(): void }> = [];
	private resolveWait: (code: number) => void = () => {};
	private readonly waitPromise = new Promise<number>((resolve) => {
		this.resolveWait = resolve;
	});

	constructor(
		ctx: context.Context,
		readonly pid: number,
		readonly container: ContainerInstance,
		readonly argv: readonly string[],
		private readonly run: (context: ProcessContext, argv: readonly string[]) => Promise<number>,
		private readonly signalHandler:
			| ((context: ProcessContext, signal: ImageSignal) => Promise<void> | void)
			| undefined,
		private readonly runtime: InProcessRuntimeService,
	) {
		this.startedAt = runtime.clock.nowMs();
		[this.ctx, this.cancelContext] = context.withCancel(ctx);
	}

	readonly startedAt: number;
	private processContext: ProcessContext | undefined;

	get state(): ProcessState {
		return this.processState;
	}

	get finishedAt(): number | undefined {
		return this.finishedAtMs;
	}

	get exitCode(): number | undefined {
		return this.processExitCode;
	}

	get abortExitCode(): number {
		return this.killedExitCode ?? this.processExitCode ?? 143;
	}

	get stdout(): string {
		return this.stdoutBuffer;
	}

	get stderr(): string {
		return this.stderrBuffer;
	}

	start(): void {
		if (this.processState !== "Created") {
			throw new Error(`process ${this.pid} was already started`);
		}
		this.processState = "Running";
		const processContext = new ProcessContext(this, this.runtime);
		this.processContext = processContext;
		void this.run(processContext, this.argv)
			.then((code) => this.finish(code))
			.catch((error: unknown) => this.fail(error));
	}

	wait(): Promise<number> {
		return this.waitPromise;
	}

	async kill(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> {
		if (this.processState === "Exited") {
			return;
		}
		const exitCode = signal === "SIGKILL" ? 137 : 143;
		this.killedExitCode = exitCode;
		const processContext = this.processContext;
		if (this.signalHandler && processContext) {
			await this.signalHandler(processContext, signal);
			if (signal === "SIGTERM") {
				return;
			}
		}
		this.cancel();
		if (signal === "SIGKILL") {
			this.finish(exitCode);
		}
	}

	trackListener(listener: { close(): void }): void {
		this.listeners.push(listener);
	}

	scheduleTimeout(callback: ProcessTask, delayMs: number): number {
		let handle: number | undefined;
		handle = this.runtime.clock.setTimeout(() => {
			if (handle !== undefined) {
				this.timeoutHandles.delete(handle);
			}
			this.runTask(callback);
		}, delayMs);
		this.timeoutHandles.add(handle);
		return handle;
	}

	scheduleInterval(callback: ProcessTask, intervalMs: number): number {
		const handle = this.runtime.clock.setInterval(() => this.runTask(callback), intervalMs);
		this.intervalHandles.add(handle);
		return handle;
	}

	scheduleMicrotask(callback: ProcessTask): void {
		this.runtime.clock.queueMicrotask(() => this.runTask(callback));
	}

	clearTimeout(handle: number): void {
		this.timeoutHandles.delete(handle);
		this.runtime.clock.clearTimeout(handle);
	}

	clearInterval(handle: number): void {
		this.intervalHandles.delete(handle);
		this.runtime.clock.clearInterval(handle);
	}

	listenerCount(): number {
		return this.listeners.length;
	}

	writeStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
	}

	writeStderr(chunk: string): void {
		this.stderrBuffer += chunk;
	}

	async waitUntilKilled(): Promise<number> {
		if (this.ctx.err()) {
			return Promise.resolve(this.killedExitCode ?? this.processExitCode ?? 143);
		}
		await this.ctx.done().receive();
		return this.killedExitCode ?? this.processExitCode ?? 143;
	}

	exit(code: number): never {
		this.cancel();
		this.finish(code);
		throw new ProcessExit(code);
	}

	private fail(error: unknown): void {
		if (error instanceof ProcessExit) {
			this.finish(error.code);
			return;
		}
		this.finish(this.killedExitCode ?? 1);
	}

	private cancel(): void {
		this.cancelContext();
		for (const handle of this.timeoutHandles) {
			this.runtime.clock.clearTimeout(handle);
		}
		this.timeoutHandles.clear();
		for (const handle of this.intervalHandles) {
			this.runtime.clock.clearInterval(handle);
		}
		this.intervalHandles.clear();
	}

	private runTask(callback: ProcessTask): void {
		try {
			void Promise.resolve(callback()).catch((error: unknown) => this.fail(error));
		} catch (error) {
			this.fail(error);
		}
	}

	private finish(code: number): void {
		if (this.processState === "Exited") {
			return;
		}
		this.processState = "Exited";
		this.finishedAtMs = this.runtime.clock.nowMs();
		this.processExitCode = code;
		this.cancel();
		for (const listener of this.listeners.splice(0)) {
			listener.close();
		}
		this.resolveWait(code);
	}
}

/**
 * Runtime services available to an image process.
 *
 * A process context is canceled when its container is stopped or exits. Image
 * implementations should use its scheduling and side-effect methods instead
 * of retaining cluster-level services. Those methods reject work after
 * cancellation with {@link context.Canceled}.
 *
 * @example
 * class ExampleImage extends BaseImage {
 * 	async exec(ctx: ProcessContext): Promise<number> {
 * 		ctx.listenHttp(8080, async () => ({ status: 200, body: "ok" }));
 * 		return await ctx.waitUntilKilled();
 * 	}
 * }
 */
export class ProcessContext implements context.Context {
	readonly pid: number;
	readonly argv: readonly string[];
	readonly env: ReadonlyMap<string, string>;
	readonly container: ContainerInstance;
	readonly pod: PodSandboxInstance;
	readonly fs: ContainerFileSystem;
	readonly kubeConfig: KubeConfig;
	readonly api: KubeClient;
	/**
	 * Internal simulator network access for cluster components such as kube-proxy.
	 * User images generally should not mutate this directly.
	 */
	readonly network: ClusterNetwork;

	constructor(
		private readonly process: ProcessInstance,
		private readonly runtime: InProcessRuntimeService,
	) {
		this.pid = process.pid;
		this.argv = process.argv;
		this.env = process.container.env;
		this.container = process.container;
		this.pod = process.container.sandbox;
		this.fs = process.container.fs;
		this.kubeConfig = runtime.kubeConfig;
		this.api = {
			appsv1: runtime.kubeConfig.makeApiClient(AppsV1Api),
			corev1: runtime.kubeConfig.makeApiClient(CoreV1Api),
			discoveryv1: runtime.kubeConfig.makeApiClient(DiscoveryV1Api),
		};
		this.network = runtime.network;
	}

	/**
	 * Returns a channel that closes when this process is canceled.
	 *
	 * Await it to perform cooperative shutdown work, or use it with `select`.
	 * The channel never sends a value.
	 *
	 * @example
	 * await ctx.done().receive();
	 * return 1;
	 */
	done(): ReadOnlyChannel<void> {
		return this.process.ctx.done();
	}

	/**
	 * Returns the cancellation error, or `undefined` while the process is active.
	 *
	 * A stopped container reports {@link context.Canceled}. Prefer calling a
	 * process-context operation directly, which performs this check itself.
	 *
	 * @example
	 * if (ctx.err()) {
	 * 	return 1;
	 * }
	 */
	err(): context.ContextError | undefined {
		return this.process.ctx.err();
	}

	/**
	 * Looks up a value inherited from the process's parent context.
	 *
	 * Generally speaking, you should not need to use this. If you find that you
	 * do need to use it, please reach out and explain your use-case to me.
	 */
	value(key: unknown): unknown {
		return this.process.ctx.value(key);
	}

	/**
	 * Schedules one process-owned callback after `delayMs` simulated milliseconds.
	 *
	 * An unhandled exception or rejected promise from the callback is treated the
	 * same as an unhandled exception from the image's main `exec` method: the
	 * container is considered failed. Throws {@link context.Canceled} if called
	 * after cancellation.
	 *
	 * @example
	 * ctx.setTimeout(() => ctx.writeStdout("ready\\n"), 5_000);
	 */
	setTimeout(callback: ProcessTask, delayMs: number): number {
		this.throwIfCanceled();
		return this.process.scheduleTimeout(this.wrapTask(callback), delayMs);
	}

	/**
	 * Schedules a repeating process-owned callback every `intervalMs` simulated
	 * milliseconds.
	 *
	 * Call {@link clearInterval} when the work is no longer needed. The interval
	 * is automatically cleared when the process exits or is canceled. An
	 * unhandled exception or rejected promise from the callback is treated the
	 * same as an unhandled exception from the image's main `exec` method: the
	 * container is considered failed.
	 *
	 * @example
	 * const handle = ctx.setInterval(() => ctx.writeStdout("tick\\n"), 1_000);
	 * ctx.setTimeout(() => ctx.clearInterval(handle), 10_000);
	 */
	setInterval(callback: ProcessTask, intervalMs: number): number {
		this.throwIfCanceled();
		return this.process.scheduleInterval(this.wrapTask(callback), intervalMs);
	}

	/**
	 * Queues a process-owned callback at the next simulator microtask checkpoint.
	 *
	 * Use this for deferred work that must run before the next timer. The callback
	 * is guarded by the process context and is not allowed to mutate state after
	 * cancellation. An unhandled exception or rejected promise from the callback
	 * is treated the same as an unhandled exception from the image's main `exec`
	 * method: the container is considered failed.
	 *
	 * @example
	 * ctx.queueMicrotask(() => ctx.writeStdout("started\\n"));
	 */
	queueMicrotask(callback: ProcessTask): void {
		this.throwIfCanceled();
		this.process.scheduleMicrotask(this.wrapTask(callback));
	}

	/**
	 * Cancels a timeout created by {@link setTimeout}.
	 *
	 * Clearing an already-fired or unknown handle has no effect.
	 *
	 * @example
	 * const handle = ctx.setTimeout(retry, 1_000);
	 * ctx.clearTimeout(handle);
	 */
	clearTimeout(handle: number): void {
		this.process.clearTimeout(handle);
	}

	/**
	 * Cancels an interval created by {@link setInterval}.
	 *
	 * @example
	 * const handle = ctx.setInterval(reconcile, 30_000);
	 * ctx.clearInterval(handle);
	 */
	clearInterval(handle: number): void {
		this.process.clearInterval(handle);
	}

	/**
	 * Starts a child process in the same container.
	 *
	 * The child inherits the container environment and process cancellation. Use
	 * {@link ProcessInstance.wait} to observe its exit code. Throws
	 * {@link context.Canceled} after the parent has been canceled.
	 *
	 * @example
	 * const child = ctx.exec(["echo", "hello"]);
	 * const exitCode = await child.wait();
	 */
	exec(argv: string[], options?: ExecOptions): ProcessInstance {
		this.throwIfCanceled();
		return this.process.container.exec(argv, options);
	}

	/**
	 * Appends text to this process's captured standard output.
	 *
	 * @example
	 * ctx.writeStdout("server started\\n");
	 */
	writeStdout(chunk: string): void {
		this.throwIfCanceled();
		this.process.writeStdout(chunk);
	}

	/**
	 * Appends text to this process's captured standard error.
	 *
	 * @example
	 * ctx.writeStderr("configuration is missing\\n");
	 */
	writeStderr(chunk: string): void {
		this.throwIfCanceled();
		this.process.writeStderr(chunk);
	}

	/**
	 * Registers an HTTP listener in the pod network namespace.
	 *
	 * The returned listener is closed automatically when this process exits.
	 * Register listeners during startup; calling this after cancellation throws
	 * {@link context.Canceled}.
	 *
	 * @example
	 * ctx.listenHttp(8080, async (_requestCtx, request) => ({
	 * 	status: request.url.pathname === "/health" ? 200 : 404,
	 * 	body: "ok",
	 * }));
	 */
	listenHttp(port: number, handler: http.Handler): http.Listener {
		this.throwIfCanceled();
		const listener = this.pod.networkRegistration().bindHttp(port, handler);
		this.process.trackListener(listener);
		return listener;
	}

	/**
	 * Registers a DNS listener in the pod network namespace.
	 *
	 * The listener is owned by this process and closes automatically on exit.
	 * The handler receives each DNS request and returns the simulator DNS
	 * response shape.
	 *
	 * @example
	 * ctx.listenDns(53, async (request) => resolveDnsRequest(request));
	 */
	listenDns(port: number, handler: DnsHandler): DnsListener {
		this.throwIfCanceled();
		const listener = this.pod.networkRegistration().bindDns(port, handler);
		this.process.trackListener(listener);
		return listener;
	}

	/**
	 * Fetches an HTTP resource as this pod.
	 *
	 * Requests use the pod identity and simulator network routing. The promise
	 * rejects with {@link context.Canceled} if the process is already canceled.
	 *
	 * @example
	 * const response = await ctx.fetch("http://api.default.svc/health");
	 * if (response.status !== 200) throw new Error("API is unavailable");
	 */
	async fetch(target: http.FetchInput, init?: http.FetchInit): Promise<http.Response> {
		this.throwIfCanceled();
		if (!this.pod.config.pod) {
			throw new Error(`pod origin is not registered for sandbox ${this.pod.id}`);
		}
		return await this.runtime.network.fetch(
			this.process.ctx,
			this.pod.config.pod,
			target,
			init ?? {},
		);
	}

	/**
	 * Waits for simulated time to pass while remaining cancellation-aware.
	 *
	 * If the process is stopped before the delay expires, the returned promise
	 * rejects and the process receives its termination exit code.
	 *
	 * @example
	 * await ctx.sleep(1_000);
	 * await ctx.fetch("http://api.default.svc/retry");
	 */
	sleep(ms: number): Promise<void> {
		return this.runtime.sleep(this.process.ctx, ms, () => this.process.abortExitCode);
	}

	/**
	 * Waits until the runtime stops this process and resolves to its exit code.
	 *
	 * This is the usual final operation for long-running server images.
	 *
	 * @example
	 * ctx.listenHttp(8080, handler);
	 * return await ctx.waitUntilKilled();
	 */
	waitUntilKilled(): Promise<number> {
		return this.process.waitUntilKilled();
	}

	/**
	 * Immediately exits the process with `code` and closes its listeners and
	 * scheduled work.
	 *
	 * This method does not return.
	 *
	 * @example
	 * if (!ctx.env.get("CONFIG_PATH")) {
	 * 	ctx.writeStderr("CONFIG_PATH is required\\n");
	 * 	ctx.exit(2);
	 * }
	 */
	exit(code = 0): never {
		return this.process.exit(code);
	}

	private throwIfCanceled(): void {
		if (this.err()) {
			throw this.err();
		}
	}

	private wrapTask(callback: ProcessTask): ProcessTask {
		return () => {
			this.throwIfCanceled();
			return callback();
		};
	}
}

export class ContainerFileSystem {
	private readonly files = new Map<string, string>();

	read(path: string): string | undefined {
		return this.files.get(path);
	}

	write(path: string, contents = ""): void {
		this.files.set(path, contents);
	}

	delete(path: string): boolean {
		return this.files.delete(path);
	}

	has(path: string): boolean {
		return this.files.has(path);
	}
}
