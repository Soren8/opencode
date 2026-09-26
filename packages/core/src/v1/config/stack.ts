export * as ConfigStackV1 from "./stack"

import { Schema } from "effect"

export const Info = Schema.Struct({
  main: Schema.String.annotate({
    description: "Primary model in the format of provider/model, eg anthropic/claude-opus-4-6",
  }),
  sub: Schema.optional(Schema.String).annotate({
    description:
      "Workhorse subagent model in the format of provider/model. Defaults to main. Applies to all subagents unless the agent sets an explicit model.",
  }),
  plan: Schema.optional(Schema.String).annotate({
    description:
      "Plan mode model in the format of provider/model. Defaults to main. Used by the plan agent.",
  }),
  description: Schema.optional(Schema.String).annotate({ description: "Description of when to use this stack" }),
}).annotate({ identifier: "StackConfig" })
export type Info = Schema.Schema.Type<typeof Info>

export interface ModelRef {
  readonly providerID: string
  readonly modelID: string
}

// Parses "provider/model" references shared by stack config, session metadata
// overrides, and CLI pickers. Returns undefined for anything else so one bad
// value never breaks resolution.
export function parseModelRef(value: unknown): ModelRef | undefined {
  if (typeof value !== "string") return undefined
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return {
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  }
}
