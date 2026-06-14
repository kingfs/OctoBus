import { GrpcError } from "./grpc-error.js";
import { INVALID_ARGUMENT, NOT_FOUND, PERMISSION_DENIED, UNAUTHENTICATED, UNAVAILABLE } from "./status.js";

export function grpcInvalidArgumentError(message: string): GrpcError {
  return new GrpcError(INVALID_ARGUMENT, message);
}

export function grpcNotFoundError(message: string): GrpcError {
  return new GrpcError(NOT_FOUND, message);
}

export function grpcPermissionDeniedError(message: string): GrpcError {
  return new GrpcError(PERMISSION_DENIED, message);
}

export function grpcUnauthenticatedError(message: string): GrpcError {
  return new GrpcError(UNAUTHENTICATED, message);
}

export function grpcUnavailableError(message: string): GrpcError {
  return new GrpcError(UNAVAILABLE, message);
}
