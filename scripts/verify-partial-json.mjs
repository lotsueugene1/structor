import assert from "node:assert/strict";

import {
  extractCompleteJsonArray,
  extractJsonStringField,
} from "../src/lib/ai/partial-json.ts";

function ids(source) {
  return extractCompleteJsonArray(source, "nodes").map(
    (node) => /** @type {{ id: string }} */ (node).id,
  );
}

const partial = `{
  "name": "Roommate Match",
  "description": "Matching for student housing.",
  "nodes": [
    {"id": "app", "name": "Roommate Match", "kind": "application", "summary": "Root"},
    {"id": "matching", "name": "Matching", "kind": "domain", "summary": "Pairs roommates"
`;

assert.equal(extractJsonStringField(partial, "name"), "Roommate Match");
assert.deepEqual(ids(partial), ["app"]);
assert.deepEqual(extractCompleteJsonArray(partial, "edges"), []);

const closedMatching = `${partial}}`;
assert.deepEqual(ids(closedMatching), ["app", "matching"]);

const withAuth = `${closedMatching}, {"id": "auth", "name": "Campus SSO", "kind": "security", "summary": "Identity"}]`;
assert.deepEqual(ids(withAuth), ["app", "matching", "auth"]);

console.log("PASS extract complete nodes from partial tool JSON");
