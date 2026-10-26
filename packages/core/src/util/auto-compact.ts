export function parseAutoCompactTokens(value: string): number | null {
  const trimmed = value.trim().toLowerCase()
  const match = trimmed.match(/^(\d+)([km]?)$/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const suffix = match[2]
  const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1_000_000 : 1
  const result = amount * multiplier
  if (!Number.isFinite(result) || result <= 0) return null
  return result
}
