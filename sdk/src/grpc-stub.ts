import * as grpc from "@grpc/grpc-js";
import { EventEmitter } from "node:events";
import { findPackageRoot, loadServiceRuntime, type GrpcServiceDefinition } from "./proto-loader.js";

export type GrpcMetadataInit = grpc.Metadata | Record<string, string | string[] | Buffer | Buffer[] | number | number[] | boolean | boolean[] | undefined>;
export type GrpcMethodKind = "unary" | "server_streaming" | "client_streaming" | "bidi_streaming";

export interface GrpcStubOptions {
  address: string;
  credentials?: grpc.ChannelCredentials;
  channelOptions?: grpc.ChannelOptions;
  capsetId?: string;
  serviceId?: string;
  instanceId?: string;
  metadata?: GrpcMetadataInit | (() => GrpcMetadataInit | Promise<GrpcMetadataInit>);
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  packageDir?: string;
  descriptorPath?: string;
  manifestPath?: string;
}

export interface GrpcInvokeOptions {
  metadata?: GrpcMetadataInit;
  callOptions?: grpc.CallOptions;
}

export type GrpcRequestIterable = AsyncIterable<unknown> | Iterable<unknown>;

export interface GrpcReadableResult extends AsyncIterable<unknown> {
  raw: grpc.ClientReadableStream<unknown> | grpc.ClientDuplexStream<unknown, unknown>;
  cancel(): void;
}

export type GrpcUnaryMethod = ((request?: unknown, options?: GrpcInvokeOptions) => Promise<unknown>) & { kind: "unary" };
export type GrpcServerStreamingMethod = ((request?: unknown, options?: GrpcInvokeOptions) => GrpcReadableResult) & { kind: "server_streaming" };
export type GrpcClientStreamingMethod = ((requests: GrpcRequestIterable, options?: GrpcInvokeOptions) => Promise<unknown>) & { kind: "client_streaming" };
export type GrpcBidiStreamingMethod = ((requests: GrpcRequestIterable, options?: GrpcInvokeOptions) => GrpcReadableResult) & { kind: "bidi_streaming" };
export type GrpcStubMethod = GrpcUnaryMethod | GrpcServerStreamingMethod | GrpcClientStreamingMethod | GrpcBidiStreamingMethod;
export type GrpcInvokeResult = Promise<unknown> | GrpcReadableResult;

export interface GrpcStub {
  services: Record<string, Record<string, GrpcStubMethod>>;
  methods: Record<string, GrpcStubMethod>;
  raw: Record<string, grpc.Client>;
  invoke(method: string, request?: unknown, options?: GrpcInvokeOptions): GrpcInvokeResult;
  service(name: string): Record<string, GrpcStubMethod>;
  close(): void;
}

interface DiscoveredGrpcMethod {
  service: GrpcServiceDefinition;
  methodName: string;
  fullName: string;
  kind: GrpcMethodKind;
}

export function createGrpcStub(options: GrpcStubOptions): GrpcStub {
  const loaded = options.descriptorPath
    ? loadServiceRuntime({
        descriptorPath: options.descriptorPath,
        manifestPath: options.manifestPath,
        packageDir: options.packageDir,
      })
    : loadServiceRuntime({
        packageDir: options.packageDir ?? findPackageRoot({ cwd: options.cwd, env: options.env }),
        env: options.env,
      });
  const raw = createRawClients(loaded.grpcServices, options);
  const methods = discoverGrpcMethods(loaded.grpcServices);
  const byFullName: Record<string, GrpcStubMethod> = {};
  const byService: Record<string, Record<string, GrpcStubMethod>> = {};

  const invoke = (methodName: string, request?: unknown, invokeOptions: GrpcInvokeOptions = {}): GrpcInvokeResult => {
    const method = methods.find((item) => item.fullName === normalizeMethodName(methodName));
    if (!method) {
      throw new Error(`gRPC method ${methodName} is not defined in this package`);
    }
    return invokeGrpcMethod(raw[method.service.descriptor.typeName], method, request, options, invokeOptions);
  };

  for (const method of methods) {
    const fn = createMethodFunction(method, invoke);
    byFullName[method.fullName] = fn;
    byService[method.service.descriptor.typeName] ??= {};
    byService[method.service.descriptor.typeName][method.methodName] = fn;
  }

  return {
    services: byService,
    methods: byFullName,
    raw,
    invoke,
    service(name: string): Record<string, GrpcStubMethod> {
      const service = byService[name];
      if (!service) {
        throw new Error(`gRPC service ${name} is not defined in this package`);
      }
      return service;
    },
    close(): void {
      for (const client of Object.values(raw)) {
        client.close();
      }
    },
  };
}

