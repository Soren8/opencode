import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"
import { tmpdir } from "./fixture/fixture"

test("home prompt renders its model footer without a session", async () => {
  const setup = await createTestRenderer({ width: 100, height: 32, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({ providers: [{ id: "test", name: "Test provider", models: {} }], default: {} })
    if (url.pathname === "/provider")
      return json({ all: [{ id: "test", name: "Test provider", models: {} }], default: {}, connected: ["test"] })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: [] }])
  })
  const ready = Promise.withResolvers<void>()
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: events.source,
      args: {},
      pluginHost: {
        async start(input) {
          input.runtime.setupSlots(input.api)
          ready.resolve()
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )

  try {
    await ready.promise
    await Bun.sleep(25)
    await setup.renderOnce()
    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("opencode crashed")
    expect(frame).toContain("No provider selected")
    expect(frame).toContain("Connect a provider")
  } finally {
    process.emit("SIGHUP")
    await task
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("switching to plan previews its selected model and effort after a previous turn", async () => {
  await using state = await tmpdir()
  await Bun.write(`${state.path}/model.json`, JSON.stringify({ variant: { "test/plan": "high" } }))
  const setup = await createTestRenderer({ width: 110, height: 32, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: "test",
            name: "Test provider",
            models: {
              main: { id: "main", name: "Main Model", providerID: "test", variants: { low: {} } },
              plan: { id: "plan", name: "Plan Model", providerID: "test", variants: { high: {} } },
            },
          },
        ],
        default: { test: "main" },
      })
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: ["test"] })
    if (url.pathname === "/agent")
      return json([
        { name: "build", mode: "primary", permission: [] },
        { name: "plan", mode: "primary", permission: [] },
      ])
    if (url.pathname === "/config")
      return json({ default_stack: "test-stack", stack: { "test-stack": { main: "test/main", plan: "test/plan" } } })
    if (url.pathname === "/session/test-session")
      return json({
        id: "test-session",
        title: "Test session",
        slug: "test",
        projectID: "proj_test",
        directory,
        version: "0.0.0-test",
        time: { created: 1, updated: 1 },
      })
    if (url.pathname === "/session/test-session/message")
      return json([
        {
          info: {
            id: "message-1",
            sessionID: "test-session",
            role: "user",
            time: { created: 1 },
            agent: "build",
            model: { providerID: "test", modelID: "main", variant: "low" },
          },
          parts: [],
        },
      ])
    if (url.pathname === "/session/test-session/todo" || url.pathname === "/session/test-session/diff") return json([])
  })
  const ready = Promise.withResolvers<void>()
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: events.source,
      args: { sessionID: "test-session" },
      pluginHost: {
        async start(input) {
          input.runtime.setupSlots(input.api)
          ready.resolve()
        },
        async dispose() {},
      },
    }).pipe(
      Effect.provideService(Global.Service, Global.make({ state: state.path })),
      Effect.provide(AppNodeBuilder.build(Global.node)),
    ),
  )

  try {
    await ready.promise
    await Bun.sleep(50)
    await setup.renderOnce()
    setup.mockInput.pressTab()
    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Plan Model")
    expect(frame).toContain("· high")
    expect(frame).not.toContain("Main Model")
    expect(frame).not.toContain("· low")
    expect(frame).not.toContain("opencode crashed")
  } finally {
    process.emit("SIGHUP")
    await task
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("subagent view shows the model and effort recorded for its turn", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 110, height: 32, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: "test",
            name: "Test provider",
            models: { child: { id: "child", name: "Child Model", providerID: "test", variants: { high: {} } } },
          },
        ],
        default: { test: "child" },
      })
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: ["test"] })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", permission: [] }])
    if (url.pathname === "/session/test-child")
      return json({
        id: "test-child",
        title: "Inspect (@explore subagent)",
        parentID: "test-parent",
        slug: "test",
        projectID: "proj_test",
        directory,
        version: "0.0.0-test",
        time: { created: 1, updated: 1 },
      })
    if (url.pathname === "/session/test-child/message")
      return json([
        {
          info: {
            id: "user-1",
            sessionID: "test-child",
            role: "user",
            time: { created: 1 },
            agent: "explore",
            model: { providerID: "test", modelID: "child", variant: "high" },
          },
          parts: [],
        },
      ])
    if (url.pathname === "/session/test-child/todo" || url.pathname === "/session/test-child/diff") return json([])
  })
  const ready = Promise.withResolvers<void>()
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: createEventSource().source,
      args: { sessionID: "test-child" },
      pluginHost: {
        async start(input) {
          input.runtime.setupSlots(input.api)
          ready.resolve()
        },
        async dispose() {},
      },
    }).pipe(
      Effect.provideService(Global.Service, Global.make({ state: state.path })),
      Effect.provide(AppNodeBuilder.build(Global.node)),
    ),
  )

  try {
    await ready.promise
    await Bun.sleep(50)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Child Model · high")
  } finally {
    process.emit("SIGHUP")
    await task
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("SIGHUP clears title and disposes scoped resources once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const titles: string[] = []
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    setTitle(title)
  }
  const listeners = new Set(process.listeners("SIGHUP"))
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposes = 0

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start() {
            started()
          },
          async dispose() {
            disposes++
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready
    process.emit("SIGHUP")
    await task

    expect(setup.renderer.isDestroyed).toBe(true)
    expect(titles.at(-1)).toBe("")
    expect(disposes).toBe(1)
    expect(process.listeners("SIGHUP").every((listener) => listeners.has(listener))).toBe(true)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("app.exit prints the session epilogue after scoped cleanup", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/session")
      return json([
        {
          id: "dummy",
          title: "Demo session",
          slug: "dummy",
          projectID: "project",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        },
      ])
  })
  const originalWrite = process.stdout.write.bind(process.stdout)
  let stdout = ""
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    await setup.renderOnce()
    await setup.renderOnce()
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stdout).toContain("Demo session")
    expect(stdout).toContain("opencode -s dummy")
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("fatal startup errors set a nonzero exit after scoped cleanup", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  await mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/config")
      return json(
        {
          name: "ConfigRemoteAuthError",
          data: {
            url: "https://example.com",
            remote: "https://config.example.com/opencode.json",
          },
        },
        { status: 400 },
      )
    return undefined
  })
  let disposes = 0
  const originalWrite = process.stderr.write.bind(process.stderr)
  const originalExitCode = process.exitCode ?? 0
  let stderr = ""

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start() {},
          async dispose() {
            disposes++
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await task
    expect(stderr).toContain("Run `opencode auth login https://example.com` to re-authenticate.")
    expect(stderr).not.toContain("Unexpected server error")
    expect(process.exitCode).toBe(1)
    expect(setup.renderer.isDestroyed).toBe(true)
    expect(disposes).toBe(1)
  } finally {
    process.stderr.write = originalWrite
    process.exitCode = originalExitCode
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})
