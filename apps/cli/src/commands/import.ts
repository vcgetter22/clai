import { openSync, readSync, closeSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { importConnectors, type ImportConnector } from '@claii/connectors';
import { findImportConnector, runImport } from '@claii/server';
import { openContext, type GlobalOptions } from '../context.js';
import { dim, fail, heading, ok, printJson, warn } from '../ui.js';

function head(path: string, n = 4096): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read).toString('latin1');
  } finally {
    closeSync(fd);
  }
}

export function registerImport(program: Command): void {
  program
    .command('import <file>')
    .description('Import a claude.ai or ChatGPT data export (zip or conversations.json). Token counts are estimated; no message text is stored.')
    .option('--source <id>', 'force a specific import connector (claude-export, chatgpt-export)')
    .option('--plan <plan>', 'plan key to attribute the usage to (e.g. pro, plus)')
    .option('--model <id>', 'assumed model for exports that do not record it (claude.ai exports)')
    .option('--estimate', 'estimate token counts from text length when the export carries none (claude.ai exports); results are labelled estimated', false)
    .action(async (file: string, opts: { source?: string; plan?: string; model?: string; estimate: boolean }, cmd: Command) => {
      const ctx = openContext(cmd.optsWithGlobals() as GlobalOptions);
      try {
        const path = resolve(file);
        if (!existsSync(path)) throw new Error(`File not found: ${path}`);
        const h = head(path);
        const connector: ImportConnector | undefined = opts.source ? (importConnectors as ImportConnector[]).find((c) => c.id === opts.source) : findImportConnector(path, h);
        if (!connector) {
          const available = (importConnectors as ImportConnector[]).map((c) => c.id).join(', ') || 'none registered';
          throw new Error(`Could not detect the export format of ${file}. Use --source <id> (available: ${available}).`);
        }
        const spin = ctx.progress(`importing with ${connector.displayName}`);
        let r;
        try {
          r = await runImport(ctx.runner, connector, path, { plan: opts.plan, model: opts.model, estimate: opts.estimate });
        } finally {
          spin.stop();
        }
        if (ctx.json) return printJson({ result: r });
        console.log(heading('clai import'));
        console.log(r.error ? fail(r.error) : ok(`${connector.displayName}: ${r.seen} messages seen, ${r.inserted} new, ${r.updated} updated${r.unpriced ? `, ${r.unpriced} unpriced` : ''}`));
        if (r.unpricedModels.length) console.log(warn(`  unpriced models: ${r.unpricedModels.join(', ')}`));
        if (connector.id === 'claude-export' && !opts.estimate) console.log(dim('  claude.ai exports carry no token counts or model; only message counts were imported. Add --estimate --model claude-sonnet-5 for an estimate.'));
        else console.log(dim('  Costs from exports are estimates (token counts are derived from text) and are labelled as such.'));
      } finally {
        await ctx.close();
      }
    });
}