function createRawClients(services: GrpcServiceDefinition[], options: GrpcStubOptions): Record<string, grpc.Client> {
  const raw: Record<string, grpc.Client> = {};
  for (const service of services) {
    const Client = grpc.makeGenericClientConstructor(service.definition, service.descriptor.typeName);
    raw[service.descriptor.typeName] = new Client(
      options.address,
      options.credentials ?? grpc.credentials.createInsecure(),
      options.channelOptions,
    );
  }
  return raw;
}

function discoverGrpcMethods(services: GrpcServiceDefinition[]): DiscoveredGrpcMethod[] {
  const methods: DiscoveredGrpcMethod[] = [];
  for (const service of services) {
    for (const [methodName, definition] of Object.entries(service.definition)) {
      methods.push({
        service,
        methodName,
        fullName: `${service.descriptor.typeName}/${methodName}`,
        kind: grpcMethodKind(definition),
      });
    }
  }
  return methods;
}

function grpcMethodKind(definition: grpc.MethodDefinition<unknown, unknown>): GrpcMethodKind {
  if (definition.requestStream && definition.responseStream) {
    return "bidi_streaming";
  }
  if (definition.requestStream) {
    return "client_streaming";
  }
  if (definition.responseStream) {
    return "server_streaming";
  }
  return "unary";
}

function createMethodFunction(
  method: DiscoveredGrpcMethod,
  invoke: (methodName: string, request?: unknown, options?: GrpcInvokeOptions) => GrpcInvokeResult,
): GrpcStubMethod {
  const fn = ((request?: unknown, invokeOptions?: GrpcInvokeOptions) => invoke(method.fullName, request, invokeOptions)) as GrpcStubMethod;
  (fn as { kind: GrpcMethodKind }).kind = method.kind;
  return fn;
}

function invokeGrpcMethod(
  client: grpc.Client,
  method: DiscoveredGrpcMethod,
  request: unknown,
  options: GrpcStubOptions,
  invokeOptions: GrpcInvokeOptions,
): GrpcInvokeResult {
  switch (method.kind) {
    case "unary":
      return invokeUnary(client, method.methodName, request, options, invokeOptions);
    case "server_streaming":
      return invokeServerStreaming(client, method.methodName, request, options, invokeOptions);
    case "client_streaming":
      return invokeClientStreaming(client, method.methodName, request, options, invokeOptions);
    case "bidi_streaming":
      return invokeBidiStreaming(client, method.methodName, request, options, invokeOptions);
  }
}

async function invokeUnary(
  client: grpc.Client,
  methodName: string,
  request: unknown,
  options: GrpcStubOptions,
  invokeOptions: GrpcInvokeOptions,
): Promise<unknown> {
  const metadata = await buildMetadata(options, invokeOptions.metadata);
  const unary = (client as unknown as Record<string, GrpcUnaryCallbackMethod>)[methodName];
  return new Promise((resolve, reject) => {
    unary.call(
      client,
      request ?? {},
      metadata,
      invokeOptions.callOptions ?? {},
      (error: grpc.ServiceError | null, response: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      },
    );
  });
}

function invokeServerStreaming(
  client: grpc.Client,
  methodName: string,
  request: unknown,
  options: GrpcStubOptions,
  invokeOptions: GrpcInvokeOptions,
): GrpcReadableResult {
  return readableResult(async () => {
    const metadata = await buildMetadata(options, invokeOptions.metadata);
    const serverStreaming = (client as unknown as Record<string, GrpcServerStreamingClientMethod>)[methodName];
    return serverStreaming.call(
      client,
      request ?? {},
      metadata,
      invokeOptions.callOptions ?? {},
    );
  });
}

async function invokeClientStreaming(
  client: grpc.Client,
  methodName: string,
  request: unknown,
  options: GrpcStubOptions,
  invokeOptions: GrpcInvokeOptions,
): Promise<unknown> {
  if (!isIterable(request) && !isAsyncIterable(request)) {
    throw new Error(`gRPC client streaming method ${methodName} requires an iterable request`);
  }
  const metadata = await buildMetadata(options, invokeOptions.metadata);
  const clientStreaming = (client as unknown as Record<string, GrpcClientStreamingClientMethod>)[methodName];
  return new Promise((resolve, reject) => {
    const raw = clientStreaming.call(
      client,
      metadata,
      invokeOptions.callOptions ?? {},
      (error: grpc.ServiceError | null, response: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      },
    );
    writeRequests(raw, request as GrpcRequestIterable).catch((error: unknown) => {
      raw.destroy(error instanceof Error ? error : new Error(String(error)));
      reject(error);
    });
  });
}

