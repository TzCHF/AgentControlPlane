export class ControlPlaneError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = code;
    this.details = details;
  }
}

export function asErrorPayload(error) {
  if (error instanceof ControlPlaneError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    details: null,
  };
}

