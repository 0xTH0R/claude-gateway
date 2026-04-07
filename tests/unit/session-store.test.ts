import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStore } from '../../src/session-store';
import { Message } from '../../src/types';

function makeMsg(role: 'user' | 'assistant', content: string): Message {
  return { role, content, ts: Date.now() };
}

describe('session-store', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-test-'));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // U-SS-01: DM session key
  // -------------------------------------------------------------------------
  it('U-SS-01: generates correct DM session key', () => {
    const key = store.resolveKey('alfred', '991177022');
    expect(key).toBe('agent:alfred:telegram:991177022');
  });

  // -------------------------------------------------------------------------
  // U-SS-02: Group session key
  // -------------------------------------------------------------------------
  it('U-SS-02: generates correct group session key', () => {
    const key = store.resolveKey('baerbel', '-1001234567890');
    expect(key).toBe('agent:baerbel:telegram:-1001234567890');
  });

  // -------------------------------------------------------------------------
  // U-SS-03: Different agents, same chat ID → different keys
  // -------------------------------------------------------------------------
  it('U-SS-03: different agents with same chatId produce different keys', () => {
    const keyA = store.resolveKey('alfred', '123');
    const keyB = store.resolveKey('baerbel', '123');
    expect(keyA).not.toBe(keyB);
  });

  // -------------------------------------------------------------------------
  // U-SS-04: Session file path resolution
  // -------------------------------------------------------------------------
  it('U-SS-04: session file is stored under <agentsBaseDir>/<agentId>/sessions/<chatId>.jsonl', async () => {
    await store.appendMessage('alfred', '991177022', makeMsg('user', 'hello'));
    const expectedPath = path.join(tmpDir, 'alfred', 'sessions', '991177022.jsonl');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // U-SS-05: New session created (no file → empty array)
  // -------------------------------------------------------------------------
  it('U-SS-05: returns empty array for a new (non-existent) session', async () => {
    const messages = await store.loadSession('alfred', 'newchat');
    expect(messages).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // U-SS-06: Existing session loaded
  // -------------------------------------------------------------------------
  it('U-SS-06: loads an existing session with messages', async () => {
    const msgs = [
      makeMsg('user', 'hello'),
      makeMsg('assistant', 'hi there'),
      makeMsg('user', 'how are you?'),
      makeMsg('assistant', 'fine'),
      makeMsg('user', 'bye'),
    ];
    for (const msg of msgs) {
      await store.appendMessage('alfred', 'chat1', msg);
    }

    const loaded = await store.loadSession('alfred', 'chat1');
    expect(loaded).toHaveLength(5);
    expect(loaded[0].content).toBe('hello');
    expect(loaded[4].content).toBe('bye');
  });

  // -------------------------------------------------------------------------
  // U-SS-07: Session append (not overwrite)
  // -------------------------------------------------------------------------
  it('U-SS-07: appending a message does not overwrite existing messages', async () => {
    await store.appendMessage('alfred', 'chat1', makeMsg('user', 'first'));
    await store.appendMessage('alfred', 'chat1', makeMsg('assistant', 'second'));

    const loaded = await store.loadSession('alfred', 'chat1');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].content).toBe('first');
    expect(loaded[1].content).toBe('second');
  });

  // -------------------------------------------------------------------------
  // U-SS-08: Concurrent writes — both messages persisted (no data loss)
  // -------------------------------------------------------------------------
  it('U-SS-08: concurrent writes are serialized — both messages persisted', async () => {
    const writes = [
      store.appendMessage('alfred', 'chat1', makeMsg('user', 'msg-1')),
      store.appendMessage('alfred', 'chat1', makeMsg('user', 'msg-2')),
    ];
    await Promise.all(writes);

    const loaded = await store.loadSession('alfred', 'chat1');
    expect(loaded).toHaveLength(2);
    const contents = loaded.map((m) => m.content).sort();
    expect(contents).toEqual(['msg-1', 'msg-2']);
  });

  // -------------------------------------------------------------------------
  // U-SS-09: Corrupted session file → reset to empty
  // -------------------------------------------------------------------------
  it('U-SS-09: resets session when .jsonl contains a corrupted line', async () => {
    const sessionDir = path.join(tmpDir, 'alfred', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, 'corrupt.jsonl');
    // Write two lines: one valid, one corrupted
    fs.writeFileSync(sessionFile, '{"role":"user","content":"good","ts":1}\nBAD JSON LINE\n');

    const loaded = await store.loadSession('alfred', 'corrupt');
    expect(loaded).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // resetSession
  // -------------------------------------------------------------------------
  it('resetSession empties the session file', async () => {
    await store.appendMessage('alfred', 'chat1', makeMsg('user', 'hello'));
    await store.resetSession('alfred', 'chat1');

    const loaded = await store.loadSession('alfred', 'chat1');
    expect(loaded).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // pruneOldSessions
  // -------------------------------------------------------------------------
  it('pruneOldSessions deletes files older than maxAgeDays', async () => {
    const sessionDir = path.join(tmpDir, 'alfred', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });

    // Create a file and backdate its mtime to 10 days ago
    const oldFile = path.join(sessionDir, 'old-chat.jsonl');
    fs.writeFileSync(oldFile, '{"role":"user","content":"old","ts":1}\n');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    // Create a fresh file
    const newFile = path.join(sessionDir, 'new-chat.jsonl');
    fs.writeFileSync(newFile, '{"role":"user","content":"new","ts":2}\n');

    const deleted = await store.pruneOldSessions('alfred', 7);
    expect(deleted).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it('pruneOldSessions returns 0 when sessions dir does not exist', async () => {
    const deleted = await store.pruneOldSessions('nonexistent-agent', 7);
    expect(deleted).toBe(0);
  });

  // Cross-agent isolation
  it('cross-agent isolation: different agents have separate session files', async () => {
    await store.appendMessage('alfred', '123', makeMsg('user', 'alfred message'));
    await store.appendMessage('baerbel', '123', makeMsg('user', 'baerbel message'));

    const alfredMsgs = await store.loadSession('alfred', '123');
    const baerbelMsgs = await store.loadSession('baerbel', '123');

    expect(alfredMsgs[0].content).toBe('alfred message');
    expect(baerbelMsgs[0].content).toBe('baerbel message');
  });
});
