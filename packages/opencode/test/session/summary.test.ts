import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { and, eq } from "drizzle-orm"
import { Effect, Exit, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { Storage, NotFoundError } from "@/storage/storage"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const nodes = LayerNode.group([
  SessionSummary.node,
  Session.node,
  SessionProjector.node,
  Snapshot.node,
  Storage.node,
  Database.node,
])
const it = testEffect(LayerNode.compile(nodes))
const writeError = new FSUtil.FileSystemError({ method: "write" })
const itWithWriteFailure = testEffect(
  LayerNode.compile(nodes, [[Storage.node, Layer.mock(Storage.Service, { write: () => Effect.fail(writeError) })]]),
)
const readError = new FSUtil.FileSystemError({ method: "read" })
const itWithReadFailure = testEffect(
  LayerNode.compile(nodes, [[Storage.node, Layer.mock(Storage.Service, { read: () => Effect.fail(readError) })]]),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const MARKER = "summary-diff-marker"
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") }

const user = (sessionID: SessionID, summary?: SessionV1.User["summary"]) =>
  ({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model,
    summary,
  }) satisfies SessionV1.User

const turn = Effect.fnUntraced(function* (sessionID: SessionID, file: string, content = MARKER) {
  const test = yield* TestInstance
  const snapshot = yield* Snapshot.Service
  const sessions = yield* Session.Service
  const from = yield* snapshot.track()
  yield* Effect.promise(() =>
    fs.writeFile(path.join(test.directory, file), Array.from({ length: 2000 }, (_, i) => `${content} ${i}`).join("\n")),
  )
  const to = yield* snapshot.track()
  const message = yield* sessions.updateMessage(user(sessionID))
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: message.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: test.directory, root: test.directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } satisfies SessionV1.Assistant)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: assistant.id,
    type: "step-start",
    snapshot: from,
  } satisfies SessionV1.StepStartPart)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: assistant.id,
    type: "step-finish",
    reason: "stop",
    snapshot: to,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } satisfies SessionV1.StepFinishPart)
  return message
})

const messageEvents = Effect.fnUntraced(function* (sessionID: SessionID) {
  const database = yield* Database.Service
  return yield* database.db
    .select()
    .from(EventTable)
    .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, "message.updated.1")))
    .all()
    .pipe(Effect.orDie)
})

