import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  directory,
  projectID,
  setupTimeline,
  status,
  toolPart,
  userMessage,
  userText,
  type PartSeed,
} from "../performance/timeline-stability/fixture"

test.describe("session timeline projection", () => {
  test("renders every admitted tool family and hides timeline-only exclusions", async ({ page }) => {
    const parts = [
      toolPart("prt_01_read", "read", "completed", { filePath: "src/a.ts" }),
      toolPart("prt_02_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
      toolPart("prt_03_grep", "grep", "completed", { path: ".", pattern: "value" }),
      toolPart("prt_04_list", "list", "completed", { path: "src" }),
      toolPart("prt_webfetch", "webfetch", "completed", { url: "https://example.com" }),
      toolPart(
        "prt_websearch",
        "websearch",
        "completed",
        { query: "timeline stability" },
        { output: "https://example.com/result" },
      ),
      toolPart("prt_task", "task", "completed", { description: "Inspect timeline", subagent_type: "explore" }),
      toolPart(
        "prt_bash",
        "bash",
        "completed",
        { command: "printf stable" },
        { output: "stable", title: "printf stable" },
      ),
      editPart("prt_edit"),
      toolPart("prt_write", "write", "completed", { filePath: "src/new.ts", content: "export const stable = true\n" }),
      patchPart("prt_patch"),
      toolPart("prt_todo", "todowrite", "completed", { todos: [{ content: "Hidden", status: "pending" }] }),
      toolPart(
        "prt_question",
        "question",
        "completed",
        { questions: [{ question: "Keep stable?", header: "Stability", options: [] }] },
        { metadata: { answers: [["Yes"]] } },
      ),
      toolPart("prt_skill", "skill", "completed", { name: "stability" }),
      toolPart("prt_custom", "custom_mcp_tool", "completed", { target: "timeline", count: 2 }),
    ]
    await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

    await expect(
      page.locator('[data-timeline-part-ids="prt_01_read,prt_02_glob,prt_03_grep,prt_04_list"]'),
    ).toBeVisible()
    for (const id of [
      "prt_webfetch",
      "prt_websearch",
      "prt_task",
      "prt_bash",
      "prt_edit",
      "prt_write",
      "prt_patch",
      "prt_question",
      "prt_skill",
      "prt_custom",
    ]) {
      await expect(page.locator(`[data-timeline-part-id="${id}"]`).first(), id).toBeVisible()
    }
    await expect(page.locator('[data-timeline-part-id="prt_todo"]')).toHaveCount(0)
  })

  test("projects gaps, dividers, assistant parts, and errors together", async ({ page }) => {
    const firstUser = userMessage(
      [
        userText("The user made the following comment regarding lines 4 through 8 of src/a.ts: Keep this stable", {
          id: "prt_comment",
          synthetic: true,
          metadata: {
            opencodeComment: {
              path: "src/a.ts",
              selection: { startLine: 4, startChar: 0, endLine: 8, endChar: 0 },
              comment: "Keep this stable",
            },
          },
        }),
        userText("Continue after the comment", { id: "prt_visible_user" }),
      ],
      { summary: { diffs: Array.from({ length: 11 }, (_, index) => summaryDiff(index)) } },
    )
    const aborted = assistantMessage(
      [
        { id: "prt_before_abort", type: "text", text: "Before interruption" },
        { id: "prt_compaction", type: "compaction", auto: true },
      ],
      {
        id: "msg_1001_assistant_aborted",
        error: { name: "MessageAbortedError", data: { message: "Stopped" } },
      },
    )
    const failed = assistantMessage([{ id: "prt_after_abort", type: "text", text: "After interruption" }], {
      id: "msg_1002_assistant_failed",
      error: {
        name: "APIError",
        data: {
          message: JSON.stringify({ error: { type: "provider_error", message: "Visible provider failure" } }),
          isRetryable: false,
        },
      },
      created: 1700000003000,
    })
    const nextUser = userMessage([userText("Second turn", { id: "prt_second_user" })], {
      id: "msg_2000_second_user",
      created: 1700000005000,
    })
    const nextAssistant = assistantMessage([{ id: "prt_second_text", type: "text", text: "Second response" }], {
      id: "msg_2001_second_assistant",
      parentID: "msg_2000_second_user",
      created: 1700000006000,
    })
    const timeline = await setupTimeline(page, { messages: [firstUser, aborted, failed, nextUser, nextAssistant] })
    await timeline.send(status("idle"), 100)
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => (element.scrollTop = 0))

    await expect(page.locator('[data-timeline-row="TurnDivider"]')).toHaveCount(1)
    await expect(page.getByText("Session compacted", { exact: true })).toBeVisible()
    await expect(page.getByText("Visible provider failure")).toBeVisible()
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect(page.locator('[data-timeline-row="TurnGap"]')).toBeVisible()
  })

  test("renders inline comments and historical diff summary overflow", async ({ page }) => {
    const user = userMessage(
      [
        userText("The user made the following comment regarding lines 4 through 8 of src/a.ts: Keep this stable", {
          id: "prt_comment_only",
          synthetic: true,
          metadata: {
            opencodeComment: {
              path: "src/a.ts",
              selection: { startLine: 4, startChar: 0, endLine: 8, endChar: 0 },
              comment: "Keep this stable",
            },
          },
        }),
        userText("Continue after the comment", { id: "prt_comment_visible" }),
      ],
      { summary: { diffs: Array.from({ length: 11 }, (_, index) => summaryDiff(index)) } },
    )
    const nextUser = userMessage(undefined, { id: "msg_2000_diff_next_user", created: 1700000010000 })
    const nextAssistant = assistantMessage([], {
      id: "msg_2001_diff_next_assistant",
      parentID: "msg_2000_diff_next_user",
      created: 1700000011000,
    })
    await setupTimeline(page, { messages: [user, assistantMessage(), nextUser, nextAssistant] })
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    await scroller.evaluate((element) => (element.scrollTop = 0))

    await expect(page.getByText("Keep this stable", { exact: true })).toBeVisible()
    await expect(page.locator('[data-timeline-row="DiffSummary"]')).toBeVisible()
    await expect(page.getByText(/show all/i)).toBeVisible()
  })

  test("loads stats-only turn patches on expansion and reuses the message diff query", async ({ page }) => {
    const files = ["src/first.ts", "src/second.ts"]
    const user = userMessage(undefined, {
      summary: { diffs: files.map((file) => ({ file, additions: 1, deletions: 1 })) },
    })
    await setupTimeline(page, { messages: [user, assistantMessage()] })

    let requests = 0
    await page.route(/(?:\/api)?\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => {
      requests += 1
      const diffs = files.map((file) => ({
        file,
        additions: 1,
        deletions: 1,
        status: "modified",
        patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before-${file}\n+after-${file}\n`,
      }))
      const url = new URL(route.request().url())
      const body = url.pathname.startsWith("/api/")
        ? { location: { directory, project: { id: projectID, directory } }, data: diffs }
        : diffs
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    })

    const summary = page.locator('[data-timeline-row="DiffSummary"]')
    await expect(summary).toBeVisible()
    expect(requests).toBe(0)

    const first = summary.getByRole("button", { name: /first\.ts/ })
    const firstResponse = page.waitForResponse((response) => /\/session\/[^/]+\/diff(?:\?.*)?$/.test(response.url()))
    await first.click()
    expect((await firstResponse).ok()).toBe(true)
    await expect(summary.locator('[data-slot="session-turn-diff-view"]')).toContainText("after-src/first.ts")

    await summary.getByRole("button", { name: /second\.ts/ }).click()
    await expect(
      summary.locator('[data-slot="session-turn-diff-view"]', { hasText: "after-src/second.ts" }),
    ).toBeVisible()
    await expect(
      summary.locator('[data-slot="session-turn-diff-view"]', { hasText: "after-src/first.ts" }),
    ).toBeVisible()
    expect(requests).toBe(1)
  })

  test("keeps embedded legacy patches inline without fetching", async ({ page }) => {
    const user = userMessage(undefined, { summary: { diffs: [summaryDiff(0)] } })
    await setupTimeline(page, { messages: [user, assistantMessage()] })

    let requests = 0
    await page.route(/(?:\/api)?\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => {
      requests += 1
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    })

    const summary = page.locator('[data-timeline-row="DiffSummary"]')
    await summary.getByRole("button", { name: /diff-0\.ts/ }).click()
    await expect(summary.locator('[data-slot="session-turn-diff-view"]')).toContainText("export const value = 1")
    expect(requests).toBe(0)
  })

  test("renders an embedded legacy patch after another file's lazy diff request fails", async ({ page }) => {
    const user = userMessage(undefined, {
      summary: {
        diffs: [{ file: "src/stats-only.ts", additions: 1, deletions: 1 }, summaryDiff(0)],
      },
    })
    await setupTimeline(page, { messages: [user, assistantMessage()] })

    let requests = 0
    await page.route(/(?:\/api)?\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => {
      requests += 1
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "failed" }) })
    })

    const summary = page.locator('[data-timeline-row="DiffSummary"]')
    const response = page.waitForResponse((response) => /\/session\/[^/]+\/diff(?:\?.*)?$/.test(response.url()))
    await summary.getByRole("button", { name: /stats-only\.ts/ }).click()
    expect((await response).status()).toBe(500)
    await expect(summary.getByRole("alert")).toContainText(/failed|request failed/i)

    const requestsAfterFailure = requests
    await summary.getByRole("button", { name: /diff-0\.ts/ }).click()
    const embeddedView = summary
      .locator('[data-slot="session-turn-diff-view"]')
      .filter({ hasText: "export const value = 1" })
    await expect(embeddedView).toBeVisible()
    await expect(embeddedView.getByRole("alert")).toHaveCount(0)
    expect(requests).toBe(requestsAfterFailure)
  })

  test("loads each timeline turn's patch for its own message", async ({ page }) => {
    const firstID = "msg_1000_first_turn"
    const secondID = "msg_2000_second_turn"
    const firstUser = userMessage(undefined, {
      id: firstID,
      summary: { diffs: [{ file: "src/first-turn.ts", additions: 1, deletions: 1 }] },
    })
    const secondUser = userMessage(undefined, {
      id: secondID,
      created: 1700000004000,
      summary: { diffs: [{ file: "src/second-turn.ts", additions: 1, deletions: 1 }] },
    })
    await setupTimeline(page, {
      messages: [
        firstUser,
        assistantMessage([], { id: "msg_1001_first_turn_assistant", parentID: firstID, created: 1700000001000 }),
        secondUser,
        assistantMessage([], { id: "msg_2001_second_turn_assistant", parentID: secondID, created: 1700000005000 }),
      ],
    })

    let requests = 0
    await page.route(/(?:\/api)?\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => {
      requests += 1
      const url = new URL(route.request().url())
      const first = url.searchParams.get("messageID") === firstID
      const file = first ? "src/first-turn.ts" : "src/second-turn.ts"
      const name = first ? "first-turn" : "second-turn"
      const diff = {
        file,
        additions: 1,
        deletions: 1,
        status: "modified",
        patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before-${name}\n+after-${name}\n`,
      }
      const body = url.pathname.startsWith("/api/")
        ? { location: { directory, project: { id: projectID, directory } }, data: [diff] }
        : [diff]
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    })

    const firstSummary = page.locator(`[data-timeline-row="DiffSummary"][data-message-id="${firstID}"]`)
    const secondSummary = page.locator(`[data-timeline-row="DiffSummary"][data-message-id="${secondID}"]`)
    await firstSummary.getByRole("button", { name: /first-turn\.ts/ }).click()
    await expect(firstSummary.locator('[data-slot="session-turn-diff-view"]')).toContainText("after-first-turn")
    await secondSummary.getByRole("button", { name: /second-turn\.ts/ }).click()
    await expect(secondSummary.locator('[data-slot="session-turn-diff-view"]')).toContainText("after-second-turn")
    await expect(secondSummary.locator('[data-slot="session-turn-diff-view"]')).not.toContainText("after-first-turn")
    expect(requests).toBe(2)
  })

  test("shows and retries a failed expanded timeline diff", async ({ page }) => {
    const user = userMessage(undefined, {
      summary: { diffs: [{ file: "src/retry-timeline.ts", additions: 1, deletions: 1 }] },
    })
    await setupTimeline(page, { messages: [user, assistantMessage()] })

    let requests = 0
    let retry = false
    await page.route(/(?:\/api)?\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => {
      requests += 1
      if (!retry)
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "failed" }),
        })
      const diff = {
        file: "src/retry-timeline.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch:
          "diff --git a/src/retry-timeline.ts b/src/retry-timeline.ts\n--- a/src/retry-timeline.ts\n+++ b/src/retry-timeline.ts\n@@ -1 +1 @@\n-before\n+after-retry\n",
      }
      const url = new URL(route.request().url())
      const body = url.pathname.startsWith("/api/")
        ? { location: { directory, project: { id: projectID, directory } }, data: [diff] }
        : [diff]
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    })

    const summary = page.locator('[data-timeline-row="DiffSummary"]')
    await summary.getByRole("button", { name: /retry-timeline\.ts/ }).click()
    await expect(summary.getByText("Request failed", { exact: true })).toBeVisible()
    const previousRequests = requests
    retry = true
    const retried = page.waitForResponse((response) => /\/session\/[^/]+\/diff(?:\?.*)?$/.test(response.url()))
    await summary.getByRole("button", { name: "Refresh" }).click()
    expect((await retried).ok()).toBe(true)
    await expect(summary.locator('[data-slot="session-turn-diff-view"]')).toContainText("after-retry")
    expect(requests).toBe(previousRequests + 1)
  })

  test("shows a localized retry state when loading last-turn review diffs fails", async ({ page }) => {
    const user = userMessage(undefined, {
      summary: { diffs: [{ file: "src/retry.ts", additions: 1, deletions: 1 }] },
    })
    await setupTimeline(page, { messages: [user, assistantMessage()], settings: { newLayoutDesigns: true } })

    let requests = 0
    await page.route(/(?:\/api)?\/session\/[^/]+\/diff(?:\?.*)?$/, (route) => {
      requests += 1
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "failed" }) })
    })

    await page.getByRole("button", { name: "Toggle review" }).click()
    await page.getByRole("button", { name: "Git changes" }).click()
    await page.getByRole("option", { name: "Last turn changes" }).click()

    await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
    const retry = page.getByRole("button", { name: "Refresh" })
    await expect(retry).toBeVisible()
    const previousRequests = requests
    const retried = page.waitForResponse((response) => /\/session\/[^/]+\/diff(?:\?.*)?$/.test(response.url()))
    await retry.click()
    expect((await retried).status()).toBe(500)
    expect(requests).toBe(previousRequests + 1)
  })

  test("renders interruption independently when the turn is not compacted", async ({ page }) => {
    const user = userMessage()
    const before = assistantMessage([{ id: "prt_before", type: "text", text: "Before" }], {
      id: "msg_1001_before",
      error: { name: "MessageAbortedError", data: { message: "Stopped" } },
    })
    const after = assistantMessage([{ id: "prt_after", type: "text", text: "After" }], {
      id: "msg_1002_after",
      created: 1700000003000,
    })
    await setupTimeline(page, { messages: [user, before, after] })

    await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
    const rows = await page
      .locator('[data-timeline-row="AssistantPart"], [data-timeline-row="TurnDivider"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-row")))
    expect(rows).toEqual(["AssistantPart", "TurnDivider", "AssistantPart"])
  })

  test("renders user image, file attachment, file reference, and agent reference", async ({ page }) => {
    const text = "Use @explore with @src/a.ts and inspect the attachments"
    const parts: PartSeed<"user">[] = [
      userText(text, { id: "prt_user_rich" }),
      {
        id: "prt_user_image",
        type: "file",
        mime: "image/png",
        filename: "pixel.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      {
        id: "prt_user_attachment",
        type: "file",
        mime: "application/json",
        filename: "tsconfig.json",
        url: "data:application/json;base64,e30=",
      },
      {
        id: "prt_user_reference",
        type: "file",
        mime: "text/plain",
        filename: "a.ts",
        url: "src/a.ts",
        source: { type: "file", path: "src/a.ts", text: { value: "@src/a.ts", start: 18, end: 27 } },
      },
      {
        id: "prt_user_agent",
        type: "agent",
        name: "explore",
        source: { value: "@explore", start: 4, end: 12 },
      },
    ]
    await setupTimeline(page, { messages: [userMessage(parts), assistantMessage()] })

    await expect(page.getByAltText("pixel.png")).toBeVisible()
    await expect(page.getByText("tsconfig.json")).toBeVisible()
    await expect(page.getByText("@src/a.ts", { exact: true })).toBeVisible()
    await expect(page.getByText("@explore", { exact: true })).toBeVisible()
  })
})

