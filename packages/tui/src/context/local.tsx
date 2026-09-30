import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { batch, createEffect, createMemo } from "solid-js"
import { useSync } from "./sync"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import { useTheme } from "./theme"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { usePermission } from "./permission"

export type LocalTheme = {
  secondary: RGBA
  accent: RGBA
  success: RGBA
  warning: RGBA
  primary: RGBA
  error: RGBA
  info: RGBA
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}

export function recentModels(
  model: { providerID: string; modelID: string },
  recent: { providerID: string; modelID: string }[],
) {
  const seen = new Set<string>()
  return [model, ...recent]
    .filter((item) => {
      const key = `${item.providerID}/${item.modelID}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export type StackLayer = "main" | "sub" | "plan"

export type StackRef = {
  providerID: string
  modelID: string
}

export type StackSelection = {
  name?: string
  main?: StackRef
  sub?: StackRef
  plan?: StackRef
}

function parseStackRef(value: unknown): StackRef | undefined {
  if (typeof value !== "string") return undefined
  const { providerID, modelID } = parseModel(value)
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

export function stackRoleForAgent(agent: { name: string; mode: string }): StackLayer {
  if (agent.name === "plan") return "plan"
  if (agent.mode === "subagent") return "sub"
  return "main"
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()
    const theme = useTheme().theme
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const provider = sync.data.provider.find((item) => item.id === model.providerID)
      return !!provider?.models[model.modelID]
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    function createAgent() {
      const agents = createMemo(() => sync.data.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden))
      const visibleAgents = createMemo(() => sync.data.agent.filter((agent) => !agent.hidden))
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
      })
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
        theme.info,
      ])
      return {
        list() {
          return agents()
        },
        current() {
          return agents().find((x) => x.name === agentStore.current) ?? agents().at(0)
        },
        set(name: string) {
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((x) => x.name === current.name) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const index = visibleAgents().findIndex((x) => x.name === name)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) {
            const color = agent.color
            if (color.startsWith("#")) return RGBA.fromHex(color)
            // already validated by config, just satisfying TS here
            return theme[color as keyof typeof theme] as RGBA
          }
          return colors()[index % colors().length]
        },
      }
    }

    const agent = createAgent()

    function createStack() {
      const [stackStore, setStackStore] = createStore<{
        ready: boolean
        touched: boolean
        name?: string
        main?: StackRef
        sub?: StackRef
        plan?: StackRef
      }>({
        ready: false,
        touched: false,
      })
      const filePath = path.join(paths.state, "stack.json")
      const state = {
        pending: false,
      }

      function selection(): StackSelection {
        return {
          ...(stackStore.name ? { name: stackStore.name } : {}),
          ...(stackStore.main ? { main: { ...stackStore.main } } : {}),
          ...(stackStore.sub ? { sub: { ...stackStore.sub } } : {}),
          ...(stackStore.plan ? { plan: { ...stackStore.plan } } : {}),
        }
      }

      function save() {
        if (!stackStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, selection())
      }

      function validRef(value: unknown): StackRef | undefined {
        if (!value || typeof value !== "object") return undefined
        const ref = value as Partial<StackRef>
        if (typeof ref.providerID !== "string" || typeof ref.modelID !== "string") return undefined
        const model = { providerID: ref.providerID, modelID: ref.modelID }
        return isModelValid(model) ? model : undefined
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const value = x as Record<string, unknown>
          batch(() => {
            if (typeof value.name === "string") setStackStore("name", value.name)
            const main = validRef(value.main)
            if (main) setStackStore("main", main)
            const sub = validRef(value.sub)
            if (sub) setStackStore("sub", sub)
            const plan = validRef(value.plan)
            if (plan) setStackStore("plan", plan)
            if (value.name || main || sub || plan) setStackStore("touched", true)
          })
        })
        .catch(() => {})
        .finally(() => {
          setStackStore("ready", true)
          if (state.pending) save()
        })

      const definitions = createMemo(() => {
        const raw = sync.data.config.stack
        const stacks: Record<string, StackSelection> = {}
        if (raw && typeof raw === "object") {
          for (const [name, entry] of Object.entries(raw)) {
            if (!entry || typeof entry !== "object") continue
            const main = parseStackRef(entry.main)
            if (!main || !isModelValid(main)) continue
            const sub = parseStackRef(entry.sub)
            const plan = parseStackRef(entry.plan)
            stacks[name] = {
              name,
              main,
              sub: sub && isModelValid(sub) ? sub : main,
              plan: plan && isModelValid(plan) ? plan : main,
            }
          }
        }
        return stacks
      })

      const defaultName = createMemo(() => {
        const name = sync.data.config.default_stack
        if (typeof name !== "string") return undefined
        return definitions()[name] ? name : undefined
      })

      // Adopt the configured default stack until the user picks or tweaks.
      // Runs again when config arrives after boot.
      createEffect(() => {
        if (!stackStore.ready || stackStore.touched) return
        const def = definitions()[defaultName() ?? ""]
        if (!def) return
        batch(() => {
          setStackStore("name", def.name)
          if (def.main) setStackStore("main", { ...def.main })
          if (def.sub) setStackStore("sub", { ...def.sub })
          if (def.plan) setStackStore("plan", { ...def.plan })
          save()
        })
      })

      function role(agent: { name: string; mode: string }): StackLayer {
        return stackRoleForAgent(agent)
      }

      return {
        get ready() {
          return stackStore.ready
        },
        selection,
        definitions,
        defaultName,
        name() {
          return stackStore.name
        },
        layerFor(agent: { name: string; mode: string } | undefined): StackRef | undefined {
          if (!agent) return undefined
          const layer = role(agent)
          const ref = stackStore[layer]
          if (!ref) return undefined
          return isModelValid(ref) ? { ...ref } : undefined
        },
        apply(name: string) {
          const def = definitions()[name]
          if (!def?.main) {
            toast.show({ variant: "warning", message: `Stack not found: ${name}`, duration: 3000 })
            return false
          }
          batch(() => {
            setStackStore("touched", true)
            setStackStore("name", name)
            setStackStore("main", def.main ? { ...def.main } : undefined)
            setStackStore("sub", def.sub ? { ...def.sub } : undefined)
            setStackStore("plan", def.plan ? { ...def.plan } : undefined)
            save()
          })
          toast.show({ variant: "success", message: `Stack ${name}`, duration: 2000 })
          return true
        },
        setLayer(layer: StackLayer, model: StackRef) {
          if (!isModelValid(model)) {
            toast.show({
              message: `Model ${model.providerID}/${model.modelID} is not valid`,
              variant: "warning",
              duration: 3000,
            })
            return false
          }
          batch(() => {
            setStackStore("touched", true)
            setStackStore("name", undefined)
            setStackStore(layer, { ...model })
            save()
          })
          return true
        },
        // Best-effort sync so server-side subagents follow the stack.
        // Primary prompts already carry their model explicitly.
        async push(sessionID: string) {
          const sel = selection()
          if (!sel.name && !sel.main && !sel.sub && !sel.plan) return
          try {
            const current = sync.session.get(sessionID)
            const metadata = { ...((current?.metadata ?? {}) as Record<string, unknown>) }
            const subVariant = sel.sub ? model.variant.currentFor(sel.sub, "sub") : undefined
            const planVariant = sel.plan ? model.variant.currentFor(sel.plan, "plan") : undefined
            metadata.stack = {
              ...(sel.name ? { name: sel.name } : {}),
              ...(sel.main ? { main: `${sel.main.providerID}/${sel.main.modelID}` } : {}),
              ...(sel.sub ? { sub: `${sel.sub.providerID}/${sel.sub.modelID}` } : {}),
              ...(sel.plan ? { plan: `${sel.plan.providerID}/${sel.plan.modelID}` } : {}),
              ...(subVariant ? { sub_variant: subVariant } : {}),
              ...(planVariant ? { plan_variant: planVariant } : {}),
            }
            await sdk.client.session.update({ sessionID, metadata }).catch(() => {})
          } catch {}
        },
      }
    }

    const stack = createStack()

    function createModel() {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        model: Record<
          string,
          {
            providerID: string
            modelID: string
          }
        >
        recent: {
          providerID: string
          modelID: string
        }[]
        favorite: {
          providerID: string
          modelID: string
        }[]
        variant: Record<string, string | undefined>
        variantByLayer: Record<StackLayer, Record<string, string | undefined>>
      }>({
        ready: false,
        model: {},
        recent: [],
        favorite: [],
        variant: {},
        variantByLayer: { main: {}, sub: {}, plan: {} },
      })

      const filePath = path.join(paths.state, "model.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: modelStore.variant,
          variantByLayer: modelStore.variantByLayer,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const value = x as Record<string, unknown>
          if (Array.isArray(value.recent)) setModelStore("recent", value.recent)
          if (Array.isArray(value.favorite)) setModelStore("favorite", value.favorite)
          if (typeof value.variant === "object" && value.variant !== null)
            setModelStore("variant", value.variant as Record<string, string | undefined>)
          if (value.variantByLayer && typeof value.variantByLayer === "object") {
            const layers = value.variantByLayer as Record<string, unknown>
            for (const layer of ["main", "sub", "plan"] as const) {
              const entries = layers[layer]
              if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue
              setModelStore(
                "variantByLayer",
                layer,
                Object.fromEntries(Object.entries(entries).filter(([, choice]) => typeof choice === "string")),
              )
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parseModel(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        if (sync.data.config.model) {
          const { providerID, modelID } = parseModel(sync.data.config.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of modelStore.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const provider = sync.data.provider[0]
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const firstModel = Object.values(provider.models)[0]
        const model = defaultModel ?? firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
      })

      const currentModel = createMemo(() => {
        const a = agent.current()
        return (
          getFirstValidModel(
            () => a && modelStore.model[a.name],
            () => a && a.model,
            () => a && stack.layerFor(a),
            fallbackModel,
          ) ?? undefined
        )
      })

      return {
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = sync.data.provider.find((item) => item.id === value.providerID)
          const info = provider?.models[value.modelID]
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? value.modelID,
            reasoning: info?.capabilities?.reasoning ?? false,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = modelStore.recent
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          if (index === -1) return
          let next = index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          const a = agent.current()
          if (!a) return
          setModelStore("model", a.name, { ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          const a = agent.current()
          if (!a) return
          setModelStore("model", a.name, { ...next })
          setModelStore("recent", recentModels(next, modelStore.recent))
          save()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const a = agent.current()
            if (!a) return
            setModelStore("model", a.name, model)
            if (options?.recent) {
              setModelStore("recent", recentModels(model, modelStore.recent))
              save()
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const exists = modelStore.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? modelStore.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...modelStore.favorite]
            setModelStore(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            save()
          })
        },
        variant: {
          selected() {
            const m = currentModel()
            if (!m) return undefined
            const a = agent.current()
            if (!a) return undefined
            return this.selectedFor(m, stackRoleForAgent(a))
          },
          current() {
            const m = currentModel()
            if (!m) return undefined
            const a = agent.current()
            if (!a) return undefined
            return this.currentFor(m, stackRoleForAgent(a))
          },
          list() {
            const m = currentModel()
            if (!m) return []
            return this.listFor(m)
          },
          set(value: string | undefined) {
            const m = currentModel()
            if (!m) return
            const a = agent.current()
            if (!a) return
            this.setFor(m, value, stackRoleForAgent(a))
          },
          cycle() {
            const m = currentModel()
            if (!m) return
            const a = agent.current()
            if (!a) return
            const layer = stackRoleForAgent(a)
            const variants = this.listFor(m)
            if (variants.length === 0) return
            const current = this.currentFor(m, layer)
            if (!current) {
              this.setFor(m, variants[0], layer)
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.setFor(m, undefined, layer)
              return
            }
            this.setFor(m, variants[index + 1], layer)
          },
          selectedFor(model: { providerID: string; modelID: string }, layer: StackLayer) {
            const key = `${model.providerID}/${model.modelID}`
            return modelStore.variantByLayer[layer][key] ?? modelStore.variant[key]
          },
          currentFor(model: { providerID: string; modelID: string }, layer: StackLayer) {
            const v = this.selectedFor(model, layer)
            if (!v) return undefined
            if (!this.listFor(model).includes(v)) return undefined
            return v
          },
          listFor(model: { providerID: string; modelID: string }) {
            const provider = sync.data.provider.find((item) => item.id === model.providerID)
            const info = provider?.models[model.modelID]
            if (!info?.variants) return []
            return Object.keys(info.variants)
          },
          setFor(model: { providerID: string; modelID: string }, value: string | undefined, layer: StackLayer) {
            setModelStore("variantByLayer", layer, `${model.providerID}/${model.modelID}`, value ?? "default")
            save()
          },
        },
      }
    }

    const model = createModel()

    function createSession() {
      const [sessionStore, setSessionStore] = createStore<{
        ready: boolean
        pinned: string[]
      }>({
        ready: false,
        pinned: [],
      })

      const filePath = path.join(paths.state, "session.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          pinned: sessionStore.pinned,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const pinned = (x as Record<string, unknown>).pinned
          if (Array.isArray(pinned))
            setSessionStore(
              "pinned",
              pinned.filter((item): item is string => typeof item === "string"),
            )
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const slots = createMemo(() => {
        const existing = new Set(sync.data.session.filter((x) => x.parentID === undefined).map((x) => x.id))
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      function prune(sessionID: string) {
        batch(() => {
          if (sessionStore.pinned.includes(sessionID)) {
            setSessionStore(
              "pinned",
              sessionStore.pinned.filter((x) => x !== sessionID),
            )
          }
          save()
        })
      }

      event.on("session.deleted", (evt) => {
        prune(evt.properties.info.id)
      })

      return {
        get ready() {
          return sessionStore.ready
        },
        pinned() {
          return sessionStore.pinned
        },
        slots,
        isPinned(sessionID: string) {
          return sessionStore.pinned.includes(sessionID)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    }

    const session = createSession()

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    createEffect(() => {
      const value = agent.current()
      if (!value?.model) return
      if (isModelValid(value.model)) return
      toast.show({
        variant: "warning",
        message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
        duration: 3000,
      })
    })

    const result = {
      model,
      agent,
      stack,
      mcp,
      session,
      permission,
    }
    return result
  },
})