describe("session summary diffs", () => {
  it.instance(
    "forks the full patch sidecar with its message",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const storage = yield* Storage.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "source" })
        const message = yield* sessions.updateMessage(
          user(session.id, {
            diffs: [{ file: "forked.ts", additions: 1, deletions: 0, status: "modified" }],
          }),
        )
        const fullDiffs = [
          { file: "forked.ts", patch: `@@ ${MARKER}`, additions: 1, deletions: 0, status: "modified" as const },
        ]
        yield* storage.write(["message_diff", session.id, message.id], fullDiffs)

        const fork = yield* sessions.fork({ sessionID: session.id })
        const forkedMessage = (yield* sessions.messages({ sessionID: fork.id }))[0]
        if (!forkedMessage) throw new Error("expected the forked message")

        expect(yield* summary.diff({ sessionID: fork.id, messageID: forkedMessage.info.id })).toEqual(fullDiffs)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  itWithReadFailure.instance(
    "skips message sidecar reads for assistant and no-diff messages when forking",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "no-message-diffs" })
        yield* turn(session.id, "no-diff.txt")

        const fork = yield* sessions.fork({ sessionID: session.id })

        expect(yield* sessions.messages({ sessionID: fork.id })).toHaveLength(2)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "removes only message patch sidecars owned by the deleted session",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const storage = yield* Storage.Service
        const deleted = yield* sessions.create({ title: "deleted" })
        const retained = yield* sessions.create({ title: "retained" })
        const deletedMessageID = MessageID.ascending()
        const retainedMessageID = MessageID.ascending()
        const diffs = [{ file: "owned.ts", patch: MARKER, additions: 1, deletions: 0 }]
        yield* storage.write(["message_diff", deleted.id, deletedMessageID], diffs)
        yield* storage.write(["message_diff", retained.id, retainedMessageID], diffs)

        yield* sessions.remove(deleted.id)

        expect(Exit.isFailure(yield* Effect.exit(storage.read(["message_diff", deleted.id, deletedMessageID])))).toBe(
          true,
        )
        expect(yield* storage.read(["message_diff", retained.id, retainedMessageID])).toEqual(diffs)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "removes only the sidecar owned by the removed message",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const storage = yield* Storage.Service
        const session = yield* sessions.create({ title: "message-remove" })
        const removedMessageID = MessageID.ascending()
        const retainedMessageID = MessageID.ascending()
        const removedDiffs = [{ file: "removed.ts", patch: MARKER, additions: 1, deletions: 0 }]
        const retainedDiffs = [{ file: "retained.ts", patch: MARKER, additions: 1, deletions: 0 }]
        yield* storage.write(["message_diff", session.id, removedMessageID], removedDiffs)
        yield* storage.write(["message_diff", session.id, retainedMessageID], retainedDiffs)

        yield* sessions.removeMessage({ sessionID: session.id, messageID: removedMessageID })

        const missing = yield* Effect.flip(storage.read(["message_diff", session.id, removedMessageID]))
        expect(missing).toBeInstanceOf(NotFoundError)
        expect(yield* storage.read(["message_diff", session.id, retainedMessageID])).toEqual(retainedDiffs)

        const withoutSidecar = MessageID.ascending()
        const removed = yield* sessions.removeMessage({ sessionID: session.id, messageID: withoutSidecar })
        expect(removed).toBe(withoutSidecar)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps patches out of the message and MessageUpdated events but serves them on demand",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "summary" })
        yield* turn(session.id, "earlier.txt")
        const message = yield* turn(session.id, "big.txt")
        const before = (yield* messageEvents(session.id)).length

        yield* summary.summarize({ sessionID: session.id, messageID: message.id })

        const stored = yield* MessageV2.get({ sessionID: session.id, messageID: message.id }).pipe(
          Effect.provideService(Database.Service, yield* Database.Service),
        )
        if (stored.info.role !== "user") throw new Error("expected user message")
        expect(stored.info.summary?.diffs).toEqual([
          { file: "big.txt", additions: 2000, deletions: 0, status: "added" },
        ])

        const events = (yield* messageEvents(session.id)).slice(before)
        expect(events.length).toBe(1)
        expect(JSON.stringify(events[0]?.data)).not.toContain(MARKER)
        expect(JSON.stringify(events[0]?.data).length).toBeLessThan(2_000)

        const diffs = yield* summary.diff({ sessionID: session.id, messageID: message.id })
        expect(diffs.map((item) => item.file)).toEqual(["big.txt"])
        expect(diffs[0]?.patch).toContain(MARKER)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "does not republish an unchanged summary",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "summary" })
        const message = yield* turn(session.id, "big.txt")

        yield* summary.summarize({ sessionID: session.id, messageID: message.id })
        const before = (yield* messageEvents(session.id)).length
        yield* summary.summarize({ sessionID: session.id, messageID: message.id })

        expect((yield* messageEvents(session.id)).length).toBe(before)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "publishes changed patch text when file stats remain the same",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const snapshot = yield* Snapshot.Service
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "changed-patch" })
        const message = yield* turn(session.id, "same.txt", "before")

        yield* summary.summarize({ sessionID: session.id, messageID: message.id })
        const before = (yield* messageEvents(session.id)).length
        const previous = yield* summary.diff({ sessionID: session.id, messageID: message.id })
        const messages = yield* sessions.messages({ sessionID: session.id })
        const assistant = messages.find((item) => item.info.role === "assistant" && item.info.parentID === message.id)
        if (!assistant) throw new Error("expected assistant message")
        const finish = assistant.parts.find((part) => part.type === "step-finish")
        if (!finish) throw new Error("expected step-finish part")

        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(test.directory, "same.txt"),
            Array.from({ length: 2000 }, (_, i) => `after ${i}`).join("\n"),
          ),
        )
        yield* sessions.updatePart({ ...finish, snapshot: yield* snapshot.track() })
        yield* summary.summarize({ sessionID: session.id, messageID: message.id })

        const changed = yield* summary.diff({ sessionID: session.id, messageID: message.id })
        expect(
          changed.map(({ file, additions, deletions, status }) => ({ file, additions, deletions, status })),
        ).toEqual(previous.map(({ file, additions, deletions, status }) => ({ file, additions, deletions, status })))
        expect(changed[0]?.patch).not.toBe(previous[0]?.patch)
        expect((yield* messageEvents(session.id)).length).toBe(before + 1)

        yield* summary.summarize({ sessionID: session.id, messageID: message.id })
        expect((yield* messageEvents(session.id)).length).toBe(before + 1)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  itWithWriteFailure.instance(
    "does not publish diff stats when storing patches fails",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "summary" })
        const message = yield* turn(session.id, "big.txt")
        const before = (yield* messageEvents(session.id)).length

        const exit = yield* Effect.exit(summary.summarize({ sessionID: session.id, messageID: message.id }))

        expect(Exit.isFailure(exit)).toBe(true)
        expect((yield* messageEvents(session.id)).length).toBe(before)
        const stored = yield* MessageV2.get({ sessionID: session.id, messageID: message.id }).pipe(
          Effect.provideService(Database.Service, yield* Database.Service),
        )
        if (stored.info.role !== "user") throw new Error("expected user message")
        expect(stored.info.summary?.diffs).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  itWithReadFailure.instance(
    "does not fall back to embedded diffs when reading stored patches fails",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "legacy" })
        const message = yield* sessions.updateMessage(
          user(session.id, {
            diffs: [{ file: "legacy.ts", patch: `@@ ${MARKER}`, additions: 1, deletions: 0 }],
          }),
        )

        const exit = yield* Effect.exit(summary.diff({ sessionID: session.id, messageID: message.id }))

        expect(Exit.isFailure(exit)).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves legacy diffs embedded in the message",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const summary = yield* SessionSummary.Service
        const session = yield* sessions.create({ title: "legacy" })
        const message = yield* sessions.updateMessage(
          user(session.id, {
            diffs: [{ file: '"legacy\\303\\251.ts"', patch: `@@ ${MARKER}`, additions: 1, deletions: 0 }],
          }),
        )

        expect(yield* summary.diff({ sessionID: session.id, messageID: message.id })).toEqual([
          { file: "legacyé.ts", patch: `@@ ${MARKER}`, additions: 1, deletions: 0 },
        ])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
