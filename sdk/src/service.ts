import type { HandlerContext } from "./context.js";

export type ServiceHandler<TRequest = unknown, TResponse = unknown, TConfig = unknown, TSecret = unknown> = (
  context: HandlerContext<TRequest, TConfig, TSecret>,
) => TResponse | Promise<TResponse>;

export type ServerStreamingServiceHandler<TRequest = unknown, TResponse = unknown, TConfig = unknown, TSecret = unknown> = (
  context: HandlerContext<TRequest, TConfig, TSecret> & { request: TRequest },
) => AsyncIterable<TResponse> | Iterable<TResponse> | Promise<AsyncIterable<TResponse> | Iterable<TResponse>>;

export type ClientStreamingServiceHandler<TRequest = unknown, TResponse = unknown, TConfig = unknown, TSecret = unknown> = (
  context: HandlerContext<TRequest, TConfig, TSecret> & { requests: AsyncIterable<TRequest> },
) => TResponse | Promise<TResponse>;

export type BidiStreamingServiceHandler<TRequest = unknown, TResponse = unknown, TConfig = unknown, TSecret = unknown> = (
  context: HandlerContext<TRequest, TConfig, TSecret> & { requests: AsyncIterable<TRequest> },
) => AsyncIterable<TResponse> | Iterable<TResponse> | Promise<AsyncIterable<TResponse> | Iterable<TResponse>>;

export type AnyServiceHandler =
  | ServiceHandler
  | ServerStreamingServiceHandler
  | ClientStreamingServiceHandler
  | BidiStreamingServiceHandler
  | ((context: HandlerContext) => unknown);

export interface ServiceDefinition {
  handlers: Record<string, AnyServiceHandler>;
}

export interface DefineServiceConfig {
  handlers: Record<string, AnyServiceHandler>;
}

export function defineService(config: DefineServiceConfig): ServiceDefinition {
  return {
    handlers: { ...config.handlers },
  };
}
