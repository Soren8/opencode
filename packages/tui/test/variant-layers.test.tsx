import { expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { useLocal } from "../src/context/local"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"
import { tmpdir } from "./fixture/fixture"

const shared = { providerID: "test", modelID: "shared" }
const core = await import("@opentui/core")

async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await Bun.sleep(10)
  }
  throw new Error("TUI state did not become ready")
}

async function start(state: string) {
  const setup = await createTestRenderer({ width: 110, height: 32, useThread: false })
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const updates: unknown[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: "test",
            name: "Test",
            models: {
              shared: {
                id: "shared",
                name: "Shared Model",
                providerID: "test",
                variants: { low: {}, medium: {}, high: {} },
              },
            },
          },
        ],
        default: { test: "shared" },
      })
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: ["test"] })
    if (url.pathname === "/agent")
      return json([
        { name: "build", mode: "primary", permission: [] },
        { name: "plan", mode: "primary", permission: [] },
      ])
    if (url.pathname === "/config")
      return json({
        default_stack: "same",
        stack: { same: { main: "test/shared", sub: "test/shared", plan: "test/shared" } },
      })
    if (url.pathname === "/session/test-session") return json({})
  })
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (new URL(request.url).pathname === "/session/test-session" && request.method === "PATCH")
      updates.push(await request.clone().json())
    return calls.fetch(input, init)
  }) as typeof globalThis.fetch
  const ready = Promise.withResolvers<ReturnType<typeof useLocal>>()
  function Probe() {
    ready.resolve(useLocal())
    return null
  }
  let api!: TuiPluginApi
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch,
      events: createEventSource().source,
      args: {},
      pluginHost: {
        async start(input) {
          api = input.api
          input.runtime.setupSlots(input.api).register({ id: "probe", slots: { app: () => <Probe /> } })
        },
        async dispose() {},
      },
    }).pipe(
      Effect.provideService(Global.Service, Global.make({ state })),
      Effect.provide(AppNodeBuilder.build(Global.node)),
    ),
  )
  const local = await ready.promise
  await waitFor(() => local.model.ready && local.stack.ready && !!local.model.current())
  return {
    local,
    updates,
    setup,
    api,
    async choose(command: string, query: string) {
      api.keymap.dispatchCommand(command)
      await Bun.sleep(25)
      await setup.renderOnce()
      await setup.mockInput.typeText(query)
      await Bun.sleep(25)
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await Bun.sleep(25)
      await setup.renderOnce()
    },
    async [Symbol.asyncDispose]() {
      process.emit("SIGHUP")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
}

test("same-model sub picker and main cycling keep independent efforts and outgoing stack metadata", async () => {
  await using state = await tmpdir()
  await using app = await start(state.path)
  app.local.model.variant.set("high")

  await app.choose("model.sub", "Shared Model")
  await app.setup.mockInput.typeText("medium")
  await Bun.sleep(25)
  await app.setup.renderOnce()
  app.setup.mockInput.pressEnter()
  await Bun.sleep(25)
  await app.setup.renderOnce()

  expect(app.local.model.variant.current()).toBe("high")
  await app.local.stack.push("test-session")
  expect(app.updates.at(-1)).toMatchObject({ metadata: { stack: { sub_variant: "medium" } } })

  await app.choose("variant.sub", "low")
  expect(app.local.model.variant.current()).toBe("high")
  app.api.keymap.dispatchCommand("variant.cycle")
  expect(app.local.model.variant.current()).toBeUndefined()
  await app.local.stack.push("test-session")
  expect(app.updates.at(-1)).toMatchObject({ metadata: { stack: { sub_variant: "low" } } })
})

test("legacy choices fall back per layer while explicit Default and new choices survive provider restart", async () => {
  await using state = await tmpdir()
  await Bun.write(`${state.path}/model.json`, JSON.stringify({ variant: { "test/shared": "high" } }))
  {
    await using app = await start(state.path)
    expect(app.local.model.variant.current()).toBe("high")
    await app.local.stack.push("test-session")
    expect(app.updates.at(-1)).toMatchObject({ metadata: { stack: { sub_variant: "high", plan_variant: "high" } } })

    await app.choose("variant.sub", "Default")
    expect(app.local.model.variant.current()).toBe("high")
    await app.choose("variant.plan", "medium")
    app.local.agent.set("plan")
    expect(app.local.model.variant.current()).toBe("medium")
    app.local.agent.set("build")
    expect(app.local.model.variant.current()).toBe("high")
    await waitFor(async () => JSON.stringify(await Bun.file(`${state.path}/model.json`).json()).includes("medium"))
  }
  {
    await using app = await start(state.path)
    expect(app.local.model.current()).toEqual(shared)
    expect(app.local.model.variant.current()).toBe("high")
    await app.local.stack.push("test-session")
    expect(app.updates.at(-1)).toMatchObject({ metadata: { stack: { plan_variant: "medium" } } })
    expect(app.updates.at(-1)).not.toMatchObject({ metadata: { stack: { sub_variant: expect.anything() } } })
    app.local.agent.set("plan")
    expect(app.local.model.variant.selected()).toBe("medium")
  }
})

test("plan model picker and the active-agent model picker edit plan effort without changing main or sub", async () => {
  await using state = await tmpdir()
  await using app = await start(state.path)
  app.local.model.variant.set("high")
  await app.choose("variant.sub", "low")

  await app.choose("model.plan", "Shared Model")
  await app.setup.mockInput.typeText("medium")
  await Bun.sleep(25)
  app.setup.mockInput.pressEnter()
  await Bun.sleep(25)
  expect(app.local.model.variant.current()).toBe("high")
  app.local.agent.set("plan")
  expect(app.local.model.variant.current()).toBe("medium")

  await app.choose("model.list", "Shared Model")
  await app.setup.mockInput.typeText("Default")
  await Bun.sleep(25)
  app.setup.mockInput.pressEnter()
  await Bun.sleep(25)
  expect(app.local.model.variant.selected()).toBe("default")
  expect(app.local.model.variant.current()).toBeUndefined()
  app.local.agent.set("build")
  expect(app.local.model.variant.current()).toBe("high")
  await app.local.stack.push("test-session")
  expect(app.updates.at(-1)).toMatchObject({ metadata: { stack: { sub_variant: "low" } } })
  expect(app.updates.at(-1)).not.toMatchObject({ metadata: { stack: { plan_variant: expect.anything() } } })
})