function invokeBidiStreaming(
  client: grpc.Client,
  methodName: string,
  request: unknown,
  options: GrpcStubOptions,
  invokeOptions: GrpcInvokeOptions,
): GrpcReadableResult {
  if (!isIterable(request) && !isAsyncIterable(request)) {
    throw new Error(`gRPC bidirectional streaming method ${methodName} requires an iterable request`);
  }
  return readableResult(async () => {
    const metadata = await buildMetadata(options, invokeOptions.metadata);
    const bidiStreaming = (client as unknown as Record<string, GrpcBidiStreamingClientMethod>)[methodName];
    return bidiStreaming.call(
      client,
      metadata,
      invokeOptions.callOptions ?? {},
    );
  }, (raw) => writeRequests(raw, request as GrpcRequestIterable));
}

type GrpcUnaryCallbackMethod = (
  request: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: (error: grpc.ServiceError | null, response: unknown) => void,
) => void;

type GrpcServerStreamingClientMethod = (
  request: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
) => grpc.ClientReadableStream<unknown>;

type GrpcClientStreamingClientMethod = (
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: (error: grpc.ServiceError | null, response: unknown) => void,
) => grpc.ClientWritableStream<unknown>;

type GrpcBidiStreamingClientMethod = (
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
) => grpc.ClientDuplexStream<unknown, unknown>;

