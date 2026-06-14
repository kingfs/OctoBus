import { create, fromJson, toJson, type DescField, type DescMessage, type Message } from "@bufbuild/protobuf";
import { ScalarType } from "@bufbuild/protobuf";

export function messageJsonSchema(message: DescMessage, title: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of message.fields) {
    properties[fieldJsonName(field)] = fieldJsonSchema(field);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title,
    type: "object",
    properties,
    additionalProperties: false,
  };
}

export function protobufMessageToProtoJson(value: unknown, message: DescMessage): unknown {
  const typed: Message = isMessage(value) ? value : messageFromRuntimeValue(message, value);
  return toJson(message, typed);
}

export function fieldJsonName(field: DescField): string {
  return field.jsonName;
}

export function normalizeTypeName(value: string | undefined): string {
  return value?.replace(/^\./, "") ?? "";
}

function fieldJsonSchema(field: DescField): Record<string, unknown> {
  if (field.fieldKind === "map") {
    return {
      type: "object",
      additionalProperties: mapValueJsonSchema(field),
    };
  }
  const schema = singleFieldJsonSchema(field);
  if (field.fieldKind === "list") {
    return { type: "array", items: schema };
  }
  return schema;
}

function mapValueJsonSchema(field: DescField): Record<string, unknown> {
  if (field.fieldKind !== "map") {
    return {};
  }
  switch (field.mapKind) {
    case "scalar":
      return scalarJsonSchema(field.scalar);
    case "enum":
      return { type: "string" };
    case "message":
      return wellKnownTypeJsonSchema(field.message.typeName) ?? { type: "object" };
  }
}

function singleFieldJsonSchema(field: DescField): Record<string, unknown> {
  switch (field.fieldKind) {
    case "scalar":
      return scalarJsonSchema(field.scalar);
    case "enum":
      return { type: "string" };
    case "message":
      return wellKnownTypeJsonSchema(field.message.typeName) ?? { type: "object" };
    case "list":
      switch (field.listKind) {
        case "scalar":
          return scalarJsonSchema(field.scalar);
        case "enum":
          return { type: "string" };
        case "message":
          return wellKnownTypeJsonSchema(field.message.typeName) ?? { type: "object" };
      }
    case "map":
      return mapValueJsonSchema(field);
  }
}

function scalarJsonSchema(type: ScalarType): Record<string, unknown> {
  switch (type) {
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return { type: "number" };
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return { oneOf: [{ type: "integer" }, { type: "string" }] };
    case ScalarType.INT32:
    case ScalarType.UINT32:
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
      return { type: "integer" };
    case ScalarType.BOOL:
      return { type: "boolean" };
    case ScalarType.STRING:
      return { type: "string" };
    case ScalarType.BYTES:
      return { type: "string", contentEncoding: "base64" };
  }
}

function wellKnownTypeJsonSchema(typeName: string | undefined): Record<string, unknown> | undefined {
  switch (normalizeTypeName(typeName)) {
    case "google.protobuf.Timestamp":
      return { type: "string", format: "date-time" };
    case "google.protobuf.Duration":
    case "google.protobuf.FieldMask":
      return { type: "string" };
    case "google.protobuf.DoubleValue":
    case "google.protobuf.FloatValue":
      return { type: "number" };
    case "google.protobuf.Int64Value":
    case "google.protobuf.UInt64Value":
      return { type: "string" };
    case "google.protobuf.Int32Value":
    case "google.protobuf.UInt32Value":
      return { type: "integer" };
    case "google.protobuf.BoolValue":
      return { type: "boolean" };
    case "google.protobuf.StringValue":
      return { type: "string" };
    case "google.protobuf.BytesValue":
      return { type: "string", contentEncoding: "base64" };
    case "google.protobuf.Value":
      return { description: "Arbitrary JSON value" };
    case "google.protobuf.Struct":
      return {
        type: "object",
        description: "Arbitrary JSON object",
        additionalProperties: true,
      };
    case "google.protobuf.ListValue":
      return {
        type: "array",
        description: "Arbitrary JSON array",
      };
    default:
      return undefined;
  }
}

function messageFromRuntimeValue(message: DescMessage, value: unknown): Message {
  if (!isPlainObject(value)) {
    return create(message);
  }
  try {
    return fromJson(message, value as never);
  } catch {
    return create(message, value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  return value !== null
    && typeof value === "object"
    && "$typeName" in value
    && typeof (value as { $typeName?: unknown }).$typeName === "string";
}
