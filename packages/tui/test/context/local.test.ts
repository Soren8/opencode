import { expect, test } from "bun:test"
import { parseModel, recentModels, stackRoleForAgent } from "../../src/context/local"

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
})

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

test("maps agents to stack layers", () => {
  expect(stackRoleForAgent({ name: "plan", mode: "primary" })).toBe("plan")
  expect(stackRoleForAgent({ name: "general", mode: "subagent" })).toBe("sub")
  expect(stackRoleForAgent({ name: "explore", mode: "subagent" })).toBe("sub")
  expect(stackRoleForAgent({ name: "build", mode: "primary" })).toBe("main")
  expect(stackRoleForAgent({ name: "custom", mode: "all" })).toBe("main")
})
