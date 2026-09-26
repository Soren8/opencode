import { describe, expect, test } from "bun:test"
import {
  applyStackDefinition,
  formatStackLabel,
  resolveInitialStack,
  resolveStackDefinitions,
  selectionToMetadata,
} from "@/cli/cmd/run/stack.shared"
import type { RunProvider } from "@/cli/cmd/run/types"

const providers: RunProvider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-opus-4-6": {
        id: "claude-opus-4-6",
        providerID: "anthropic",
        api: { id: "anthropic", url: "https://anthropic.test", npm: "@ai-sdk/anthropic" },
        name: "Claude Opus 4.6",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
        limit: { context: 200000, output: 8192 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-01-01",
      },
    },
  },
  {
    id: "opencode",
    name: "opencode",
    source: "api",
    env: [],
    options: {},
    models: {
      "glm-4.7": {
        id: "glm-4.7",
        providerID: "opencode",
        api: { id: "opencode", url: "https://opencode.test", npm: "@ai-sdk/opencode" },
        name: "GLM 4.7",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 128000, output: 8192 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-01-01",
      },
    },
  },
]

const config = {
  stack: {
    cheap: {
      main: "opencode/glm-4.7",
      sub: "opencode/glm-4.7",
      plan: "anthropic/claude-opus-4-6",
    },
    max: {
      main: "anthropic/claude-opus-4-6",
      sub: "opencode/glm-4.7",
    },
    broken: {
      main: "nota-model",
    },
  },
  default_stack: "cheap",
}

describe("stack.shared", () => {
  test("resolveStackDefinitions parses stacks and skips invalid entries", () => {
    const defs = resolveStackDefinitions(config)
    expect(defs.defaultName).toBe("cheap")
    expect(defs.stacks.cheap?.main).toEqual({ providerID: "opencode", modelID: "glm-4.7" })
    expect(defs.stacks.cheap?.plan).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    // sub/plan fall back to main when omitted
    expect(defs.stacks.max?.plan).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    expect(defs.stacks.broken).toBeUndefined()
  })

  test("resolveInitialStack keeps the explicit model for main", () => {
    const defs = resolveStackDefinitions(config)
    const selection = resolveInitialStack({
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      saved: undefined,
      definitions: defs,
    })
    expect(selection.main).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    expect(selection.sub).toEqual({ providerID: "opencode", modelID: "glm-4.7" })
    expect(selection.plan).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    expect(selection.name).toBe("cheap")
  })

  test("applyStackDefinition expands a named stack", () => {
    const defs = resolveStackDefinitions(config)
    const selection = applyStackDefinition("max", defs)
    expect(selection).toEqual({
      name: "max",
      main: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      sub: { providerID: "opencode", modelID: "glm-4.7" },
      plan: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })
    expect(applyStackDefinition("missing", defs)).toBeUndefined()
  })

  test("selectionToMetadata serializes layers as provider/model strings", () => {
    expect(
      selectionToMetadata({
        name: "cheap",
        main: { providerID: "opencode", modelID: "glm-4.7" },
        sub: { providerID: "opencode", modelID: "glm-4.7" },
      }),
    ).toEqual({ name: "cheap", main: "opencode/glm-4.7", sub: "opencode/glm-4.7" })
  })

  test("formatStackLabel shows sub only when it differs from main", () => {
    const main = { providerID: "anthropic", modelID: "claude-opus-4-6" }
    expect(formatStackLabel(main, { ...main }, undefined, providers)).toBe("Claude Opus 4.6 · Anthropic")
    expect(
      formatStackLabel(main, { providerID: "opencode", modelID: "glm-4.7" }, undefined, providers),
    ).toBe("Claude Opus 4.6 · sub:GLM 4.7")
  })
})
