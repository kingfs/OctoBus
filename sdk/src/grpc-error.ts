export class GrpcError extends Error {
  public readonly code: number;

  public constructor(code: number, message: string) {
    super(message);
    this.name = "GrpcError";
    this.code = code;
  }
}

export function grpcError(code: number, message: string): GrpcError {
  return new GrpcError(code, message);
}
