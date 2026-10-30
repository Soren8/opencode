import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Schema } from "effect"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { forwardGlobalEvents } from "../../../src/cli/tui/forward"
import type { GlobalEvent } from "../../../src/bus/global"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([EventV2Bridge.node])))

const Durable = EventV2.define({
  type: "test.tui.forward",
  durable: { version: 1, aggregate: "id" },
  schema: { id: Schema.String, text: Schema.String },
})

it.instance("forwards one event per durable publish and skips the sync replica", () =>
  Effect.gen(function* () {
    const forwarded: GlobalEvent[] = []
    const stop = forwardGlobalEvents((event) => forwarded.push(event))
    yield* Effect.addFinalizer(() => Effect.sync(stop))
    const events = yield* EventV2Bridge.Service

    yield* events.publish(Durable, { id: "agg_forward", text: "hello" })

    expect(forwarded.map((event) => event.payload.type)).toEqual(["test.tui.forward"])
  }),
)
