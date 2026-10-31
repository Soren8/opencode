import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { Event } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { bindSessionTurnDiffUpdates, sessionTurnDiffQueryKey } from "@/pages/session/turn-diff-query"

test("rebinds turn diff invalidation to the current SDK directory", () => {
  const queryClient = new QueryClient()
  const firstDirectory = "C:/OpenCode/First"
  const nextDirectory = "C:/OpenCode/Next"
  const sessionID = "ses_directory_switch"
  const messageID = "msg_directory_switch"
  const firstKey = sessionTurnDiffQueryKey(firstDirectory, sessionID, messageID)
  const nextKey = sessionTurnDiffQueryKey(nextDirectory, sessionID, messageID)
  queryClient.setQueryData(firstKey, [])
  queryClient.setQueryData(nextKey, [])

  const listeners = new Map<string, (event: { details: Event }) => void>()
  const stopped: string[] = []
  const createSDK = (directory: string) => ({
    directory,
    event: {
      listen: (listener: (event: { details: Event }) => void) => {
        listeners.set(directory, listener)
        return () => {
          listeners.delete(directory)
          stopped.push(directory)
        }
      },
    },
  })
  const [sdk, setSDK] = createSignal(createSDK(firstDirectory))
  const event = {
    id: "evt_directory_switch",
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1 },
        summary: { diffs: [{ file: "src/switched.ts", additions: 1, deletions: 0 }] },
        agent: "build",
        model: { providerID: "opencode", modelID: "test" },
      },
    },
  } satisfies Event
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => {
    bindSessionTurnDiffUpdates(sdk, queryClient)
    return null
  }, host)

  setSDK(createSDK(nextDirectory))
  listeners.get(nextDirectory)?.({ details: event })

  expect(stopped).toEqual([firstDirectory])
  expect([...listeners.keys()]).toEqual([nextDirectory])
  expect(queryClient.getQueryState(firstKey)?.isInvalidated).toBe(false)
  expect(queryClient.getQueryState(nextKey)?.isInvalidated).toBe(true)

  dispose()
  host.remove()
  expect(stopped).toEqual([firstDirectory, nextDirectory])
})
