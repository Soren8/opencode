import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Effect, Layer } from "effect"
import { Provider } from "@/provider/provider"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(
  Layer.mergeAll(testStateLayer, LayerNode.compile(LayerNode.group([FSUtil.node, ModelsDev.node])), httpApiLayer),
)

describe("provider catalog HttpApi", () => {
  it.instance(
    "lists unconnected catalog providers exactly as mapped from models.dev",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/provider", { headers: { "x-opencode-directory": directory } })
      expect(response.status).toBe(200)
      const body = (yield* response.json) as { all: Provider.Info[]; connected: string[] }
      const modelsDev = yield* ModelsDev.Service.use((service) => service.get())
      const unconnected = body.all.filter(
        (item) => !body.connected.includes(item.id) && Object.hasOwn(modelsDev, item.id),
      )
      expect(unconnected.length).toBeGreaterThan(0)
      for (const item of unconnected)
        expect(item).toEqual(JSON.parse(JSON.stringify(Provider.fromModelsDevProvider(modelsDev[item.id]))))
    }),
    { config: { formatter: false, lsp: false } },
    60000,
  )

  it.instance(
    "does not treat prototype names as connected providers",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/provider", { headers: { "x-opencode-directory": directory } })
      expect(response.status).toBe(200)
      const body = (yield* response.json) as { all: Provider.Info[]; connected: string[] }
      expect(body.connected).not.toContain("toString")
      expect(body.connected).not.toContain("constructor")
      expect(body.all.some((item) => item.id === "toString")).toBe(false)
    }),
    { config: { formatter: false, lsp: false } },
    60000,
  )
})
