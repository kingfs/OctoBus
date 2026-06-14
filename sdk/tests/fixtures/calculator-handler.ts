import { defineService, GrpcError, grpcStatus } from "../../src/index.js";

export default defineService({
  handlers: {
    "calculator.v1.CalculatorService/Add": async (ctx) => {
      const request = ctx.request as { left: number; right: number };
      if (request.left === -1) {
        throw new GrpcError(grpcStatus.INVALID_ARGUMENT, "left must not be -1");
      }
      if (request.left === -2) {
        throw new Error("ordinary failure");
      }
      return { result: request.left + request.right };
    },
    "calculator.v1.CalculatorService/EchoContract": () => ({
      httpStatusCode: 200,
    }),
  },
});
