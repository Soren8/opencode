import { afterEach, describe, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CliError } from "../../src/cli/effect-cmd"
import { InstanceState } from "@/effect/instance-state"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { NotFoundError, Storage } from "@/storage/storage"
import { importSessionData, type ExportData } from "../../src/cli/cmd/import"
import { exportSessionData } from "../../src/cli/cmd/export"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([SessionSummary.node, Session.node, SessionProjector.node, Storage.node, Database.node]),
  ),
)
const readError = new FSUtil.FileSystemError({ method: "read" })
const itWithMessageDiffReadFailure = testEffect(
  LayerNode.compile(
    LayerNode.group([SessionSummary.node, Session.node, SessionProjector.node, Storage.node, Database.node]),
    [
      [
        Storage.node,
        Layer.mock(Storage.Service, {
          read: <T>(key: string[]) => (key[0] === "message_diff" ? Effect.fail(readError) : Effect.succeed([] as T)),
        }),
      ],
    ],
  ),
)
const missing = new NotFoundError({ message: "missing session" })
const itWithNotFoundDefect = testEffect(
  LayerNode.compile(
    LayerNode.group([SessionSummary.node, Session.node, SessionProjector.node, Storage.node, Database.node]),
    [[Session.node, Layer.mock(Session.Service, { get: () => Effect.die(missing) })]],
  ),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") }

describe("message patch archive round-trip", () => {
  it.instance(
    "exports full message patches and imports them without embedding patches in message data",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const storage = yield* Storage.Service
        const source = yield* sessions.create({ title: "archive-source" })
        const message = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: source.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model,
          summary: { diffs: [{ file: "message.ts", additions: 1, deletions: 0, status: "modified" }] },
        } satisfies SessionV1.User)
        const messageDiffs = [
          { file: "message.ts", patch: "@@ message patch", additions: 1, deletions: 0, status: "modified" as const },
        ]
        yield* storage.write(["message_diff", source.id, message.id], messageDiffs)

        const archived = yield* exportSessionData(source.id)
        expect(
          archived.messages[0]?.info.role === "user" ? archived.messages[0].info.summary?.diffs : undefined,
        ).toEqual(messageDiffs)

        const importedSessionID = SessionID.descending()
        const importedMessageID = MessageID.ascending()
        const importData = JSON.parse(
          JSON.stringify({
            ...archived,
            info: { ...archived.info, id: importedSessionID },
            messages: archived.messages.map((item) => ({
              ...item,
              info: { ...item.info, id: importedMessageID, sessionID: importedSessionID },
            })),
          }),
        ) as ExportData
        yield* importSessionData(importData, yield* InstanceState.context)

        const database = yield* Database.Service
        const importedMessage = yield* MessageV2.get({
          sessionID: importedSessionID,
          messageID: importedMessageID,
        }).pipe(Effect.provideService(Database.Service, database))
        if (importedMessage.info.role !== "user") throw new Error("expected imported user message")
        expect(importedMessage.info.summary?.diffs).toEqual([
          { file: "message.ts", additions: 1, deletions: 0, status: "modified" },
        ])
        expect(yield* summary.diff({ sessionID: importedSessionID, messageID: importedMessageID })).toEqual(
          messageDiffs,
        )
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance("preserves imported message stats and patches when reimporting conflicting IDs", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const storage = yield* Storage.Service
      const source = yield* sessions.create({ title: "archive-conflict" })
      const message = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: source.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model,
        summary: { diffs: [{ file: "message.ts", additions: 1, deletions: 0, status: "modified" }] },
      } satisfies SessionV1.User)
      const originalDiffs = [
        { file: "message.ts", patch: "@@ original patch", additions: 1, deletions: 0, status: "modified" as const },
      ]
      const changedDiffs = [
        { file: "message.ts", patch: "@@ changed patch", additions: 8, deletions: 3, status: "modified" as const },
      ]
      yield* storage.write(["message_diff", source.id, message.id], originalDiffs)

      const archived = yield* exportSessionData(source.id)
      const importedSessionID = SessionID.descending()
      const importedMessageID = MessageID.ascending()
      const firstImport = JSON.parse(
        JSON.stringify({
          ...archived,
          info: { ...archived.info, id: importedSessionID },
          messages: archived.messages.map((item) => ({
            ...item,
            info: { ...item.info, id: importedMessageID, sessionID: importedSessionID },
          })),
        }),
      ) as ExportData
      const secondImport = JSON.parse(JSON.stringify(firstImport)) as ExportData
      const changedMessage = secondImport.messages[0]
      if (!changedMessage || changedMessage.info.role !== "user") throw new Error("expected imported user message")
      changedMessage.info.summary = { ...changedMessage.info.summary, diffs: changedDiffs }

      const ctx = yield* InstanceState.context
      yield* importSessionData(firstImport, ctx)
      yield* importSessionData(secondImport, ctx)

      const importedMessage = yield* MessageV2.get({ sessionID: importedSessionID, messageID: importedMessageID })
      if (importedMessage.info.role !== "user") throw new Error("expected imported user message")
      expect(importedMessage.info.summary?.diffs).toEqual([
        { file: "message.ts", additions: 1, deletions: 0, status: "modified" },
      ])
      const summary = yield* SessionSummary.Service
      expect(yield* summary.diff({ sessionID: importedSessionID, messageID: importedMessageID })).toEqual(originalDiffs)
    }),
  )

  it.instance("reports a missing session as the existing CLI error", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(exportSessionData(SessionID.descending()))
      if (Exit.isSuccess(exit)) throw new Error("expected missing session to fail")
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(CliError)
      if (!(error instanceof CliError)) throw new Error("expected CLI error")
      expect(error.message).toContain("Session not found:")
    }),
  )

  itWithNotFoundDefect.instance("reports a defective not-found from Session.get as the existing CLI error", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(exportSessionData(SessionID.descending()))
      if (Exit.isSuccess(exit)) throw new Error("expected missing session to fail")
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(CliError)
      if (!(error instanceof CliError)) throw new Error("expected CLI error")
      expect(error.message).toContain("Session not found:")
    }),
  )

  itWithMessageDiffReadFailure.instance(
    "does not report a message patch storage failure as a missing session",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const source = yield* sessions.create({ title: "read-failure" })
        yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: source.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model,
          summary: { diffs: [{ file: "message.ts", additions: 1, deletions: 0 }] },
        } satisfies SessionV1.User)

        const exit = yield* Effect.exit(exportSessionData(source.id))
        if (Exit.isSuccess(exit)) throw new Error("expected patch storage read to fail")
        expect(Cause.squash(exit.cause)).toBe(readError)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
