import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import { WorkspaceFiles, LoadedWorkspace, WatchHandle } from './types';

export class MissingRequiredFileError extends Error {
  constructor(fileName: string) {
    super(`Required workspace file is missing: ${fileName}`);
    this.name = 'MissingRequiredFileError';
  }
}

const FILE_CHAR_LIMIT = 20_000;
const TOTAL_CHAR_LIMIT = 150_000;
const TRUNCATION_MARKER = '\n[TRUNCATED — edit this file to trim]\n';

function readFileOrDefault(filePath: string, defaultValue: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return defaultValue;
  }
}

function truncateFile(content: string): { content: string; truncated: boolean } {
  if (content.length > FILE_CHAR_LIMIT) {
    return {
      content: content.slice(0, FILE_CHAR_LIMIT) + TRUNCATION_MARKER,
      truncated: true,
    };
  }
  return { content, truncated: false };
}

/**
 * Load workspace markdown files and assemble the system prompt.
 */
export async function loadWorkspace(workspaceDir: string): Promise<LoadedWorkspace> {
  const agentMdPath = path.join(workspaceDir, 'agent.md');

  // agent.md is required
  if (!fs.existsSync(agentMdPath)) {
    throw new MissingRequiredFileError('agent.md');
  }

  const rawAgent = fs.readFileSync(agentMdPath, 'utf-8');
  const rawSoul = readFileOrDefault(path.join(workspaceDir, 'soul.md'), '');
  const rawTools = readFileOrDefault(path.join(workspaceDir, 'tools.md'), '');
  const rawUser = readFileOrDefault(path.join(workspaceDir, 'user.md'), '');
  const rawHeartbeat = readFileOrDefault(path.join(workspaceDir, 'heartbeat.md'), '');
  const rawMemory = readFileOrDefault(path.join(workspaceDir, 'memory.md'), '');

  const bootstrapPath = path.join(workspaceDir, 'bootstrap.md');
  const bootstrapExists = fs.existsSync(bootstrapPath);
  const rawBootstrap = bootstrapExists ? fs.readFileSync(bootstrapPath, 'utf-8') : null;

  let anyTruncated = false;

  const truncateResult = (raw: string) => {
    const r = truncateFile(raw);
    if (r.truncated) anyTruncated = true;
    return r.content;
  };

  const agentMd = truncateResult(rawAgent);
  const soulMd = truncateResult(rawSoul);
  const toolsMd = truncateResult(rawTools);
  const userMd = truncateResult(rawUser);
  const heartbeatMd = truncateResult(rawHeartbeat);
  const memoryMd = truncateResult(rawMemory);
  const bootstrapMd = rawBootstrap !== null ? truncateResult(rawBootstrap) : null;

  // Assemble system prompt (bootstrap not included in prompt sections)
  let systemPrompt =
    `--- AGENT IDENTITY ---\n${agentMd}\n\n` +
    `--- SOUL ---\n${soulMd}\n\n` +
    `--- USER PROFILE ---\n${userMd}\n\n` +
    `--- AVAILABLE TOOLS ---\n${toolsMd}\n\n` +
    `--- LONG-TERM MEMORY ---\n${memoryMd}\n\n` +
    `--- HEARTBEAT CONFIG ---\n${heartbeatMd}`;

  // Enforce total limit
  if (systemPrompt.length > TOTAL_CHAR_LIMIT) {
    systemPrompt = systemPrompt.slice(0, TOTAL_CHAR_LIMIT) + TRUNCATION_MARKER;
    anyTruncated = true;
  }

  const files: WorkspaceFiles = {
    agentMd,
    soulMd,
    toolsMd,
    userMd,
    heartbeatMd,
    memoryMd,
    bootstrapMd,
    isFirstRun: bootstrapExists,
  };

  return {
    systemPrompt,
    files,
    truncated: anyTruncated,
  };
}

const WATCH_DEBOUNCE_MS = 300;

/**
 * Watch a workspace directory for changes.
 * Calls onChange when any .md file changes (debounced 300ms).
 * Returns a WatchHandle with a close() method.
 */
export function watchWorkspace(workspaceDir: string, onChange: () => void): WatchHandle {
  const watcher = chokidar.watch(path.join(workspaceDir, '*.md'), {
    persistent: true,
    ignoreInitial: true,
    ignored: path.join(workspaceDir, 'CLAUDE.md'),
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedOnChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
  };

  watcher.on('change', debouncedOnChange);
  watcher.on('add', debouncedOnChange);
  watcher.on('unlink', debouncedOnChange);

  return {
    close(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher.close().catch(() => {
        // Ignore errors during close
      });
    },
  };
}

/**
 * Delete bootstrap.md from the workspace directory.
 * Idempotent: no error if file is already gone.
 */
export async function deleteBootstrap(workspaceDir: string): Promise<void> {
  const bootstrapPath = path.join(workspaceDir, 'bootstrap.md');
  try {
    fs.unlinkSync(bootstrapPath);
  } catch {
    // File may already be gone; ignore
  }
}

/**
 * Mark bootstrap as complete by renaming bootstrap.md → bootstrap.md.done.
 * Idempotent: no error if file is already gone or already renamed.
 */
export async function markBootstrapComplete(workspaceDir: string): Promise<void> {
  const bootstrapPath = path.join(workspaceDir, 'bootstrap.md');
  const donePath = path.join(workspaceDir, 'bootstrap.md.done');
  try {
    fs.renameSync(bootstrapPath, donePath);
  } catch {
    // File may already be gone or renamed; ignore
  }
}
