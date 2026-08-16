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
