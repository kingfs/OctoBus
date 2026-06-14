import { describe, expect, it } from "vitest";
import { defineService } from "../src/index.js";

describe("defineService", () => {
  it("returns a service definition with copied handlers", () => {
    const handler = () => ({ ok: true });
    const service = defineService({
      handlers: {
        "calculator.v1.CalculatorService/Add": handler,
      },
    });

    expect(service.handlers["calculator.v1.CalculatorService/Add"]).toBe(handler);
    expect(service.handlers).not.toBe({ "calculator.v1.CalculatorService/Add": handler });
  });
});
