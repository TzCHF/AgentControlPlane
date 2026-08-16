// Read-only bulk reconciliation lookup client.
//
// The client posts asterroute_request_id batches to the configured lookup
// endpoint and returns provider rows. ACP uses those rows to compute
// presence and token states locally and to read settlement fields; it never
// writes actual cost or settled state to the provider.

export class ReconcileClient {
  constructor({ baseUrl, apiKey, timeoutMs = 30000 }) {
    this.baseUrl = typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : null;
    this.apiKey = apiKey ?? null;
    this.timeoutMs = timeoutMs;
  }

  get available() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async lookup(requestIds) {
    if (!this.available) return { rows: [], error: "reconcile_client_unconfigured" };
    const ids = [...new Set((requestIds ?? []).map(String).filter(Boolean))].slice(0, 100);
    if (ids.length === 0) return { rows: [] };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/usage/reconcile/lookup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ request_ids: ids }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          rows: [],
          error: `lookup returned ${response.status}`,
        };
      }
      const payload = await response.json();
      return { rows: Array.isArray(payload?.rows) ? payload.rows : [] };
    } catch (error) {
      return { rows: [], error: error.message };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function sameOrigin(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

// Builds the reconciliation client for a relay. The relay API key is reused
// only when the reconcile endpoint shares the relay's origin; a cross-origin
// endpoint requires its own key and refuses to fall back to the relay key.
export function reconcileClientFor({ relayConfig, executorBaseUrl, env = process.env }) {
  const reconcileUrl = relayConfig?.reconcileUrl ?? null;
  if (!reconcileUrl) {
    return { client: null, error: "reconcile_client_unconfigured" };
  }
  const relayKey =
    env[relayConfig.apiKeyEnv] ?? relayConfig.apiKey ?? null;
  if (!executorBaseUrl || sameOrigin(reconcileUrl, executorBaseUrl)) {
    return {
      client: new ReconcileClient({ baseUrl: reconcileUrl, apiKey: relayKey }),
      error: null,
    };
  }
  const separateKey =
    env[relayConfig.reconcileApiKeyEnv] ?? relayConfig.reconcileApiKey ?? null;
  if (!separateKey) {
    return {
      client: null,
      error: "reconcile_cross_origin_without_key",
    };
  }
  return {
    client: new ReconcileClient({ baseUrl: reconcileUrl, apiKey: separateKey }),
    error: null,
  };
}
