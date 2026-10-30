import { GlobalBus, type GlobalEvent } from "@/bus/global"

// Durable events reach GlobalBus twice: once as the domain event and once as a
// "sync" replica for remote workspace replication over SSE. The local TUI never
// reads replicas, so skip them instead of cloning every durable event twice.
export function forwardGlobalEvents(emit: (event: GlobalEvent) => void) {
  const handler = (event: GlobalEvent) => {
    if (event.payload?.type === "sync") return
    emit(event)
  }
  GlobalBus.on("event", handler)
  return () => {
    GlobalBus.off("event", handler)
  }
}
