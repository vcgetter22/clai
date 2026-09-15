import { Command } from 'commander';
import pc from 'picocolors';
import { accent, bold, dim } from './ui.js';
import { cliVersion } from './context.js';
import { registerAsk } from './commands/ask.js';
import { registerConnect } from './commands/connect.js';
import { registerDashboard } from './commands/dashboard.js';
import { registerDoctor } from './commands/doctor.js';
import { registerExport } from './commands/export.js';
import { registerImport } from './commands/import.js';
import { registerInsights } from './commands/insights.js';
import { registerLogin } from './commands/login.js';
import { registerPricing } from './commands/pricing.js';
import { registerReport } from './commands/report.js';
import { registerScan } from './commands/scan.js';
import { registerSettings } from './commands/settings.js';
import { registerStatus } from './commands/status.js';
import { registerSync } from './commands/sync.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('clai')
    .description(
      [
        'clai: see what your AI really costs.',
        '',
        'Tracks Claude (Claude Code, API, Pro/Max/Team), ChatGPT/Codex, Gemini, Cursor, Copilot and',
        'OpenRouter usage with real prices, locally. Subscription usage is valued at API list prices',
        'so you can see what a plan is worth. Only usage metadata is read; prompt content is never stored.',
        '',
        `Quick start:  clai scan  ->  clai report  ->  clai insights  ->  clai dashboard`,
      ].join('\n'),
    )
    .version(cliVersion())
    .option('--json', 'machine-readable output', false)
    .option('--db <path>', 'SQLite database path (default ~/.clai/clai.db or $CLAI_DB)')
    .option('-q, --quiet', 'suppress progress output', false)
    .option('-v, --verbose', 'debug output', false)
    .showHelpAfterError()
    .configureOutput({ outputError: (str, write) => write(pc.red(str)) })
    // Help styling (design principles rule 2): titles and command names in the accent, nothing else colored.
    .configureHelp({
      styleTitle: (str) => bold(accent(str)),
      styleSubcommandTerm: (str) => accent(str),
      styleOptionTerm: (str) => bold(str),
      styleDescriptionText: (str) => str,
    })
    .addHelpText('after', '\n' + dim('  Only usage metadata is read (token counts, model ids, timestamps); prompt content is never stored.') + '\n' + dim('  Docs and source: https://github.com/vcgetter22/clai'));

  // Registration order is help order within each group.
  registerScan(program);
  registerReport(program);
  registerInsights(program);
  registerStatus(program);
  registerDashboard(program);
  registerConnect(program);
  registerImport(program);
  registerExport(program);
  registerLogin(program);
  registerSync(program);
  registerSettings(program);
  registerPricing(program);
  registerDoctor(program);
  registerAsk(program);
  groupCommands(program);
  return program;
}

const GROUPS: Record<string, string[]> = {
  'Numbers:': ['scan', 'report', 'insights', 'status', 'dashboard'],
  'Sources:': ['connect', 'disconnect', 'pull', 'import', 'export'],
  'Team and hosted:': ['login', 'sync'],
  'Setup and tools:': ['plan', 'budget', 'seat', 'config', 'pricing', 'doctor', 'ask'],
};

function groupCommands(program: Command): void {
  for (const cmd of program.commands) {
    const group = Object.entries(GROUPS).find(([, names]) => names.includes(cmd.name()))?.[0];
    if (group) cmd.helpGroup(group);
  }
}

export async function run(argv: string[]): Promise<void> {
  // `clai export | head` closes the pipe early; exit quietly instead of crashing.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
  const program = buildProgram();
  await program.parseAsync(argv);
}
