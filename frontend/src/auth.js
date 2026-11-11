function authStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function clearAuthToken(storage = authStorage()) {
  try { storage?.removeItem("gym_auth_token"); } catch { /* Storage may be unavailable. */ }
}

export function saveAuthToken(token, storage = authStorage()) {
  clearAuthToken(storage);
  if (token) {
    try { storage?.setItem("gym_auth_token", token); } catch { /* Storage may be unavailable. */ }
  }
}

export function getAuthHeaders(headers = {}, storage = authStorage()) {
  let token;
  try { token = storage?.getItem("gym_auth_token"); } catch { /* Storage may be unavailable. */ }
  return { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
