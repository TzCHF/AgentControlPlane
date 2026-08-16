// Provider presets are data entries. Each entry pre-fills relay fields for
// a provider that speaks standard OpenAI-compatible protocols. No core module
// branches on these ids; removing any entry leaves ACP functional with any
// other relay or the built-in executors.

export const PROVIDER_PRESETS = {
  asterroute: {
    displayName: "AsterRoute",
    baseUrl: "https://www.asterroute.com/v1",
    apiKeyEnv: "ASTERROUTE_API_KEY",
    protocol: "auto",
    models: [],
    official: true,
    description: "Official relay provider preset",
  },
};

export function resolvePreset(presetName) {
  if (!presetName) return null;
  return structuredClone(PROVIDER_PRESETS[String(presetName)] ?? null);
}

export function presetNames() {
  return Object.keys(PROVIDER_PRESETS);
}
