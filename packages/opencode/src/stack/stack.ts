import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Config } from "@/config/config"
import { ConfigStackV1 } from "@opencode-ai/core/v1/config/stack"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Context, Effect, Layer } from "effect"

export type Layer = "main" | "sub" | "plan"

export interface ModelRef {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

export interface Selection {
  readonly name?: string
  readonly main?: ModelRef
  readonly sub?: ModelRef
  readonly plan?: ModelRef
}

export interface Interface {
  readonly list: () => Effect.Effect<Record<string, Selection>>
  readonly get: (metadata?: Record<string, unknown>) => Effect.Effect<Selection | undefined>
  readonly resolve: (metadata: Record<string, unknown> | undefined, layer: Layer) => Effect.Effect<ModelRef | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Stack") {}

export const use = serviceUse(Service)

function parseRef(value: unknown): ModelRef | undefined {
  const ref = ConfigStackV1.parseModelRef(value)
  if (!ref) return undefined
  return {
    providerID: ProviderV2.ID.make(ref.providerID),
    modelID: ModelV2.ID.make(ref.modelID),
  }
}

function selectionFromConfig(entry: { main: string; sub?: string; plan?: string }): Selection | undefined {
  const main = parseRef(entry.main)
  if (!main) return undefined
  return {
    main,
    sub: parseRef(entry.sub) ?? main,
    plan: parseRef(entry.plan) ?? main,
  }
}

function selectionFromMetadata(value: unknown): Selection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const name = typeof record.name === "string" ? record.name : undefined
  const main = parseRef(record.main)
  const sub = parseRef(record.sub)
  const plan = parseRef(record.plan)
  if (!name && !main && !sub && !plan) return undefined
  return {
    ...(name ? { name } : {}),
    ...(main ? { main } : {}),
    ...(sub ? { sub } : {}),
    ...(plan ? { plan } : {}),
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const list = Effect.fn("Stack.list")(function* () {
      const cfg = yield* config.get()
      const out: Record<string, Selection> = {}
      for (const [name, entry] of Object.entries(cfg.stack ?? {})) {
        const selection = selectionFromConfig(entry)
        if (selection) out[name] = { ...selection, name }
      }
      return out
    })

    const get = Effect.fn("Stack.get")(function* (metadata?: Record<string, unknown>) {
      const cfg = yield* config.get()
      const override = selectionFromMetadata(metadata?.stack)
      const named = (name: string | undefined): Selection | undefined => {
        if (!name) return undefined
        const entry = cfg.stack?.[name]
        if (!entry) return undefined
        const selection = selectionFromConfig(entry)
        return selection ? { ...selection, name } : undefined
      }
      const active = named(override?.name) ?? named(cfg.default_stack)
      if (!active && !override) return undefined
      return {
        ...(active?.name ? { name: active.name } : {}),
        main: override?.main ?? active?.main,
        sub: override?.sub ?? active?.sub,
        plan: override?.plan ?? active?.plan,
      }
    })

    const resolve = Effect.fn("Stack.resolve")(function* (
      metadata: Record<string, unknown> | undefined,
      layer: Layer,
    ) {
      return (yield* get(metadata))?.[layer]
    })

    return Service.of({ list, get, resolve })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node],
})

export * as Stack from "./stack"
