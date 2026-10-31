import yargs, { type Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { EOL } from "os"
import { errorMessage } from "./util/error"
import { Heap } from "./cli/heap"

const args = hideBin(process.argv)
// Command modules import most of the server graph, so load only the one being run.
const loaders = {
  acp: async (cli: Argv) => {
    const { AcpCommand } = await import("./cli/cmd/acp")
    return cli.command(AcpCommand)
  },
  mcp: async (cli: Argv) => {
    const { McpCommand } = await import("./cli/cmd/mcp")
    return cli.command(McpCommand)
  },
  $0: async (cli: Argv) => {
    const { TuiThreadCommand } = await import("./cli/cmd/tui")
    return cli.command(TuiThreadCommand)
  },
  attach: async (cli: Argv) => {
    const { AttachCommand } = await import("./cli/cmd/attach")
    return cli.command(AttachCommand)
  },
  run: async (cli: Argv) => {
    const { RunCommand } = await import("./cli/cmd/run")
    return cli.command(RunCommand)
  },
  generate: async (cli: Argv) => {
    const { GenerateCommand } = await import("./cli/cmd/generate")
    return cli.command(GenerateCommand)
  },
  debug: async (cli: Argv) => {
    const { DebugCommand } = await import("./cli/cmd/debug")
    return cli.command(DebugCommand)
  },
  console: async (cli: Argv) => {
    const { ConsoleCommand } = await import("./cli/cmd/account")
    return cli.command(ConsoleCommand)
  },
  providers: async (cli: Argv) => {
    const { ProvidersCommand } = await import("./cli/cmd/providers")
    return cli.command(ProvidersCommand)
  },
  agent: async (cli: Argv) => {
    const { AgentCommand } = await import("./cli/cmd/agent")
    return cli.command(AgentCommand)
  },
  upgrade: async (cli: Argv) => {
    const { UpgradeCommand } = await import("./cli/cmd/upgrade")
    return cli.command(UpgradeCommand)
  },
  uninstall: async (cli: Argv) => {
    const { UninstallCommand } = await import("./cli/cmd/uninstall")
    return cli.command(UninstallCommand)
  },
  serve: async (cli: Argv) => {
    const { ServeCommand } = await import("./cli/cmd/serve")
    return cli.command(ServeCommand)
  },
  web: async (cli: Argv) => {
    const { WebCommand } = await import("./cli/cmd/web")
    return cli.command(WebCommand)
  },
  models: async (cli: Argv) => {
    const { ModelsCommand } = await import("./cli/cmd/models")
    return cli.command(ModelsCommand)
  },
  stats: async (cli: Argv) => {
    const { StatsCommand } = await import("./cli/cmd/stats")
    return cli.command(StatsCommand)
  },
  export: async (cli: Argv) => {
    const { ExportCommand } = await import("./cli/cmd/export")
    return cli.command(ExportCommand)
  },
  import: async (cli: Argv) => {
    const { ImportCommand } = await import("./cli/cmd/import")
    return cli.command(ImportCommand)
  },
  github: async (cli: Argv) => {
    const { GithubCommand } = await import("./cli/cmd/github")
    return cli.command(GithubCommand)
  },
  pr: async (cli: Argv) => {
    const { PrCommand } = await import("./cli/cmd/pr")
    return cli.command(PrCommand)
  },
  session: async (cli: Argv) => {
    const { SessionCommand } = await import("./cli/cmd/session")
    return cli.command(SessionCommand)
  },
  plugin: async (cli: Argv) => {
    const { PluginCommand } = await import("./cli/cmd/plug")
    return cli.command(PluginCommand)
  },
  db: async (cli: Argv) => {
    const { DbCommand } = await import("./cli/cmd/db")
    return cli.command(DbCommand)
  },
}
const aliases: Record<string, keyof typeof loaders> = { auth: "providers", plug: "plugin" }

function selectCommands() {
  const flags = args.slice(0, args.includes("--") ? args.indexOf("--") : undefined)
  const token = commandToken(flags)
  if (token === "completion" || flags.includes("--get-yargs-completions")) return Object.values(loaders)
  if (
    flags.some(
      (flag, index) =>
        ["-v", "--version", "-v=true", "--version=true"].includes(flag) &&
        !((flag === "-v" || flag === "--version") && flags[index + 1] === "false"),
    )
  )
    return []
  const name = token === undefined ? undefined : (aliases[token] ?? token)
  if (name !== undefined && name !== "$0" && Object.hasOwn(loaders, name))
    return [loaders[name as keyof typeof loaders]]
  if (
    flags.some(
      (flag, index) =>
        ["-h", "--help", "-h=true", "--help=true"].includes(flag) &&
        !((flag === "-h" || flag === "--help") && flags[index + 1] === "false"),
    )
  )
    return Object.values(loaders)
  return [loaders.$0]
}

// The command name is the first token after global flags; anything else falls through to the default TUI command.
function commandToken(flags: string[]): string | undefined {
  const head = flags[0]
  const next = flags[1]
  if (head === "--pure" || head === "--print-logs")
    return commandToken(next === "true" || next === "false" ? flags.slice(2) : flags.slice(1))
  if (
    head === "--no-print-logs" ||
    head === "--no-pure" ||
    head?.startsWith("--print-logs=") ||
    head?.startsWith("--pure=") ||
    head === "--help=false" ||
    head === "--version=false" ||
    head === "-h=false" ||
    head === "-v=false" ||
    head?.startsWith("--log-level=")
  )
    return commandToken(flags.slice(1))
  if ((head === "--help" || head === "--version" || head === "-h" || head === "-v") && next === "false")
    return commandToken(flags.slice(2))
  if (head === "--log-level") return commandToken(flags.slice(2))
  return head
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")

for (const load of selectCommands()) await load(cli)

cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
