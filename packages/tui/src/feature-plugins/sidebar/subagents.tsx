import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-subagents"

type Row = {
  id: string
  title: string
  agent?: string
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [open, setOpen] = createSignal(true)

  const current = createMemo(() => props.api.state.session.get(props.session_id))
  const rootID = createMemo(() => current()?.parentID ?? current()?.id)

  const active = createMemo<Row[]>(() => {
    const root = rootID()
    if (!root) return []
    return props.api.state
      .session.list()
      .filter((item) => item.parentID === root && item.id !== props.session_id && !item.time?.archived)
      .filter((item) => {
        const status = props.api.state.session.status(item.id)
        return status?.type === "busy" || status?.type === "retry"
      })
      .map((item) => {
        const title = item.title?.trim() ? item.title : item.agent || "Subagent"
        return { id: item.id, title, agent: item.agent }
      })
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })

  return (
    <Show when={active().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => active().length > 2 && setOpen((x) => !x)}>
          <Show when={active().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Subagents</b>
            <span style={{ fg: theme().textMuted }}> ({active().length})</span>
          </text>
        </box>
        <Show when={active().length <= 2 || open()}>
          <For each={active()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme().text} wrapMode="word">
                  {item.title}
                </text>
                <Show when={item.agent && item.agent !== item.title}>
                  <text fg={theme().textMuted}>{item.agent}</text>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