function editPart(id: string) {
  return toolPart(
    id,
    "edit",
    "completed",
    { filePath: "src/a.ts" },
    {
      metadata: {
        filediff: {
          file: "src/a.ts",
          additions: 1,
          deletions: 1,
          before: "export const value = 1\n",
          after: "export const value = 2\n",
        },
      },
    },
  )
}

function patchPart(id: string) {
  return toolPart(
    id,
    "apply_patch",
    "completed",
    { files: ["src/a.ts", "src/b.ts"] },
    {
      metadata: {
        files: [
          patchFile("src/a.ts", "update"),
          patchFile("src/b.ts", "add"),
          patchFile("src/old.ts", "delete"),
          { ...patchFile("src/moved.ts", "move"), move: "src/new-place.ts" },
        ],
      },
    },
  )
}

function patchFile(filePath: string, type: "add" | "update" | "delete" | "move") {
  return {
    filePath,
    relativePath: filePath,
    type,
    additions: type === "delete" ? 0 : 1,
    deletions: type === "add" ? 0 : 1,
    before: type === "add" ? undefined : "export const before = true\n",
    after: type === "delete" ? undefined : "export const after = true\n",
  }
}

function summaryDiff(index: number) {
  return {
    file: `src/diff-${index}.ts`,
    additions: 1,
    deletions: 1,
    patch: `@@ -1 +1 @@\n-export const value = ${index}\n+export const value = ${index + 1}`,
  }
}
