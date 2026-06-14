import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { addHealthService, healthServiceDefinition } from "../src/health.js";
import { status } from "../src/index.js";

describe("gRPC health service", () => {
  let server: grpc.Server | undefined;

  afterEach(() => {
    server?.forceShutdown();
    server = undefined;
  });

  it("serializes and deserializes health check messages", () => {
    const check = healthServiceDefinition.Check;

    expect(check.requestDeserialize(check.requestSerialize({ service: "calculator.v1.CalculatorService" }))).toEqual({
      service: "calculator.v1.CalculatorService",
    });
    expect(check.requestDeserialize(check.requestSerialize({}))).toEqual({ service: "" });
    expect(check.requestDeserialize(Buffer.from([0x08, 0x01]))).toEqual({ service: "" });
    expect(check.requestDeserialize(Buffer.from([0x0a, 0xff]))).toEqual({ service: "" });
    expect(check.requestDeserialize(Buffer.from([0x0a, 0x04, 0x74, 0x65]))).toEqual({ service: "" });

    expect(check.responseDeserialize(check.responseSerialize({ status: "SERVING" }))).toEqual({ status: 1 });
    expect(check.responseDeserialize(check.responseSerialize({ status: 2 }))).toEqual({ status: 2 });
    expect(check.responseDeserialize(check.responseSerialize({}))).toEqual({ status: 0 });
    expect(check.responseDeserialize(Buffer.alloc(0))).toEqual({ status: 0 });
  });

  it("serves Check and registers Watch as unimplemented", async () => {
    server = new grpc.Server();
    addHealthService(server);
    const address = await bindServer(server);
    const client = new HealthClient(address, grpc.credentials.createInsecure());

    await expect(unary(client, "Check", { service: "" })).resolves.toEqual({ status: 1 });
    client.close();

    let registeredImplementation: grpc.UntypedServiceImplementation | undefined;
    const fakeServer = {
      addService: (_definition: unknown, implementation: grpc.UntypedServiceImplementation) => {
        registeredImplementation = implementation;
      },
    };
    addHealthService(fakeServer as unknown as grpc.Server);

    let destroyed: grpc.ServiceError | undefined;
    registeredImplementation?.Watch({
      destroy: (error: grpc.ServiceError) => {
        destroyed = error;
      },
    } as unknown as grpc.ServerWritableStream<unknown, unknown>);
    expect(destroyed).toMatchObject({
      code: status.UNIMPLEMENTED,
      message: "grpc.health.v1.Health/Watch is not implemented",
    });
  });
});

const HealthClient = grpc.makeGenericClientConstructor(healthServiceDefinition, "grpc.health.v1.Health");

function bindServer(server: grpc.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`127.0.0.1:${port}`);
    });
  });
}

function unary(client: grpc.Client, method: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    (client as unknown as Record<string, Function>)[method](request, (error: grpc.ServiceError | null, response: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}
