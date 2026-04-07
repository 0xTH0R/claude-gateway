import * as fs from 'fs';
import * as path from 'path';
import PQueue from 'p-queue';
import { Message } from './types';

export class SessionStore {
  private readonly agentsBaseDir: string;
  private readonly queues = new Map<string, PQueue>();

  constructor(agentsBaseDir: string) {
    this.agentsBaseDir = agentsBaseDir;
  }

  /**
   * Return the session key for a given agent + chat combination.
   */
  resolveKey(agentId: string, chatId: string): string {
    return `agent:${agentId}:telegram:${chatId}`;
  }

  /**
   * Resolve the file path for a session.
   */
  private resolvePath(agentId: string, chatId: string): string {
    return path.join(this.agentsBaseDir, agentId, 'sessions', `${chatId}.jsonl`);
  }

  /**
   * Get or create a per-file serialization queue (prevents concurrent write corruption).
   */
  private getQueue(agentId: string, chatId: string): PQueue {
    const key = this.resolveKey(agentId, chatId);
    if (!this.queues.has(key)) {
      this.queues.set(key, new PQueue({ concurrency: 1 }));
    }
    return this.queues.get(key)!;
  }

  /**
   * Load all messages from a session file.
   * Returns empty array if file doesn't exist.
   * Resets to empty (and logs) if file is corrupt.
   */
  async loadSession(agentId: string, chatId: string): Promise<Message[]> {
    const filePath = this.resolvePath(agentId, chatId);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    const messages: Message[] = [];

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as Message;
        messages.push(msg);
      } catch {
        // Corrupted line — reset the session
        console.error(`[SessionStore] Corrupted session file at ${filePath}, resetting.`);
        await this.resetSession(agentId, chatId);
        return [];
      }
    }

    return messages;
  }

  /**
   * Append a single message to a session file.
   * Creates the file (and parent directories) if needed.
   * Serialized per-session via p-queue to prevent concurrent corruption.
   */
  async appendMessage(agentId: string, chatId: string, message: Message): Promise<void> {
    const queue = this.getQueue(agentId, chatId);
    await queue.add(async () => {
      const filePath = this.resolvePath(agentId, chatId);
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify(message) + '\n';
      fs.appendFileSync(filePath, line, 'utf-8');
    });
  }

  /**
   * Reset a session by deleting (or truncating) the session file.
   */
  async resetSession(agentId: string, chatId: string): Promise<void> {
    const queue = this.getQueue(agentId, chatId);
    await queue.add(async () => {
      const filePath = this.resolvePath(agentId, chatId);
      try {
        fs.writeFileSync(filePath, '', 'utf-8');
      } catch {
        // File might not exist yet; that's fine
      }
    });
  }

  /**
   * Delete session files older than maxAgeDays.
   * Returns the count of deleted files.
   */
  async pruneOldSessions(agentId: string, maxAgeDays: number): Promise<number> {
    const sessionsDir = path.join(this.agentsBaseDir, agentId, 'sessions');

    if (!fs.existsSync(sessionsDir)) {
      return 0;
    }

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    const entries = fs.readdirSync(sessionsDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = path.join(sessionsDir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch {
        // Ignore errors for individual files
      }
    }

    return deleted;
  }
}
