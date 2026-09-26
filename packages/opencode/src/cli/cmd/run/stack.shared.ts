// Named model stacks for direct interactive mode (`opencode --mini`).
//
// A stack is a Main + Sub agent combination with an optional Plan override:
//   main -- primary orchestrator model (existing model selection)
//   sub  -- workhorse model for all subagents without an explicit agent.model
//   plan -- plan-mode model, falls back to main
//
// Stacks resolve from opencode config (`stack` + `default_stack`) via
// `sdk.config.get`, layer overrides persist across sessions in
// ~/.local/state/opencode/stack.json, and the active selection pushes to the
// session metadata (`metadata.stack`) so the server-side Task tool and prompt
// pipeline resolve sub/plan models without new API surface.
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { ConfigStackV1 } from "@opencode-ai/core/v1/config/stack"
import { modelInfo } from "./variant.shared"
import type { RunInput, RunProvider } from "./types"

const STACK_FILE = path.join(Global.Path.state, "stack.json")

export type StackModelRef = NonNullable<RunInput["model"]>

export type StackSelection = {
  name?: string
  main?: StackModelRef
  sub?: StackModelRef
  plan?: StackModelRef
}

export type StackDefinitions = {
  stacks: Record<string, StackSelection>
  defaultName?: string
}

function parseRef(value: unknown): StackModelRef | undefined {
  const ref = ConfigStackV1.parseModelRef(value)
  if (!ref) return undefined
  return { providerID: ref.providerID, modelID: ref.modelID }
}

function sameRef(a: StackModelRef | undefined, b: StackModelRef | undefined): boolean {
  if (!a || !b) return a === b
  return a.providerID === b.providerID && a.modelID === b.modelID
}

// Parses the `stack` + `default_stack` fields of `sdk.config.get` output.
// Unknown/invalid entries are skipped so one bad stack never breaks startup.
export function resolveStackDefinitions(config: unknown): StackDefinitions {
  if (!config || typeof config !== "object") return { stacks: {} }
  const record = config as Record<string, unknown>
  const raw = record.stack
  const stacks: Record<string, StackSelection> = {}
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const item = entry as Record<string, unknown>
      const main = parseRef(item.main)
      if (!main) continue
      stacks[name] = {
        name,
        main,
        sub: parseRef(item.sub) ?? main,
        plan: parseRef(item.plan) ?? main,
      }
    }
  }
  const defaultName = typeof record.default_stack === "string" ? record.default_stack : undefined
  return {
    stacks,
    defaultName: defaultName && stacks[defaultName] ? defaultName : undefined,
  }
}

function savedSelection(value: unknown): StackSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const ref = (key: string) => {
    const item = record[key]
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined
    const entry = item as Record<string, unknown>
    if (typeof entry.providerID !== "string" || typeof entry.modelID !== "string") return undefined
    return { providerID: entry.providerID, modelID: entry.modelID }
  }
  const name = typeof record.name === "string" ? record.name : undefined
  const selection: StackSelection = {
    ...(name ? { name } : {}),
    main: ref("main"),
    sub: ref("sub"),
    plan: ref("plan"),
  }
  if (!selection.name && !selection.main && !selection.sub && !selection.plan) return undefined
  return selection
}

export async function loadSavedStack(): Promise<StackSelection | undefined> {
  try {
    return savedSelection(await Bun.file(STACK_FILE).json())
  } catch {
    return undefined
  }
}

export function saveStackSelection(selection: StackSelection): void {
  void Bun.write(STACK_FILE, JSON.stringify(selection, null, 2)).catch(() => {})
}

// Merges boot model, saved selection, and config stacks. The explicit model
// (CLI flag or config `model`) always wins for main so stack boot never
// surprises the primary selection; stacks contribute sub/plan until the user
// picks a stack outright.
export function resolveInitialStack(input: {
  model: RunInput["model"]
  saved: StackSelection | undefined
  definitions: StackDefinitions
}): StackSelection {
  const named = (name: string | undefined) => (name ? input.definitions.stacks[name] : undefined)
  const base = named(input.saved?.name) ?? named(input.definitions.defaultName)
  return {
    ...(base?.name ?? input.saved?.name ? { name: base?.name ?? input.saved?.name } : {}),
    main: input.model ?? input.saved?.main ?? base?.main,
    sub: input.saved?.sub ?? base?.sub,
    plan: input.saved?.plan ?? base?.plan,
  }
}

export function applyStackDefinition(name: string, definitions: StackDefinitions): StackSelection | undefined {
  const def = definitions.stacks[name]
  if (!def) return undefined
  return { name, main: def.main, sub: def.sub, plan: def.plan }
}

export function selectionToMetadata(selection: StackSelection): Record<string, unknown> {
  const ref = (item: StackModelRef | undefined) =>
    item ? `${item.providerID}/${item.modelID}` : undefined
  return {
    ...(selection.name ? { name: selection.name } : {}),
    ...(selection.main ? { main: ref(selection.main) } : {}),
    ...(selection.sub ? { sub: ref(selection.sub) } : {}),
    ...(selection.plan ? { plan: ref(selection.plan) } : {}),
  }
}

// Best-effort push of the active stack to session metadata. The server
// replaces metadata wholesale, so read-merge-write to avoid clobbering keys.
// Failures are swallowed: primary prompts still carry the right model via
// runPromptTurn, only subagent routing falls back to inheritance.
export async function pushStackToSession(
  sdk: RunInput["sdk"],
  sessionID: string,
  selection: StackSelection,
): Promise<void> {
  try {
    if (!sessionID) return
    const current = await sdk.session.get({ sessionID }).catch(() => undefined)
    const metadata = { ...((current?.data as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {}) }
    metadata.stack = selectionToMetadata(selection)
    await sdk.session.update({ sessionID, metadata }).catch(() => undefined)
  } catch {}
}

// Statusline label. Shows just main when the stack is uniform, otherwise
// appends the sub short name so `cheap` vs `max` mixes are visible at a glance.
export function formatStackLabel(
  model: RunInput["model"],
  sub: RunInput["model"],
  variant: string | undefined,
  providers: RunProvider[] | undefined,
): string {
  if (!model) return "Model default"
  if (!sub || sameRef(model, sub)) {
    const names = modelInfo(providers, model)
    const label = variant ? ` · ${variant}` : ""
    return `${names.model} · ${names.provider}${label}`
  }
  const main = modelInfo(providers, model)
  const workhorse = modelInfo(providers, sub)
  return `${main.model} · sub:${workhorse.model}`
}
