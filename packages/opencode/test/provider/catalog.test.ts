import { afterEach, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, ModelsDev.node])))

const instanceStoreLayer = LayerNode.compile(InstanceStore.node, [
  [InstanceStore.bootstrapNode, InstanceBootstrap.node],
])

const loadIn = (directory: string) =>
  Effect.gen(function* () {
    const modelsDev = yield* ModelsDev.Service.use((service) => service.get())
    const before = structuredClone(Provider.catalog(modelsDev))
    const providers = yield* Provider.use.list()
    return { modelsDev, before, providers }
  })
    .pipe(provideInstanceEffect(directory))

const provideMultiInstance = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  eff.pipe(Effect.provide(instanceStoreLayer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

it.effect("models.dev catalog is built once per models.dev snapshot", () =>
  Effect.gen(function* () {
    const modelsDev = yield* ModelsDev.Service.use((service) => service.get())
    const catalog = Provider.catalog(modelsDev)
    expect(Provider.catalog(modelsDev)).toBe(catalog)
    expect(Provider.catalog({ ...modelsDev })).not.toBe(catalog)
    expect(catalog[ProviderV2.ID.anthropic].models).toEqual(
      Provider.fromModelsDevProvider(modelsDev[ProviderV2.ID.anthropic]).models,
    )
  }),
)

it.effect("loading instances leaves the shared catalog untouched", () =>
  Effect.gen(function* () {
    const modelsDev = yield* ModelsDev.Service.use((service) => service.get())
    const modelID = Object.keys(modelsDev[ProviderV2.ID.anthropic].models)[0]
    if (!modelID) throw new Error("models.dev catalog has no Anthropic models")

    const dir = yield* tmpdirScoped({
      config: {
        provider: {
          anthropic: {
            options: { apiKey: "test-key" },
            blacklist: [modelID],
            models: { "my-alias": { id: modelID, name: "My Custom Alias" } },
          },
        },
      },
    })

    const loaded = yield* loadIn(dir)
    const standardDir = yield* tmpdirScoped({ config: { provider: { anthropic: {} } } })
    const standard = yield* loadIn(standardDir)

    expect(loaded.providers[ProviderV2.ID.anthropic].models["my-alias"]).toBeDefined()
    expect(loaded.providers[ProviderV2.ID.anthropic].models[modelID]).toBeUndefined()
    expect(standard.providers[ProviderV2.ID.anthropic].models["my-alias"]).toBeUndefined()
    expect(standard.providers[ProviderV2.ID.anthropic].models[modelID]).toBeDefined()
    expect(Provider.catalog(loaded.modelsDev)).toEqual(loaded.before)
  }).pipe(provideMultiInstance),
)

it.effect("loads configured providers whose IDs match Object prototype properties", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({
      config: {
        provider: {
          toString: {
            models: {
              "custom-model": { name: "Custom Model" },
            },
          },
        },
      },
    })
    const providers = yield* Provider.use.list().pipe(provideInstanceEffect(directory))

    expect(providers[ProviderV2.ID.make("toString")]?.models["custom-model"]?.name).toBe("Custom Model")
  }).pipe(provideMultiInstance),
)
