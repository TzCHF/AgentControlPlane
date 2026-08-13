import { ControlPlaneError } from "./errors.js";

function stringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ControlPlaneError("invalid_brief", `${field} must be a string array`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function normalizeBrief(input, maxCharacters = 24000) {
  if (!input || typeof input !== "object") {
    throw new ControlPlaneError("invalid_brief", "Request body must be an object");
  }
  const objective = String(input.objective ?? "").trim();
  if (!objective) {
    throw new ControlPlaneError("invalid_brief", "objective is required");
  }

  const brief = {
    objective,
    constraints: stringList(input.constraints, "constraints"),
    acceptanceCriteria: stringList(
      input.acceptance_criteria ?? input.acceptanceCriteria,
      "acceptance_criteria",
    ),
    context: stringList(input.context, "context"),
    evidenceRequired: stringList(
      input.evidence_required ?? input.evidenceRequired,
      "evidence_required",
    ),
  };
  if (JSON.stringify(brief).length > maxCharacters) {
    throw new ControlPlaneError(
      "brief_too_large",
      `Engineering brief exceeds ${maxCharacters} characters`,
    );
  }
  return brief;
}

function section(title, lines) {
  if (!lines.length) return "";
  return `\n${title}:\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

export function buildEngineeringPrompt(brief, policy, followUp = false) {
  const delegation =
    policy.maxSubagents === 0
      ? "Do not create subagents."
      : `You may create at most ${policy.maxSubagents} subagents. Delegate only independent work that is likely to reduce total execution cost. Give subagents narrow prompts and avoid sending them the full conversation.`;

  const prefix = followUp
    ? "Continue the existing engineering task using the following compact follow-up."
    : "Execute the following compact engineering brief to completion.";

  return `${prefix}

OBJECTIVE:
${brief.objective}
${section("CONSTRAINTS", brief.constraints)}${section(
    "ACCEPTANCE CRITERIA",
    brief.acceptanceCriteria,
  )}${section("KNOWN CONTEXT", brief.context)}${section(
    "EVIDENCE REQUIRED",
    brief.evidenceRequired,
  )}
EXECUTION POLICY:
- Work autonomously inside the provided workspace.
- Inspect before editing; preserve unrelated user changes.
- Run proportionate tests or checks before declaring completion.
- ${delegation}
- Keep progress updates compact.
- Do not repeat the entire brief or dump long logs in the final response.
- If blocked, report the exact blocker and the smallest required user action.

FINAL RESPONSE:
Return a concise engineering report with status, summary, changed files, tests,
blockers, and next action.`;
}

export const finalReportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "summary",
    "changed_files",
    "tests",
    "blockers",
    "next_action",
  ],
  properties: {
    status: {
      type: "string",
      enum: ["completed", "partial", "blocked", "failed"],
    },
    summary: { type: "string" },
    changed_files: {
      type: "array",
      items: { type: "string" },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["command", "status"],
        properties: {
          command: { type: "string" },
          status: {
            type: "string",
            enum: ["passed", "failed", "not_run"],
          },
          detail: { type: ["string", "null"] },
        },
      },
    },
    blockers: {
      type: "array",
      items: { type: "string" },
    },
    next_action: { type: ["string", "null"] },
  },
};

