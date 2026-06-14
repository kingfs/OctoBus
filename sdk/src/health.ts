import * as grpc from "@grpc/grpc-js";
import { UNIMPLEMENTED } from "./status.js";

export const enum HealthServingStatus {
  UNKNOWN = 0,
  SERVING = 1,
  NOT_SERVING = 2,
  SERVICE_UNKNOWN = 3,
}

const healthPathPrefix = "/grpc.health.v1.Health";

export const healthServiceDefinition: grpc.ServiceDefinition<grpc.UntypedServiceImplementation> = {
  Check: {
    path: `${healthPathPrefix}/Check`,
    requestStream: false,
    responseStream: false,
    requestSerialize: serializeHealthCheckRequest,
    requestDeserialize: deserializeHealthCheckRequest,
    responseSerialize: serializeHealthCheckResponse,
    responseDeserialize: deserializeHealthCheckResponse,
    originalName: "check",
  },
  Watch: {
    path: `${healthPathPrefix}/Watch`,
    requestStream: false,
    responseStream: true,
    requestSerialize: serializeHealthCheckRequest,
    requestDeserialize: deserializeHealthCheckRequest,
    responseSerialize: serializeHealthCheckResponse,
    responseDeserialize: deserializeHealthCheckResponse,
    originalName: "watch",
  },
};

export function addHealthService(server: grpc.Server): void {
  server.addService(healthServiceDefinition, {
    Check: (_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      callback(null, { status: HealthServingStatus.SERVING });
    },
    Watch: (call: grpc.ServerWritableStream<unknown, unknown>) => {
      call.destroy(toServiceError(UNIMPLEMENTED, "grpc.health.v1.Health/Watch is not implemented"));
    },
  });
}

function serializeHealthCheckRequest(value: unknown): Buffer {
  const service = typeof value === "object" && value !== null && "service" in value
    ? String((value as { service?: unknown }).service ?? "")
    : "";
  return encodeStringField(1, service);
}

function deserializeHealthCheckRequest(buffer: Buffer): { service: string } {
  return { service: decodeFirstStringField(buffer, 1) ?? "" };
}

function serializeHealthCheckResponse(value: unknown): Buffer {
  const status = typeof value === "object" && value !== null && "status" in value
    ? normalizeStatus((value as { status?: unknown }).status)
    : HealthServingStatus.UNKNOWN;
  return Buffer.from([0x08, status]);
}

function deserializeHealthCheckResponse(buffer: Buffer): { status: HealthServingStatus } {
  if (buffer.length >= 2 && buffer[0] === 0x08) {
    return { status: buffer[1] as HealthServingStatus };
  }
  return { status: HealthServingStatus.UNKNOWN };
}

function normalizeStatus(status: unknown): HealthServingStatus {
  if (status === "SERVING") {
    return HealthServingStatus.SERVING;
  }
  if (typeof status === "number") {
    return status as HealthServingStatus;
  }
  return HealthServingStatus.UNKNOWN;
}

function encodeStringField(fieldNumber: number, value: string): Buffer {
  if (!value) {
    return Buffer.alloc(0);
  }

  const encoded = Buffer.from(value, "utf8");
  return Buffer.concat([
    Buffer.from([(fieldNumber << 3) | 2]),
    encodeVarint(encoded.length),
    encoded,
  ]);
}

function decodeFirstStringField(buffer: Buffer, expectedFieldNumber: number): string | undefined {
  let index = 0;
  while (index < buffer.length) {
    const tag = buffer[index++];
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType !== 2) {
      break;
    }

    const lengthResult = decodeVarint(buffer, index);
    if (!lengthResult) {
      break;
    }

    const [length, nextIndex] = lengthResult;
    index = nextIndex;
    const end = index + length;
    if (end > buffer.length) {
      break;
    }

    if (fieldNumber === expectedFieldNumber) {
      return buffer.subarray(index, end).toString("utf8");
    }
    index = end;
  }

  return undefined;
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let next = value;
  do {
    let byte = next & 0x7f;
    next >>>= 7;
    if (next !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (next !== 0);
  return Buffer.from(bytes);
}

function decodeVarint(buffer: Buffer, start: number): [number, number] | undefined {
  let result = 0;
  let shift = 0;
  let index = start;
  while (index < buffer.length) {
    const byte = buffer[index++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [result, index];
    }
    shift += 7;
  }
  return undefined;
}

function toServiceError(code: number, message: string): grpc.ServiceError {
  const error = new Error(message) as grpc.ServiceError;
  error.code = code;
  return error;
}
