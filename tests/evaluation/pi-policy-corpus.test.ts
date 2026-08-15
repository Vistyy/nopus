import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideRewrite, type ComplexitySensitivity } from "../../src/policy/decide-rewrite.js";

type Fixture = {
  schemaVersion: number;
  cases: Array<{
    metrics: Parameters<typeof decideRewrite>[0];
    expected: Record<ComplexitySensitivity, boolean>;
    label?: { status: "certain" | "uncertain"; firstRewriteProfile: ComplexitySensitivity | "none" | null };
  }>;
};

test("the text-free Pi corpus preserves profile policy decisions", async () => {
  const path = new URL("../../evaluation/fixtures/pi-policy-corpus.json", import.meta.url);
  const source = await readFile(path, "utf8");
  for (const forbidden of ["candidateId", "sourceSessionId", "sourceRecordId", "provider", "model", "text", "note"]) {
    assert.equal(source.includes(`\"${forbidden}\"`), false, `fixture must not contain ${forbidden}`);
  }
  const fixture = JSON.parse(source) as Fixture;
  assert.equal(fixture.schemaVersion, 1);
  assert.ok(fixture.cases.length >= 5_000);
  const profiles = ["low", "medium", "high"] as const;
  for (const item of fixture.cases) {
    for (const profile of profiles) {
      const actual = decideRewrite(item.metrics, profile).rewrite;
      assert.equal(actual, item.expected[profile]);
      if (item.label?.status === "certain") {
        const first = item.label.firstRewriteProfile;
        const humanExpected = first === "none" ? false : first !== null && profiles.indexOf(profile) >= profiles.indexOf(first);
        assert.equal(actual, humanExpected, `policy must match the certain human label at ${profile}`);
      }
    }
  }
});
