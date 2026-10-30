import { expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

test("rpc results cross the worker boundary without a JSON envelope and events keep JSON semantics", async () => {
  const worker = new Worker(new URL("../fixture/rpc/worker.ts", import.meta.url).href)
  const raw: unknown[] = []
  worker.addEventListener("message", (evt) => raw.push(evt.data))
  const client = Rpc.client<{ echo: (input: { body: string }) => { status: number; body: string } }>(worker)
  const stamps: unknown[] = []
  client.on("stamp", (data) => stamps.push(data))
  const body = "x".repeat(1_000_000)

  const result = await client.call("echo", { body })
  worker.terminate()

  expect(result).toEqual({ status: 200, body })
  expect(stamps).toEqual([{ at: new Date(0).toISOString(), body: body.length }])
  expect(raw.find((data) => typeof data === "object" && data !== null && Reflect.get(data, "type") === "rpc.result")).toBeDefined()
})
