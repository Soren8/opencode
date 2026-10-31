/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/sdk/v2"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createEffect, onCleanup, onMount, Show } from "solid-js"
import { DialogModel } from "../../../../src/component/dialog-model"
import { ArgsProvider } from "../../../../src/context/args"
import { ClipboardProvider } from "../../../../src/context/clipboard"
import { ExitProvider } from "../../../../src/context/exit"
import { KVProvider } from "../../../../src/context/kv"
import { LocalProvider } from "../../../../src/context/local"
import { PermissionProvider } from "../../../../src/context/permission"
import { ProjectProvider } from "../../../../src/context/project"
import { RouteProvider } from "../../../../src/context/route"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { ThemeProvider } from "../../../../src/context/theme"
import { TuiConfigProvider } from "../../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../../src/keymap"
import { DialogProvider } from "../../../../src/ui/dialog"
import { ToastProvider } from "../../../../src/ui/toast"
import { tmpdir } from "../../../fixture/fixture"
import { createTuiResolvedConfig } from "../../../fixture/tui-runtime"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { createEventSource, createFetch, directory, json, mount } from "./sync-fixture"

const openaiProvider: Provider = {
  id: "openai",
  name: "OpenAI",
  source: "config",
  env: [],
  options: {},
  models: {},
}

async function mountProviderUI(connected: boolean, connectDialog = false) {
  const providerDialog = await import("../../../../src/component/dialog-provider")
  const tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  const requests: string[] = []
  const events = createEventSource()
  const calls = createFetch(
    (url) => {
      requests.push(url.pathname)
      if (url.pathname === "/config/providers") {
        return json({ providers: connected ? [openaiProvider] : [], default: {} })
      }
      if (url.pathname === "/provider") {
        return json({ all: [openaiProvider], default: {}, connected: [] })
      }
      return undefined
    },
    events,
  )
  let sync!: ReturnType<typeof useSync>
  let finish!: () => void
  let finishPicker!: () => void
  const ready = new Promise<void>((resolve) => {
    finish = resolve
  })
  const pickerMounted = new Promise<void>((resolve) => {
    finishPicker = resolve
  })

  function Picker() {
    onMount(finishPicker)
    if (connectDialog) return <providerDialog.DialogProvider />
    return <DialogModel />
  }

  function Probe() {
    sync = useSync()
    createEffect(() => {
      if (sync.status === "complete") finish()
    })
    return (
      <Show when={sync.status === "complete"}>
        <Picker />
      </Show>
    )
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)
    return (
      <TestTuiContexts paths={{ state }}>
        <ExitProvider exit={() => {}}>
          <ClipboardProvider>
            <OpencodeKeymapProvider keymap={keymap}>
              <ArgsProvider>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <TuiConfigProvider config={config}>
                        <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncProvider>
                                <ThemeProvider mode="dark">
                                  <LocalProvider>
                                    <DialogProvider>
                                      <Probe />
                                    </DialogProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </SyncProvider>
                            </ProjectProvider>
                          </PermissionProvider>
                        </SDKProvider>
                      </TuiConfigProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ArgsProvider>
            </OpencodeKeymapProvider>
          </ClipboardProvider>
        </ExitProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />)
  await ready
  await pickerMounted
  return {
    app,
    requests,
    sync,
    async cleanup() {
      app.renderer.destroy()
      await tmp[Symbol.asyncDispose]()
    },
  }
}

describe("tui provider catalog", () => {
  test("a connected model picker does not load the provider catalog", async () => {
    const picker = await mountProviderUI(true)

    try {
      expect(picker.sync.data.provider).toHaveLength(1)
      expect(picker.requests).not.toContain("/provider")
    } finally {
      await picker.cleanup()
    }
  })

  test("an unconnected model picker loads providers for onboarding", async () => {
    const picker = await mountProviderUI(false)

    try {
      expect(picker.sync.data.provider).toEqual([])
      expect(picker.requests).toContain("/provider")
    } finally {
      await picker.cleanup()
    }
  })

  test("the connect-provider dialog loads the catalog even when connected", async () => {
    const picker = await mountProviderUI(true, true)

    try {
      expect(picker.sync.data.provider).toHaveLength(1)
      expect(picker.requests).toContain("/provider")
    } finally {
      await picker.cleanup()
    }
  })

  test("a mounted provider dialog reloads its catalog after bootstrap", async () => {
    const picker = await mountProviderUI(true, true)
    const listed = () => picker.requests.filter((path) => path === "/provider").length

    try {
      await picker.sync.provider.load()
      expect(listed()).toBe(1)

      await picker.sync.bootstrap()
      expect(listed()).toBe(2)
      await picker.sync.provider.load()
      expect(picker.sync.data.provider_next.all).toEqual([openaiProvider])
    } finally {
      await picker.cleanup()
    }
  })

  test("bootstrap skips the initial catalog fetch and refreshes a requested catalog", async () => {
    const requests: string[] = []
    const { app, sync } = await mount((url) => {
      requests.push(url.pathname)
      if (url.pathname === "/provider") {
        return json({ all: [openaiProvider], default: {}, connected: ["openai"] })
      }
      return undefined
    })
    const listed = () => requests.filter((path) => path === "/provider").length

    try {
      expect(requests).toContain("/config/providers")
      expect(listed()).toBe(0)

      await Promise.all([sync.provider.load(), sync.provider.load()])
      await sync.provider.load()
      expect(listed()).toBe(1)
      expect(sync.data.provider_next.connected).toEqual(["openai"])

      await sync.bootstrap()
      expect(listed()).toBe(2)
      await sync.provider.load()
      expect(sync.data.provider_next.connected).toEqual(["openai"])

      expect(listed()).toBe(2)
    } finally {
      app.renderer.destroy()
    }
  })

  test("concurrent bootstrap invalidates in-flight catalog loads", async () => {
    let resolveInitial!: (value: Response) => void
    let resolveRefresh!: (value: Response) => void
    let startInitial!: () => void
    let startRefresh!: () => void
    let listRequests = 0
    const initialStarted = new Promise<void>((resolve) => {
      startInitial = resolve
    })
    const refreshStarted = new Promise<void>((resolve) => {
      startRefresh = resolve
    })
    const requests: string[] = []
    const { app, sync } = await mount((url) => {
      requests.push(url.pathname)
      if (url.pathname === "/provider") {
        return new Promise<Response>((resolve) => {
          listRequests += 1
          if (listRequests === 1) {
            resolveInitial = resolve
            startInitial()
          }
          if (listRequests === 2) {
            resolveRefresh = resolve
            startRefresh()
          }
        })
      }
      return undefined
    })
    const listed = () => requests.filter((path) => path === "/provider").length

    try {
      const pending = sync.provider.load()
      await initialStarted
      expect(listed()).toBe(1)

      await sync.bootstrap()
      await refreshStarted
      expect(listed()).toBe(2)

      resolveInitial(
        json({ all: [{ ...openaiProvider, id: "stale", name: "Stale" }], default: {}, connected: ["stale"] }),
      )
      await pending
      expect(sync.data.provider_next.all).toEqual([])
      expect(sync.data.provider_next.connected).toEqual([])

      resolveRefresh(json({ all: [openaiProvider], default: {}, connected: ["openai"] }))
      await sync.provider.load()
      expect(sync.data.provider_next.all).toEqual([openaiProvider])
      expect(sync.data.provider_next.connected).toEqual(["openai"])
    } finally {
      app.renderer.destroy()
    }
  })
})