async function writeRequests(
  raw: grpc.ClientWritableStream<unknown>,
  requests: GrpcRequestIterable,
): Promise<void> {
  try {
    for await (const request of requests) {
      raw.write(request);
    }
    raw.end();
  } catch (error) {
    raw.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

type GrpcReadableRaw = grpc.ClientReadableStream<unknown> | grpc.ClientDuplexStream<unknown, unknown>;
type GrpcRawStarter = () => Promise<GrpcReadableRaw>;
type GrpcStreamWriter = (raw: grpc.ClientDuplexStream<unknown, unknown>) => Promise<void>;

interface DeferredGrpcRawStream extends EventEmitter {
  materialize(): Promise<GrpcReadableRaw>;
  cancel(): void;
  resume(): this;
  pause(): this;
  destroy(error?: Error): this;
  pipe<T>(destination: T, options?: unknown): T;
  write(chunk: unknown): boolean;
  end(): this;
}

function readableResult(
  startRaw: GrpcRawStarter,
  writer?: GrpcStreamWriter,
): GrpcReadableResult {
  const queue: unknown[] = [];
  let done = false;
  let error: Error | undefined;
  let notify: (() => void) | undefined;
  const raw = createDeferredRawStream(startRaw, (stream) => {
    stream.on("data", (item: unknown) => {
      queue.push(item);
      raw.emit("data", item);
      wake();
    });
    stream.on("end", () => {
      raw.emit("end");
      finish();
    });
    stream.on("close", () => {
      raw.emit("close");
      finish();
    });
    stream.on("metadata", (metadata: grpc.Metadata) => {
      raw.emit("metadata", metadata);
    });
    stream.on("status", (status: grpc.StatusObject) => {
      raw.emit("status", status);
      if (status.code !== grpc.status.OK) {
        error = Object.assign(new Error(status.details), status);
      }
      finish();
    });
    stream.on("error", (streamError: Error) => {
      error = streamError;
      emitErrorIfHandled(raw, streamError);
      finish();
    });
  }, (startError) => {
    error = startError;
    finish();
  });
  let writerStarted = false;

  const wake = () => {
    notify?.();
    notify = undefined;
  };
  const finish = () => {
    done = true;
    wake();
  };
  const startWriter = () => {
    if (writerStarted || !writer) {
      return;
    }
    writerStarted = true;
    raw.materialize().then((stream) => writer(stream as grpc.ClientDuplexStream<unknown, unknown>)).catch((writerError: unknown) => {
      error = writerError instanceof Error ? writerError : new Error(String(writerError));
      finish();
    });
  };

  return {
    get raw() {
      startWriter();
      void raw.materialize().catch(() => undefined);
      return raw as unknown as GrpcReadableRaw;
    },
    cancel: () => {
      startWriter();
      raw.cancel();
    },
    [Symbol.asyncIterator]: async function* () {
      startWriter();
      raw.resume();
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (error) {
          throw error;
        }
        if (done) {
          return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    },
  };
}

function createDeferredRawStream(
  startRaw: GrpcRawStarter,
  attach: (raw: GrpcReadableRaw) => void,
  onStartError: (error: Error) => void,
): DeferredGrpcRawStream {
  const facade = new EventEmitter() as DeferredGrpcRawStream;
  let raw: GrpcReadableRaw | undefined;
  let rawPromise: Promise<GrpcReadableRaw> | undefined;
  let cancelRequested = false;
  let resumeRequested = false;
  let pauseRequested = false;

  const materialize = (): Promise<GrpcReadableRaw> => {
    rawPromise ??= startRaw().then((stream) => {
      raw = stream;
      attach(stream);
      if (cancelRequested) {
        stream.cancel();
      }
      if (pauseRequested) {
        stream.pause();
      }
      if (resumeRequested) {
        stream.resume();
      }
      return stream;
    }).catch((startError: unknown) => {
      const resolvedError = startError instanceof Error ? startError : new Error(String(startError));
      onStartError(resolvedError);
      emitErrorIfHandled(facade, resolvedError);
      throw resolvedError;
    });
    return rawPromise;
  };

  const startOnListen = <T extends (...args: unknown[]) => DeferredGrpcRawStream>(method: T): T => {
    return ((...args: unknown[]) => {
      method(...args);
      void materialize().catch(() => undefined);
      return facade;
    }) as T;
  };

  facade.materialize = materialize;
  facade.on = startOnListen(facade.on.bind(facade) as (...args: unknown[]) => DeferredGrpcRawStream);
  facade.addListener = startOnListen(facade.addListener.bind(facade) as (...args: unknown[]) => DeferredGrpcRawStream);
  facade.once = startOnListen(facade.once.bind(facade) as (...args: unknown[]) => DeferredGrpcRawStream);
  facade.prependListener = startOnListen(facade.prependListener.bind(facade) as (...args: unknown[]) => DeferredGrpcRawStream);
  facade.prependOnceListener = startOnListen(facade.prependOnceListener.bind(facade) as (...args: unknown[]) => DeferredGrpcRawStream);
  facade.cancel = () => {
    cancelRequested = true;
    void materialize().then((stream) => stream.cancel()).catch(() => undefined);
  };
  facade.resume = function resume() {
    resumeRequested = true;
    pauseRequested = false;
    void materialize().then((stream) => stream.resume()).catch(() => undefined);
    return this;
  };
  facade.pause = function pause() {
    pauseRequested = true;
    resumeRequested = false;
    void materialize().then((stream) => stream.pause()).catch(() => undefined);
    return this;
  };
  facade.destroy = function destroy(destroyError?: Error) {
    void materialize().then((stream) => stream.destroy(destroyError)).catch(() => undefined);
    return this;
  };
  facade.pipe = function pipe<T>(destination: T, options?: unknown): T {
    void materialize().then((stream) => {
      stream.pipe(destination as NodeJS.WritableStream, options as Parameters<typeof stream.pipe>[1]);
    }).catch(() => undefined);
    return destination;
  };
  facade.write = (chunk: unknown): boolean => {
    void materialize().then((stream) => {
      (stream as grpc.ClientDuplexStream<unknown, unknown>).write(chunk);
    }).catch(() => undefined);
    return true;
  };
  facade.end = function end() {
    void materialize().then((stream) => {
      (stream as grpc.ClientDuplexStream<unknown, unknown>).end();
    }).catch(() => undefined);
    return this;
  };
  return facade;
}

function emitErrorIfHandled(target: EventEmitter, error: Error): void {
  if (target.listenerCount("error") > 0) {
    target.emit("error", error);
  }
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return value !== null && typeof value === "object" && Symbol.iterator in value;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value !== null && typeof value === "object" && Symbol.asyncIterator in value;
}

async function buildMetadata(options: GrpcStubOptions, invokeMetadata: GrpcMetadataInit | undefined): Promise<grpc.Metadata> {
  const metadata = new grpc.Metadata();
  addMetadata(metadata, await resolveMetadata(options.metadata));
  addMetadata(metadata, invokeMetadata);
  setMetadataIfDefined(metadata, "x-octobus-capset", options.capsetId);
  setMetadataIfDefined(metadata, "x-octobus-service", options.serviceId);
  setMetadataIfDefined(metadata, "x-octobus-instance", options.instanceId);
  return metadata;
}

async function resolveMetadata(metadata: GrpcStubOptions["metadata"]): Promise<GrpcMetadataInit | undefined> {
  return typeof metadata === "function" ? metadata() : metadata;
}

function addMetadata(target: grpc.Metadata, source: GrpcMetadataInit | undefined): void {
  if (!source) {
    return;
  }
  if (source instanceof grpc.Metadata) {
    for (const [key, value] of Object.entries(source.getMap())) {
      target.set(key, value);
    }
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      target.add(key, metadataValue(item));
    }
  }
}

function metadataValue(value: string | Buffer | number | boolean): string | Buffer {
  return Buffer.isBuffer(value) ? value : String(value);
}

function setMetadataIfDefined(metadata: grpc.Metadata, key: string, value: string | undefined): void {
  if (value !== undefined) {
    metadata.set(key, value);
  }
}

function normalizeMethodName(method: string): string {
  return method.startsWith("/") ? method.slice(1) : method;
}
