import { parseAutoCompactTokens } from "@opencode-ai/core/util/auto-compact"

export async function runAutoCompact(input: {
  sdk: any
  sync: any
  toast: { show: (options: any) => void }
  arg: string
}) {
  const { sdk, sync, toast, arg } = input
  const trimmed = arg.trim()
  const current = sync.data.config?.compaction?.auto_compact_tokens

  if (trimmed === "") {
    toast.show({
      title: "Auto-compact",
      message: current
        ? `Current auto-compact limit: ${current} tokens`
        : "Current auto-compact limit: 190000 tokens (default)",
      variant: "info",
    })
    return
  }

  if (trimmed.toLowerCase() === "default") {
    try {
      await sdk.client.global.config.update({
        config: { compaction: { auto_compact_tokens: 190000 } },
      })
      toast.show({
        title: "Auto-compact",
        message: "Auto-compact limit reset to default (190000 tokens)",
        variant: "success",
      })
    } catch (err) {
      toast.show({
        title: "Auto-compact",
        message: err instanceof Error ? err.message : "Failed to update auto-compact limit",
        variant: "error",
      })
    }
    return
  }

  const parsed = parseAutoCompactTokens(trimmed)
  if (parsed === null) {
    toast.show({
      title: "Auto-compact",
      message: "Invalid token limit. Use a positive integer like 150000, 200k, or 1m.",
      variant: "error",
    })
    return
  }

  try {
    await sdk.client.global.config.update({
      config: { compaction: { auto_compact_tokens: parsed } },
    })
    toast.show({
      title: "Auto-compact",
      message: `Auto-compact limit set to ${parsed} tokens`,
      variant: "success",
    })
  } catch (err) {
    toast.show({
      title: "Auto-compact",
      message: err instanceof Error ? err.message : "Failed to update auto-compact limit",
      variant: "error",
    })
  }
}
