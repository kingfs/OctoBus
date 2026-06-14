import type { Metadata } from "@grpc/grpc-js";

export interface HandlerContext<TRequest = unknown, TConfig = unknown, TSecret = unknown> {
  request?: TRequest;
  requests?: AsyncIterable<TRequest>;
  metadata: Metadata;
  config: TConfig;
  secret: TSecret;
  method: string;
  serviceId: string;
  instanceId: string;
  workdir: string;
  packageDir: string;
  getMetadata(name: string): string | undefined;
  getMetadataAll(name: string): string[];
}
