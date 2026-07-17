import { EndpointSliceStore } from "../../../../cluster/storage/index.js";
import type { Etcd } from "../../../../cluster/etcd.js";
import type * as context from "../../../../go/context.js";
import { NotFound } from "../../../errors.js";
import { filterByFields, parseFieldSelector } from "../../../fields.js";
import { filterByLabels, parseLabelSelector } from "../../../labels.js";
import { V1EndpointSlice, V1EndpointSliceList, V1Status } from "../../models/index.js";
import type {
	DiscoveryV1ApiCreateNamespacedEndpointSliceRequest,
	DiscoveryV1ApiDeleteNamespacedEndpointSliceRequest,
	DiscoveryV1Api as DiscoveryV1ApiInterface,
	DiscoveryV1ApiListEndpointSliceForAllNamespacesRequest,
	DiscoveryV1ApiListNamespacedEndpointSliceRequest,
	DiscoveryV1ApiReadNamespacedEndpointSliceRequest,
	DiscoveryV1ApiReplaceNamespacedEndpointSliceRequest,
} from "../types/DiscoveryV1Api.js";
import { rethrowApiErrors } from "./errors.js";
import { listResourceVersionOptions } from "./resource-version.js";
import { deleteResource } from "./delete.js";

export interface DiscoveryV1ApiOptions {
	ctx: context.Context;
	etcd: Etcd;
}

export class DiscoveryV1Api implements DiscoveryV1ApiInterface {
	private readonly ctx: context.Context;
	private readonly endpointSlices: EndpointSliceStore;

	public constructor(options: DiscoveryV1ApiOptions) {
		this.ctx = options.ctx;
		this.endpointSlices = new EndpointSliceStore(this.ctx, options.etcd);
	}

	public async createNamespacedEndpointSlice(
		request: DiscoveryV1ApiCreateNamespacedEndpointSliceRequest,
	): Promise<V1EndpointSlice> {
		return await rethrowApiErrors(async () => {
			request.body.metadata ??= {};
			request.body.metadata.namespace ??= request.namespace;
			return await this.endpointSlices.create(request.body);
		});
	}

	public async deleteNamespacedEndpointSlice(
		request: DiscoveryV1ApiDeleteNamespacedEndpointSliceRequest,
	): Promise<V1Status> {
		return await rethrowApiErrors(async () => {
			await deleteResource(
				this.ctx,
				this.endpointSlices,
				"EndpointSlice",
				request.name,
				request.namespace,
				request,
			);
			return {
				apiVersion: "v1",
				kind: "Status",
				status: "Success",
			};
		});
	}

	public async listEndpointSliceForAllNamespaces(
		request: DiscoveryV1ApiListEndpointSliceForAllNamespacesRequest = {},
	): Promise<V1EndpointSliceList> {
		return await rethrowApiErrors(async () => {
			const selector = parseLabelSelector(request.labelSelector);
			const fieldSelector = parseFieldSelector(request.fieldSelector);
			const list = await this.endpointSlices.listWithResourceVersion(
				undefined,
				listResourceVersionOptions(request),
			);
			return {
				apiVersion: "discovery.k8s.io/v1",
				kind: "EndpointSliceList",
				metadata: { resourceVersion: list.resourceVersion },
				items: filterByFields(filterByLabels(list.items, selector), fieldSelector),
			};
		});
	}

	public async listNamespacedEndpointSlice(
		request: DiscoveryV1ApiListNamespacedEndpointSliceRequest,
	): Promise<V1EndpointSliceList> {
		return await rethrowApiErrors(async () => {
			const selector = parseLabelSelector(request.labelSelector);
			const fieldSelector = parseFieldSelector(request.fieldSelector);
			const list = await this.endpointSlices.listWithResourceVersion(
				request.namespace,
				listResourceVersionOptions(request),
			);
			return {
				apiVersion: "discovery.k8s.io/v1",
				kind: "EndpointSliceList",
				metadata: { resourceVersion: list.resourceVersion },
				items: filterByFields(filterByLabels(list.items, selector), fieldSelector),
			};
		});
	}

	public async readNamespacedEndpointSlice(
		request: DiscoveryV1ApiReadNamespacedEndpointSliceRequest,
	): Promise<V1EndpointSlice> {
		return await rethrowApiErrors(async () => {
			const endpointSlice = await this.endpointSlices.get(request.name, request.namespace);
			if (!endpointSlice) {
				throw new NotFound(`EndpointSlice "${request.name}" not found`);
			}

			return endpointSlice;
		});
	}

	public async replaceNamespacedEndpointSlice(
		request: DiscoveryV1ApiReplaceNamespacedEndpointSliceRequest,
	): Promise<V1EndpointSlice> {
		return await rethrowApiErrors(async () => {
			request.body.metadata ??= {};
			request.body.metadata.name = request.name;
			request.body.metadata.namespace ??= request.namespace;
			return await this.endpointSlices.update(request.name, request.body);
		});
	}
}
