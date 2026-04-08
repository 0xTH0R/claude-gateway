/**
 * update-agent: CLI to update an existing agent's agent.md with Claude.
 *
 * Steps:
 *  1. Select agent from config.json
 *  2. Claude reads current agent.md and generates updated version
 *  3. Show preview of new content
 *  4. User confirms: y (save), edit (open editor), n (cancel)
 *  5. Save agent.md + regenerate CLAUDE.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { spawnSync } from 'child_process';
import { loadWorkspace } from '../src/workspace-loader';
import { buildUpdatePrompt } from './create-agent-prompts';
import { expandHome, printFilePreview } from './create-agent';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function gatewayDir(): string {
  return path.join(os.homedir(), '.claude-gateway');
}

function configPath(): string {
  const envPath = process.env['GATEWAY_CONFIG'];
  if (envPath) return expandHome(envPath);
  return path.join(gatewayDir(), 'config.json');
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

interface RawAgentEntry {
  id: string;
  workspace: string;
}

interface RawConfig {
  agents: RawAgentEntry[];
}

function loadConfig(): RawConfig {
  const cp = configPath();
  if (!fs.existsSync(cp)) {
    console.error(`Config not found: ${cp}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cp, 'utf8')) as RawConfig;
}

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Step 1 — Select agent
// ---------------------------------------------------------------------------

function interactiveSelect(items: string[], label: string): Promise<number> {
  return new Promise((resolve) => {
    let selected = 0;
    const { stdin, stdout } = process;

    // Pad item text to fixed width for consistent highlight bar
    const maxLen = Math.max(...items.map((s) => s.length));

    function renderItem(i: number): string {
      const text = `    ${items[i]}`.padEnd(maxLen + 6);
      if (i === selected) {
        // Reverse video — uses terminal's default colors
        return `\x1b[7m${text}\x1b[0m`;
      }
      return text;
    }

    // Total lines drawn: 1 (label) + 1 (blank) + items.length
    const totalLines = items.length + 2;

    function render(): void {
      // Move cursor up to redraw list only (not label)
      stdout.write(`\x1b[${items.length}A`);
      for (let i = 0; i < items.length; i++) {
        stdout.write(`\x1b[2K${renderItem(i)}\n`);
      }
    }

    // Hide cursor during selection
    stdout.write('\x1b[?25l');

    // Initial render: label + blank line + items
    stdout.write(`${label}\n\n`);
    for (let i = 0; i < items.length; i++) {
      stdout.write(`${renderItem(i)}\n`);
    }

    if (!stdin.isTTY) {
      resolve(0);
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    function onData(key: Buffer): void {
      const s = key.toString();

      if (s === '\x1b[A' || s === 'k') {
        // Up arrow or k
        selected = (selected - 1 + items.length) % items.length;
        render();
      } else if (s === '\x1b[B' || s === 'j') {
        // Down arrow or j
        selected = (selected + 1) % items.length;
        render();
      } else if (s === '\r' || s === '\n') {
        // Enter
        cleanup();
        resolve(selected);
      } else if (s === '\x03') {
        // Ctrl+C
        cleanup();
        process.exit(0);
      }
    }

    function cleanup(): void {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      // Clear select UI (move up past all lines and clear each)
      stdout.write(`\x1b[${totalLines}A`);
      for (let i = 0; i < totalLines; i++) {
        stdout.write('\x1b[2K\n');
      }
      stdout.write(`\x1b[${totalLines}A`);
      // Restore cursor visibility
      stdout.write('\x1b[?25h');
    }

    stdin.on('data', onData);
  });
}

async function selectAgent(): Promise<{ agentId: string; wsDir: string }> {
  const config = loadConfig();
  const agents = config.agents;

  if (agents.length === 0) {
    console.error('No agents found in config.json. Run "make create-agent" first.');
    process.exit(1);
  }

  const items = agents.map((a) => a.id);
  const selected = await interactiveSelect(items, 'Select an agent (↑/↓ to move, Enter to select):');
  const agent = agents[selected];
  const wsDir = expandHome(agent.workspace);
  console.log(`\n  Selected: ${agent.id}\n`);
  return { agentId: agent.id, wsDir };
}

// ---------------------------------------------------------------------------
// Step 2 — Generate updated agent.md
// ---------------------------------------------------------------------------

function generateUpdatedAgent(agentId: string, currentContent: string): string | null {
  const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);
  console.log('\nGenerating updated agent.md with Claude...');

  const updatePrompt = buildUpdatePrompt(agentName, currentContent);
  const result = spawnSync('claude', ['--print'], {
    input: updatePrompt,
    encoding: 'utf8',
    timeout: 60000,
  });

  if (result.error || result.status !== 0 || !result.stdout?.trim()) {
    console.error('  Error: Claude generation failed.');
    if (result.stderr) console.error(result.stderr);
    return null;
  }

  // Claude should output only the agent.md content (no markers).
  // Strip any accidental preamble by finding the first markdown structure.
  const raw = result.stdout.trim();
  const yamlStart = raw.indexOf('---\n');
  const headingStart = raw.indexOf('# ');
  const start = yamlStart >= 0 ? yamlStart : headingStart;
  if (start < 0) {
    console.error('  Error: Could not parse agent.md from Claude output.');
    return null;
  }
  return raw.slice(start).trim();
}

// ---------------------------------------------------------------------------
// Step 4 — Confirm loop (returns final content or null if cancelled)
// ---------------------------------------------------------------------------

async function confirmAndSave(
  rl: readline.Interface,
  agentMdPath: string,
  initialContent: string
): Promise<string | null> {
  let currentContent = initialContent;

  while (true) {
    const answer = await prompt(rl, 'Accept? (y/edit/n) [y]: ');
    const choice = answer.trim().toLowerCase() || 'y';

    if (choice === 'y' || choice === 'yes') {
      return currentContent;
    } else if (choice === 'n' || choice === 'no') {
      console.log('  Cancelled. No changes made.');
      return null;
    } else if (choice === 'edit') {
      const tmpFile = path.join(os.tmpdir(), `claude-gateway-agent.md`);
      fs.writeFileSync(tmpFile, currentContent, 'utf8');

      const editorCandidates = [
        process.env['VISUAL'],
        process.env['EDITOR'],
        'vim',
        'vi',
        'nano',
      ].filter(Boolean) as string[];

      let editResult: ReturnType<typeof spawnSync> | null = null;
      let usedEditor = '';
      for (const candidate of editorCandidates) {
        const result = spawnSync(candidate, [tmpFile], { stdio: 'inherit' });
        if (!result.error) {
          editResult = result;
          usedEditor = candidate;
          break;
        }
      }

      if (!editResult) {
        console.log(
          '  Could not open any editor (tried: ' +
            editorCandidates.join(', ') +
            ').\n  Set $EDITOR and try again, or choose y/n.'
        );
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } else {
        const edited = fs.readFileSync(tmpFile, 'utf8');
        fs.unlinkSync(tmpFile);
        currentContent = edited;
        printFilePreview('agent.md', currentContent);
        console.log(`  (edited with ${usedEditor})`);
      }
    } else {
      console.log('  Please enter y, edit, or n.');
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════');
  console.log('  Claude Gateway — Update Agent');
  console.log('═══════════════════════════════════════\n');

  // Step 1 — Select agent (before creating readline — interactiveSelect uses raw stdin)
  const { agentId, wsDir } = await selectAgent();

  // interactiveSelect pauses stdin in cleanup — resume it so readline can read
  process.stdin.resume();
  const rl = createRl();

  // Check agent.md exists
  const agentMdPath = path.join(wsDir, 'agent.md');
  if (!fs.existsSync(agentMdPath)) {
    console.error(`  Error: agent.md not found at ${agentMdPath}`);
    rl.close();
    process.exit(1);
  }

  const currentContent = fs.readFileSync(agentMdPath, 'utf8');

  // Step 2 — Generate
  const newContent = generateUpdatedAgent(agentId, currentContent);
  if (!newContent) {
    rl.close();
    process.exit(1);
  }

  // Step 3 — Preview
  printFilePreview('agent.md', newContent);
  console.log('\n  Warning: this will overwrite the existing agent.md');

  // Step 4 — Confirm
  const finalContent = await confirmAndSave(rl, agentMdPath, newContent);
  rl.close();

  if (finalContent === null) {
    process.exit(0);
  }

  // Step 5 — Save
  fs.writeFileSync(agentMdPath, finalContent + '\n', 'utf8');
  console.log('  ✓ agent.md saved');

  // Regenerate CLAUDE.md
  try {
    const loaded = await loadWorkspace(wsDir);
    const claudeMdPath = path.join(wsDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, loaded.systemPrompt, 'utf8');
    console.log('  ✓ CLAUDE.md regenerated');
  } catch (err) {
    console.error(`  Warning: Could not regenerate CLAUDE.md: ${(err as Error).message}`);
  }

  console.log('\nDone! Restart the gateway to apply changes.');
}

main().catch((err) => {
  console.error('\nFatal error:', (err as Error).message);
  process.exit(1);
});
