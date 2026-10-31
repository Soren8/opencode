// CLI subprocess probe: records workspace paths visible in Bun's require.cache.
process.on("exit", () => {
  const modules = Object.keys(require.cache).filter(
    (item) => item.includes("/packages/") && !item.includes("/node_modules/"),
  )
  process.stderr.write("\nLOADED_MODULES " + JSON.stringify(modules) + "\n")
})
