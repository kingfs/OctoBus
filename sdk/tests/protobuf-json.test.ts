import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadServicePackage } from "../src/proto-loader.js";
import { protobufMessageToProtoJson } from "../src/protobuf-json.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("protobufMessageToProtoJson", () => {
  it("prints well-known types, maps, repeated messages, bytes, enums, and custom json_name as ProtoJSON", () => {
    const type = requiredMessage("calculator.v1.JsonShapeResponse");

    expect(protobufMessageToProtoJson({
      createdAt: { seconds: 1_704_067_200, nanos: 123_000_000 },
      elapsed: { seconds: 5, nanos: 250_000_000 },
      mask: { paths: ["custom_field", "created_at"] },
      label: "ready",
      total: "9007199254740993",
      raw: Buffer.from("ok"),
      status: 1,
      tags: { source: "unit" },
      children: [{ childName: "first" }],
      childMap: { a: { childName: "mapped" } },
      customField: "custom",
    }, type)).toEqual({
      createdAt: "2024-01-01T00:00:00.123Z",
      elapsed: "5.250s",
      mask: "customField,createdAt",
      label: "ready",
      total: "9007199254740993",
      raw: "b2s=",
      status: "JSON_SHAPE_STATUS_READY",
      tags: { source: "unit" },
      children: [{ childName: "first" }],
      childMapAlias: { a: { childName: "mapped" } },
      customAlias: "custom",
    });
  });

  it("prints Value, Struct, and ListValue as plain JSON", () => {
    const type = requiredMessage("calculator.v1.ContractResponse");

    expect(protobufMessageToProtoJson({
      httpStatusCode: 200,
      httpResponse: {
        kind: {
          case: "structValue",
          value: {
            fields: {
              success: { kind: { case: "boolValue", value: true } },
              data: {
                kind: {
                  case: "structValue",
                  value: {
                    fields: {
                      total: { kind: { case: "numberValue", value: 1 } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      object: { state: "ready" },
      list: {
        values: [
          { kind: { case: "numberValue", value: 1 } },
          { kind: { case: "stringValue", value: "x" } },
        ],
      },
    }, type)).toEqual({
      httpStatusCode: 200,
      httpResponse: {
        success: true,
        data: { total: 1 },
      },
      object: { state: "ready" },
      list: [1, "x"],
    });
  });
});

function requiredMessage(typeName: string) {
  const message = loadServicePackage(fixturesDir).registry.getMessage(typeName);
  if (!message) {
    throw new Error(`missing fixture message ${typeName}`);
  }
  return message;
}
