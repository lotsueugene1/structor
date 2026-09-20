import assert from "node:assert/strict";

import {
  extractCompleteJsonArray,
  extractJsonArray,
  extractJsonStringField,
} from "../src/lib/ai/partial-json.ts";

function ids(source) {
  return extractJsonArray(source, "nodes").map(
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
assert.deepEqual(
  extractCompleteJsonArray(partial, "nodes").map(
    (node) => /** @type {{ id: string }} */ (node).id,
  ),
  ["app"],
);
assert.deepEqual(ids(partial), ["app", "matching"]);
assert.deepEqual(extractCompleteJsonArray(partial, "edges"), []);

const closedMatching = `${partial}}`;
assert.deepEqual(ids(closedMatching), ["app", "matching"]);

const withAuth = `${closedMatching}, {"id": "auth", "name": "Campus SSO", "kind": "security", "summary": "Identity"}]`;
assert.deepEqual(ids(withAuth), ["app", "matching", "auth"]);

const firstNode = `{
  "name": "Bean Buddy",
  "nodes": [
    {"id": "application", "name": "Bean Buddy Loyalty", "kind": "application", "summary": "A dual-interface`;
assert.deepEqual(ids(firstNode), ["application"]);

console.log(
  "PASS extract complete and in-progress nodes from partial tool JSON",
);
