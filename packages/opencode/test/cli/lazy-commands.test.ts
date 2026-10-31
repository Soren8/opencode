import { describe, expect, test } from "bun:test"
import path from "path"

const root = path.join(import.meta.dir, "../..")

async function loaded(args: string[]) {
  const proc = Bun.spawn(["bun", "--preload", "./test/fixture/loaded-modules.ts", "./src/index.ts", ...args], {
    cwd: root,
    env: { ...process.env, COLUMNS: "120" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  const line = stderr.split("\n").find((item) => item.startsWith("LOADED_MODULES "))
  return {
    exitCode,
    output: stdout + stderr,
    modules: (JSON.parse(line?.slice("LOADED_MODULES ".length) ?? "[]") as string[]).map((item) =>
      path.relative(root, item),
    ),
  }
}

const commands = (modules: string[]) => modules.filter((item) => item.startsWith(path.join("src", "cli", "cmd")))

describe("cli command loading", () => {
  test("--version loads no command or server modules", async () => {
    const result = await loaded(["--version"])
    expect(result.exitCode).toBe(0)
    expect(result.output.split("\n")[0]).not.toBe("")
    expect(commands(result.modules)).toEqual([])
    expect(result.modules.filter((item) => item.startsWith(path.join("src", "server")))).toEqual([])
  }, 30_000)

  test("a subcommand loads only its own command module", async () => {
    const result = await loaded(["models", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("list all available models")
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(result.modules).toContain(path.join("..", "core", "src", "models-dev.ts"))
    expect(commands(result.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(result.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))
  }, 30_000)

  test("aliases resolve to their command", async () => {
    const result = await loaded(["auth", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("providers")
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "providers.ts"))
    expect(commands(result.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
  }, 30_000)

  test("leading global flags with equals values preserve subcommand selection", async () => {
    const result = await loaded([
      "--pure=true",
      "--print-logs=false",
      "--log-level=INFO",
      "--help=false",
      "--version=false",
      "models",
      "--help",
    ])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("list all available models")
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(result.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
  }, 30_000)

  test("negated leading global flags preserve subcommand selection", async () => {
    const result = await loaded(["--no-pure", "models", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("list all available models")
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(result.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
  }, 30_000)

  test("a positional project still uses the default TUI command", async () => {
    const result = await loaded(["project-directory", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("path to start opencode in")
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "tui.ts"))
  }, 30_000)

  test("top-level help still lists every command", async () => {
    const result = await loaded(["--help"])
    expect(result.exitCode).toBe(0)
    for (const name of ["acp", "mcp", "attach", "run", "serve", "models", "session", "plugin", "db"])
      expect(result.output).toContain(`opencode ${name}`)
  }, 30_000)

  test("completion still exposes registered commands", async () => {
    const result = await loaded(["completion"])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("models")
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(result.modules)).toContain(path.join("src", "cli", "cmd", "tui.ts"))
  }, 30_000)

  test("separate true/false pure values preserve subcommand selection", async () => {
    const falsy = await loaded(["--pure", "false", "models", "--help"])
    expect(falsy.exitCode).toBe(0)
    expect(falsy.output).toContain("list all available models")
    expect(commands(falsy.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(falsy.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(falsy.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))

    const truthy = await loaded(["--pure", "true", "models", "--help"])
    expect(truthy.exitCode).toBe(0)
    expect(truthy.output).toContain("list all available models")
    expect(commands(truthy.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(truthy.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(truthy.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))
  }, 60_000)

  test("separate true/false print-logs values preserve subcommand selection", async () => {
    const falsy = await loaded(["--print-logs", "false", "models", "--help"])
    expect(falsy.exitCode).toBe(0)
    expect(falsy.output).toContain("list all available models")
    expect(commands(falsy.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(falsy.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(falsy.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))

    const truthy = await loaded(["--print-logs", "true", "models", "--help"])
    expect(truthy.exitCode).toBe(0)
    expect(truthy.output).toContain("list all available models")
    expect(commands(truthy.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(truthy.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(truthy.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))
  }, 60_000)

  test("separate false version values preserve subcommand selection", async () => {
    const long = await loaded(["--version", "false", "models", "--help"])
    expect(long.exitCode).toBe(0)
    expect(long.output).toContain("list all available models")
    expect(commands(long.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(long.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(long.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))

    const short = await loaded(["-v", "false", "models", "--help"])
    expect(short.exitCode).toBe(0)
    expect(short.output).toContain("list all available models")
    expect(commands(short.modules)).toContain(path.join("src", "cli", "cmd", "models.ts"))
    expect(commands(short.modules)).not.toContain(path.join("src", "cli", "cmd", "tui.ts"))
    expect(commands(short.modules)).not.toContain(path.join("src", "cli", "cmd", "run.ts"))
  }, 60_000)
})
