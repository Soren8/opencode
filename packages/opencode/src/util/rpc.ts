type Definition = {
  [method: string]: (input: any) => any
}

// Requests and results are plain data (fetch bodies are strings), so they cross
// the worker boundary by structured clone instead of a JSON envelope; that avoids
// re-escaping multi-MB response bodies. Event data stays JSON-encoded because it
// can carry schema class instances and dates whose wire shape is their toJSON form.
export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const message = evt.data
    if (message.type === "rpc.request") {
      const result = await rpc[message.method](message.input)
      postMessage({ type: "rpc.result", result, id: message.id })
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage({ type: "rpc.event", event, data: JSON.stringify(data) })
}

export function client<T extends Definition>(target: {
  postMessage: (data: unknown) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, (result: any) => void>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  target.onmessage = async (evt) => {
    const message = evt.data
    if (message.type === "rpc.result") {
      const resolve = pending.get(message.id)
      if (resolve) {
        resolve(message.result)
        pending.delete(message.id)
      }
    }
    if (message.type === "rpc.event") {
      const handlers = listeners.get(message.event)
      if (handlers) {
        const data = JSON.parse(message.data)
        for (const handler of handlers) {
          handler(data)
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve) => {
        pending.set(requestId, resolve)
        target.postMessage({ type: "rpc.request", method, input, id: requestId })
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
