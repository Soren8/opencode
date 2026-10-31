import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { Event } from "@opencode-ai/sdk/v2/client"
import { invalidateSessionTurnDiffQuery, sessionTurnDiffQueryKey, sessionTurnDiffQueryOptions } from "./turn-diff-query"

test("invalidates only the scoped turn diff for a user message update with summary diffs", async () => {
  const queryClient = new QueryClient()
  const directory = "C:/OpenCode/TurnDiffQuery"
  const sessionID = "ses_turn_diff_query"
  const messageID = "msg_turn_diff_query"
  const matching = sessionTurnDiffQueryKey(directory, sessionID, messageID)
  const otherDirectory = sessionTurnDiffQueryKey("C:/OpenCode/Other", sessionID, messageID)
  const otherSession = sessionTurnDiffQueryKey(directory, "ses_other", messageID)
  const otherMessage = sessionTurnDiffQueryKey(directory, sessionID, "msg_other")
  for (const key of [matching, otherDirectory, otherSession, otherMessage]) queryClient.setQueryData(key, [])

  const event = {
    id: "evt_turn_diff_updated",
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1 },
        summary: { diffs: [{ file: "src/example.ts", additions: 1, deletions: 0 }] },
        agent: "build",
        model: { providerID: "opencode", modelID: "test" },
      },
    },
  } satisfies Event

  await invalidateSessionTurnDiffQuery(queryClient, directory, event)

  expect(queryClient.getQueryState(matching)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(otherDirectory)?.isInvalidated).toBe(false)
  expect(queryClient.getQueryState(otherSession)?.isInvalidated).toBe(false)
  expect(queryClient.getQueryState(otherMessage)?.isInvalidated).toBe(false)
})

test("invalidates cached patches when a user message update removes its summary diffs", async () => {
  const queryClient = new QueryClient()
  const directory = "C:/OpenCode/TurnDiffQuery"
  const sessionID = "ses_turn_diff_query"
  const messageID = "msg_turn_diff_query"
  const key = sessionTurnDiffQueryKey(directory, sessionID, messageID)
  queryClient.setQueryData(key, [])

  const event = {
    id: "evt_turn_diff_updated",
    type: "message.updated",
    properties: {
      sessionID,
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1 },
        summary: { diffs: [] },
        agent: "build",
        model: { providerID: "opencode", modelID: "test" },
      },
    },
  } satisfies Event

  await invalidateSessionTurnDiffQuery(queryClient, directory, event)

  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
})

test("keeps the query request and result identity captured when its options are created", async () => {
  const queryClient = new QueryClient()
  const request: { sessionID: string; messageID: string }[] = []
  const current = { sessionID: "ses_original", messageID: "msg_original" }
  const options = sessionTurnDiffQueryOptions({
    directory: "C:/OpenCode/TurnDiffQuery",
    ...current,
    enabled: true,
    queryFn: async (sessionID, messageID) => {
      request.push({ sessionID, messageID })
      return { sessionID, messageID, diffs: [{ file: "src/original.ts" }] }
    },
  })
  current.sessionID = "ses_replaced"
  current.messageID = "msg_replaced"

  const result = await queryClient.fetchQuery(options)

  expect(options.queryKey).toEqual(sessionTurnDiffQueryKey("C:/OpenCode/TurnDiffQuery", "ses_original", "msg_original"))
  expect(request).toEqual([{ sessionID: "ses_original", messageID: "msg_original" }])
  expect(result).toEqual({
    sessionID: "ses_original",
    messageID: "msg_original",
    diffs: [{ file: "src/original.ts" }],
  })
})
