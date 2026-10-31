import type { QueryClient } from "@tanstack/solid-query"
import type { Event } from "@opencode-ai/sdk/v2/client"
import { createEffect, on, onCleanup, type Accessor } from "solid-js"

export function sessionTurnDiffQueryKey(directory: string, sessionID: string, messageID: string) {
  return ["session-turn-diff", directory, sessionID, messageID] as const
}

export function sessionTurnDiffQueryOptions<TDiff>(input: {
  directory: string
  sessionID: string | undefined
  messageID: string
  enabled: boolean
  queryFn: (sessionID: string, messageID: string) => Promise<{ sessionID: string; messageID: string; diffs: TDiff[] }>
}) {
  const sessionID = input.sessionID ?? ""
  const messageID = input.messageID

  return {
    queryKey: sessionTurnDiffQueryKey(input.directory, sessionID, messageID),
    enabled: !!input.sessionID && input.enabled,
    queryFn: () => input.queryFn(sessionID, messageID),
  }
}

export function invalidateSessionTurnDiffQuery(queryClient: QueryClient, directory: string, event: Event) {
  if (event.type !== "message.updated") return
  const message = event.properties.info
  if (message.role !== "user") return
  return queryClient.invalidateQueries({ queryKey: sessionTurnDiffQueryKey(directory, message.sessionID, message.id) })
}

export function bindSessionTurnDiffUpdates(sdk: Accessor<SessionTurnDiffSDK>, queryClient: QueryClient) {
  createEffect(
    on(
      () => {
        const current = sdk()
        return [current, current.directory] as const
      },
      ([current, directory]) => {
        onCleanup(
          current.event.listen((event) => {
            void invalidateSessionTurnDiffQuery(queryClient, directory, event.details)
          }),
        )
      },
    ),
  )
}

type SessionTurnDiffSDK = {
  directory: string
  event: {
    listen: (listener: (event: { details: Event }) => void) => () => void
  }
}
