import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import * as fuzzysort from "fuzzysort"

function shortRef(ref: { providerID: string; modelID: string } | undefined) {
  if (!ref) return "—"
  const id = ref.modelID.split("/").pop() ?? ref.modelID
  return `${id} · ${ref.providerID}`
}

export function DialogStack() {
  const local = useLocal()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const options = createMemo(() => {
    const defs = local.stack.definitions()
    const current = local.stack.name()
    const fallback = local.stack.defaultName()
    const list = Object.entries(defs).map(([name, def]) => ({
      value: name,
      title: name,
      description: `main ${shortRef(def.main)} · sub ${shortRef(def.sub)} · plan ${shortRef(def.plan)}`,
      footer: name === current ? "current" : name === fallback ? "default" : undefined,
      category: "Stacks",
      onSelect() {
        if (local.stack.apply(name)) dialog.clear()
      },
    }))
    list.sort((a, b) => a.title.localeCompare(b.title))
    const needle = query().trim()
    if (!needle) return list
    return fuzzysort.go(needle, list, { keys: ["title"] }).map((x) => x.obj)
  })

  return (
    <DialogSelect<string>
      options={options()}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title="Select stack"
      current={local.stack.name()}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column">
          <text>No stacks configured yet.</text>
          <text>Add a `stack` map to opencode.json:</text>
          <text>{`{"stack": {"daily": {`}</text>
          <text>{`  "main": "p/model", "sub": "p/cheap"}}}`}</text>
        </box>
      }
    />
  )
}
