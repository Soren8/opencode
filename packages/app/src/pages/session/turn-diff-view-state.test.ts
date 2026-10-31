import { expect, test } from "bun:test"
import { sessionTurnDiffViewState } from "./turn-diff-view-state"

test("prefers embedded patches over lazy request loading and errors", () => {
  expect(sessionTurnDiffViewState({ embedded: true, loading: true, error: false })).toBe("diff")
  expect(sessionTurnDiffViewState({ embedded: true, loading: false, error: true })).toBe("diff")
})

test("shows request loading and error states only when a patch is not embedded", () => {
  expect(sessionTurnDiffViewState({ embedded: false, loading: true, error: false })).toBe("loading")
  expect(sessionTurnDiffViewState({ embedded: false, loading: false, error: true })).toBe("error")
  expect(sessionTurnDiffViewState({ embedded: false, loading: false, error: false })).toBe("diff")
})
