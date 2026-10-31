import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { Effect, Layer, Context, Schema } from "effect"
import { and, asc, eq, gte, sql } from "drizzle-orm"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Snapshot } from "@/snapshot"
import { NotFoundError, Storage } from "@/storage/storage"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionID, MessageID } from "./schema"
import { Config } from "@/config/config"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: SessionV1.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service

    const storage = yield* Storage.Service
    const database = yield* Database.Service

    const diffRange = Effect.fnUntraced(function* (parts: Iterable<SessionV1.Part | V1StepPart>) {
      let from: string | undefined
      let to: string | undefined
      for (const part of parts) {
        if (!from && part.type === "step-start" && part.snapshot) from = part.snapshot
        if (part.type === "step-finish" && part.snapshot) to = part.snapshot
      }
      if (from && to) return yield* snapshot.diffFull(from, to)
      return []
    })

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: SessionV1.WithParts[] }) {
      return yield* diffRange(input.messages.flatMap((item) => item.parts))
    })

    const userMessage = (input: { sessionID: SessionID; messageID: MessageID }) =>
      MessageV2.get(input).pipe(
        Effect.provideService(Database.Service, database),
        Effect.map((message) => (message.info.role === "user" ? message.info : undefined)),
        Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)),
      )

    // Reads only the step boundary parts of the turn's assistant messages instead of the whole session history.
    const turnStepParts = (user: SessionV1.User) =>
      database.db
        .select({ data: PartTable.data })
        .from(PartTable)
        .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
        .where(
          and(
            eq(MessageTable.session_id, user.sessionID),
            gte(MessageTable.time_created, user.time.created),
            sql`json_extract(${MessageTable.data}, '$.parentID') = ${user.id}`,
            sql`json_extract(${PartTable.data}, '$.type') in ('step-start', 'step-finish')`,
          ),
        )
        .orderBy(asc(MessageTable.time_created), asc(MessageTable.id), asc(PartTable.id))
        .all()
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.data as V1StepPart)),
        )

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: 0,
          deletions: 0,
          files: 0,
        },
      })
      yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: [] })
      if ((yield* config.get()).snapshot === false) return
      const target = yield* userMessage(input)
      if (!target) return
      const diffs = yield* diffRange(yield* turnStepParts(target))
      const previous = yield* storage.read<Snapshot.FileDiff[]>(diffKey(input)).pipe(
        Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(target.summary?.diffs ?? [])),
        Effect.orDie,
      )
      yield* writeDiff({ storage, ...input, diffs })
      const stats = diffs.map((item) => ({
        file: item.file,
        additions: item.additions,
        deletions: item.deletions,
        status: item.status,
      }))
      if (
        JSON.stringify(previous) === JSON.stringify(diffs) &&
        JSON.stringify(target.summary?.diffs) === JSON.stringify(stats)
      )
        return
      yield* sessions.updateMessage({ ...target, summary: { ...target.summary, diffs: stats } })
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      if (!input.messageID) return []
      const message = yield* userMessage({ sessionID: input.sessionID, messageID: input.messageID })
      if (!message) return []
      const diffs = yield* storage
        .read<Snapshot.FileDiff[]>(diffKey({ sessionID: input.sessionID, messageID: input.messageID }))
        .pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(message.summary?.diffs ?? [])),
          Effect.orDie,
        )
      return diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

type V1StepPart = Pick<SessionV1.StepStartPart | SessionV1.StepFinishPart, "type" | "snapshot">

function diffKey(input: { sessionID: SessionID; messageID: MessageID }) {
  return ["message_diff", input.sessionID, input.messageID]
}

// Full patches can be megabytes, so message events carry only per-file stats.
// Propagate storage failures so those stats never point at missing patches.
export const writeDiff = Effect.fnUntraced(function* (input: {
  storage: Storage.Interface
  sessionID: SessionID
  messageID: MessageID
  diffs: Snapshot.FileDiff[]
}) {
  yield* input.storage.write(diffKey(input), input.diffs).pipe(Effect.orDie)
})

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, Snapshot.node, EventV2Bridge.node, Config.node, Storage.node, Database.node],
})

export * as SessionSummary from "./summary"
