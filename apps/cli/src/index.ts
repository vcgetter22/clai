import { Command } from 'commander';
import pc from 'picocolors';
import { cliVersion } from './context.js';
import { registerAsk } from './commands/ask.js';
import { registerConnect } from './commands/connect.js';
import { registerDashboard } from './commands/dashboard.js';
import { registerDoctor } from './commands/doctor.js';
import { registerExport } from './commands/export.js';
import { registerImport } from './commands/import.js';
import { registerInsights } from './commands/insights.js';
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
    .configureOutput({ outputError: (str, write) => write(pc.red(str)) });

  registerScan(program);
  registerReport(program);
  registerInsights(program);
  registerStatus(program);
  registerDashboard(program);
  registerSettings(program);
  registerConnect(program);
  registerImport(program);
  registerSync(program);
  registerExport(program);
  registerPricing(program);
  registerDoctor(program);
  registerAsk(program);
  return program;
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
