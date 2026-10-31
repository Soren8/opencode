import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { diffs, message } from "./diffs"

const item = {
  file: "src/app.ts",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  status: "modified",
} satisfies FileDiffInfo & SnapshotFileDiff

describe("diffs", () => {
  test("keeps valid arrays", () => {
    expect(diffs([item])).toEqual([item])
  })

  test("wraps a single diff object", () => {
    expect(diffs(item)).toEqual([item])
  })

  test("reads keyed diff objects", () => {
    expect(diffs({ a: item })).toEqual([item])
  })

  test("keeps stats-only diffs without patches for lazy loading", () => {
    const stats = { file: "src/stats.ts", additions: 1, deletions: 1 }
    expect(diffs([stats])).toEqual([stats])
    expect(diffs(stats)).toEqual([stats])
    expect(diffs({ a: stats })).toEqual([stats])
  })

  test("drops invalid entries", () => {
    expect(
      diffs([
        item,
        { file: "src/bad.ts", additions: "1", deletions: 1, patch: item.patch },
        { patch: item.patch, additions: 1, deletions: 1 },
        { file: "src/bad-patch.ts", additions: 1, deletions: 1, patch: 42 },
        { file: "src/bad-status.ts", additions: 1, deletions: 1, status: "renamed" },
      ]),
    ).toEqual([item])
  })
})

describe("message", () => {
  test("normalizes user summaries with object diffs", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: {
        title: "Edit",
        diffs: { a: item },
      },
    } as unknown as Message

    expect(message(input)).toMatchObject({
      summary: {
        title: "Edit",
        diffs: [item],
      },
    })
  })

  test("drops invalid user summaries", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: true,
    } as unknown as Message

    expect(message(input)).toMatchObject({ summary: undefined })
  })
})
