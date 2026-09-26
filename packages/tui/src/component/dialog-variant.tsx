import { createMemo } from "solid-js"
import { useLocal, type StackRef } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

export function DialogVariant(props: { model?: StackRef }) {
  const local = useLocal()
  const dialog = useDialog()
  const target = () => props.model

  function list() {
    const m = target()
    return m ? local.model.variant.listFor(m) : local.model.variant.list()
  }

  function selected() {
    const m = target()
    return m ? local.model.variant.selectedFor(m) : local.model.variant.selected()
  }

  function set(value: string | undefined) {
    const m = target()
    if (m) local.model.variant.setFor(m, value)
    else local.model.variant.set(value)
  }

  const options = createMemo(() => {
    return [
      {
        value: "default",
        title: "Default",
        onSelect: () => {
          dialog.clear()
          set(undefined)
        },
      },
      ...list().map((variant) => ({
        value: variant,
        title: variant,
        onSelect: () => {
          dialog.clear()
          set(variant)
        },
      })),
    ]
  })

  const title = createMemo(() => {
    const m = target()
    if (!m) return "Select variant"
    const id = m.modelID.split("/").pop() ?? m.modelID
    return `Select variant · ${id}`
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={title()}
      current={selected()}
      flat={true}
    />
  )
}
