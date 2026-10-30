/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { KVProvider } from "../../../../src/context/kv"
import { ProjectProvider } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { PermissionProvider } from "../../../../src/context/permission"
import { ExitProvider } from "../../../../src/context/exit"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { createFetch, directory, json, wait } from "./sync-fixture"

const sessionID = "ses_reconnect"
const session = {
  id: sessionID,
  slug: "reconnect",
  projectID: "proj_test",
  directory,
  title: "reconnect",
  version: "1",
  time: { created: 1, updated: 1 },
}

function connected() {
  return `data: ${JSON.stringify({ directory, payload: { id: crypto.randomUUID(), type: "server.connected", properties: {} } })}\n\n`
}

// A real SSE server; each connection is handed to `onConnection` to decide how it behaves.
function eventServer(onConnection: (index: number, controller: ReadableStreamDefaultController<Uint8Array>) => void) {
  let connections = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      connections += 1
      const index = connections
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            onConnection(index, controller)
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  return {
    url: server.url,
    connections: () => connections,
    stop: () => server.stop(true),
  }
}

async function mount(events: ReturnType<typeof eventServer>, eventTimeout?: number) {
  const requests: string[] = []
  const calls = createFetch((url) => {
    requests.push(url.pathname)
    if (url.pathname === "/global/event") return globalThis.fetch(new URL(url.pathname, events.url))
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return json([])
    if (url.pathname === `/session/${sessionID}/todo`) return json([])
    if (url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  })
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    const ctx = useSync()
    onMount(() => {
      sync = ctx
      done()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ArgsProvider>
        <KVProvider>
          <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} eventTimeout={eventTimeout}>
            <PermissionProvider>
              <ProjectProvider>
                <ExitProvider exit={() => {}}>
                  <SyncProvider>
                    <Probe />
                  </SyncProvider>
                </ExitProvider>
              </ProjectProvider>
            </PermissionProvider>
          </SDKProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))
  await ready
  await wait(() => sync.status === "complete")
  return { app, sync, requests }
}

describe("tui event stream reconnect", () => {
  test("resyncs state missed while the event stream was disconnected", async () => {
    let drop!: () => void
    const events = eventServer((index, controller) => {
      controller.enqueue(new TextEncoder().encode(connected()))
      if (index === 1) drop = () => controller.close()
    })
    const { app, sync, requests } = await mount(events)
    try {
      await sync.session.sync(sessionID)
      await wait(() => drop !== undefined)
      const before = requests.filter((path) => path === `/session/${sessionID}/message`).length
      const providers = requests.filter((path) => path === "/config/providers").length

      drop()

      await wait(() => events.connections() === 2)
      await wait(() => requests.filter((path) => path === "/config/providers").length > providers)
      await wait(() => requests.filter((path) => path === `/session/${sessionID}/message`).length > before)
    } finally {
      app.renderer.destroy()
      events.stop()
    }
  })

  test("reconnects when a silently dead event stream stops sending heartbeats", async () => {
    // The first connection never sends anything after connecting, like a link lost in a wifi hop.
    const events = eventServer((_index, controller) => {
      controller.enqueue(new TextEncoder().encode(connected()))
    })
    const { app } = await mount(events, 200)
    try {
      await wait(() => events.connections() >= 2, 4000)
    } finally {
      app.renderer.destroy()
      events.stop()
    }
  })
})
