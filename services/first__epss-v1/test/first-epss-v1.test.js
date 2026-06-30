import { test } from "node:test";
import assert from "node:assert/strict";

import { GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import { handlers } from "../src/first-epss-v1.js";
import { service } from "../src/service.js";
import { createMockServer } from "./mock_upstream.js";

const METHOD = "first.epss.v1.EpssService/GetScores";

const buildCtx = (mock, cveIds) => ({
  config: { epssBaseUrl: mock.url, timeoutMs: 5000 },
  request: { cveIds },
});

test("first__epss-v1 — GetScores returns scores for known CVEs", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  const result = await handlers[METHOD](buildCtx(mock, ["CVE-2021-44228", "CVE-2022-22965"]));
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].cveId, "CVE-2021-44228");
  assert.equal(typeof result.data[0].epss, "number");
  assert.equal(result.data[0].epss > 0, true);
});

test("first__epss-v1 — GetScores returns empty for empty cveIds", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  const result = await handlers[METHOD](buildCtx(mock, []));
  assert.deepEqual(result, { data: [] });
});

test("first__epss-v1 — GetScores rejects non-array cveIds", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD](buildCtx(mock, "not-an-array")),
    (error) => error instanceof GrpcError && error.code === grpcStatus.INVALID_ARGUMENT,
  );
});

test("first__epss-v1 — maps upstream 5xx to UNAVAILABLE", async (t) => {
  const mock = await createMockServer();
  t.after(() => mock.close());

  await assert.rejects(
    () => handlers[METHOD]({
      config: { epssBaseUrl: mock.downUrl, timeoutMs: 5000 },
      request: { cveIds: ["CVE-2021-44228"] },
    }),
    (error) => error instanceof GrpcError && error.code === grpcStatus.UNAVAILABLE,
  );
});

test("first__epss-v1 — service exports handler map", () => {
  assert.equal(service.handlers[METHOD], handlers[METHOD]);
});
