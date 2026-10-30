import { Rpc } from "../../../src/util/rpc"

Rpc.listen({
  echo(input: { body: string }) {
    Rpc.emit("stamp", { at: new Date(0), body: input.body.length })
    return { status: 200, body: input.body }
  },
})
