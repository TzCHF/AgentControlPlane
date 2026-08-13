export const CONTROLLER_KINDS = Object.freeze({
  MCP: "mcp",
  API: "api",
  BROWSER: "browser",
});

export function normalizeControllerIdentity(input = {}) {
  const kind = String(input.kind ?? CONTROLLER_KINDS.MCP);
  if (!Object.values(CONTROLLER_KINDS).includes(kind)) {
    throw new TypeError(`Unknown controller kind: ${kind}`);
  }
  return {
    id: String(input.id ?? "unknown"),
    kind,
    model: input.model == null ? null : String(input.model),
  };
}
