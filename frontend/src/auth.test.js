import test from "node:test";
import assert from "node:assert/strict";
import { clearAuthToken, saveAuthToken, getAuthHeaders } from "./auth.js";

test("authenticated API and raw fetch headers use the current token while retaining content type", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const headers = { "Content-Type": "application/json" };
  assert.deepEqual(getAuthHeaders(headers, storage), headers);
  saveAuthToken("new-session", storage);
  assert.deepEqual(getAuthHeaders({ ...headers, Authorization: "Bearer stale" }, storage), { ...headers, Authorization: "Bearer new-session" });
  clearAuthToken(storage);
  assert.deepEqual(getAuthHeaders(headers, storage), headers);
});

test("a failed or cached login cannot keep the preceding account's token", () => {
  const values = new Map([["gym_auth_token", "old-manager"]]);
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  clearAuthToken(storage);
  assert.deepEqual(getAuthHeaders({}, storage), {});
  saveAuthToken(undefined, storage);
  assert.equal(values.has("gym_auth_token"), false);
});

test("unavailable storage does not crash token handling", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => clearAuthToken(storage));
  assert.doesNotThrow(() => saveAuthToken("token", storage));
  assert.deepEqual(getAuthHeaders({ Accept: "application/json" }, storage), { Accept: "application/json" });
});
