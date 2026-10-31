export function sessionTurnDiffViewState(input: { embedded: boolean; loading: boolean; error: boolean }) {
  if (input.embedded) return "diff"
  if (input.error) return "error"
  if (input.loading) return "loading"
  return "diff"
}
