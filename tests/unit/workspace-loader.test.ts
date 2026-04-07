import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { loadWorkspace, deleteBootstrap, MissingRequiredFileError } from '../../src/workspace-loader';

const FIXTURES = path.join(__dirname, '../fixtures/workspaces');

describe('workspace-loader', () => {
  // -------------------------------------------------------------------------
  // U-WL-01: Load all 7 workspace files
  // -------------------------------------------------------------------------
  it('U-WL-01: loads all 7 workspace files and returns a system prompt', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'valid-full'));
    expect(result.systemPrompt).toBeTruthy();
    expect(result.files.agentMd).toContain('Alfred');
    expect(result.files.soulMd).toContain('Tone');
    expect(result.files.toolsMd).toContain('Tools');
    expect(result.files.userMd).toContain('User Profile');
    expect(result.files.heartbeatMd).toContain('morning-brief');
    expect(result.files.memoryMd).toContain('Memory');
    expect(result.files.bootstrapMd).toContain('Bootstrap');
  });

  // -------------------------------------------------------------------------
  // U-WL-02: Missing optional file (bootstrap.md)
  // -------------------------------------------------------------------------
  it('U-WL-02: missing optional bootstrap.md does not throw', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'valid-no-bootstrap'));
    expect(result.files.bootstrapMd).toBeNull();
    expect(result.systemPrompt).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // U-WL-03: Missing required file (agent.md)
  // -------------------------------------------------------------------------
  it('U-WL-03: throws MissingRequiredFileError when agent.md is absent', async () => {
    await expect(loadWorkspace(path.join(FIXTURES, 'missing-agent-md'))).rejects.toThrow(
      MissingRequiredFileError
    );
  });

  // -------------------------------------------------------------------------
  // U-WL-04: File exceeds 20,000 char limit
  // -------------------------------------------------------------------------
  it('U-WL-04: truncates files exceeding 20,000 characters', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'oversized'));
    // memory.md has 25,000+ chars — should be truncated
    expect(result.files.memoryMd.length).toBeLessThanOrEqual(20_000 + 60); // +marker length
    expect(result.files.memoryMd).toContain('[TRUNCATED');
    expect(result.truncated).toBe(true);
  });

  // -------------------------------------------------------------------------
  // U-WL-05: Total context exceeds 150,000 chars
  // Note: With 6 workspace files capped at 20,000 chars each, the practical
  // maximum assembled prompt is ~120,500 chars (content + section headers).
  // The 150,000 total cap is a safety net for future additional files.
  // This test verifies the cap enforcement logic by checking that the result
  // prompt length is always ≤ 150,000 + truncation-marker length regardless
  // of input size, and that per-file truncation is correctly reported.
  // -------------------------------------------------------------------------
  it('U-WL-05: system prompt never exceeds total limit (per-file truncation keeps total under 150k)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
    try {
      // Each file is 25,000 chars — will be individually truncated to 20,000
      fs.writeFileSync(path.join(tmpDir, 'agent.md'), '# Agent\n' + 'A'.repeat(25_000));
      fs.writeFileSync(path.join(tmpDir, 'soul.md'), 'S'.repeat(25_000));
      fs.writeFileSync(path.join(tmpDir, 'tools.md'), 'T'.repeat(25_000));
      fs.writeFileSync(path.join(tmpDir, 'user.md'), 'U'.repeat(25_000));
      fs.writeFileSync(path.join(tmpDir, 'memory.md'), 'M'.repeat(25_000));
      fs.writeFileSync(path.join(tmpDir, 'heartbeat.md'), 'H'.repeat(25_000));

      const result = await loadWorkspace(tmpDir);
      // Total must never exceed 150,000 + marker length
      expect(result.systemPrompt.length).toBeLessThanOrEqual(150_000 + 60);
      // Per-file truncation means truncated flag is set
      expect(result.truncated).toBe(true);
      // Each file must have been truncated
      expect(result.files.agentMd).toContain('[TRUNCATED');
      expect(result.files.soulMd).toContain('[TRUNCATED');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // U-WL-06: System prompt section ordering
  // -------------------------------------------------------------------------
  it('U-WL-06: system prompt has correct section order', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'valid-full'));
    const prompt = result.systemPrompt;

    const agentIdx = prompt.indexOf('--- AGENT IDENTITY ---');
    const soulIdx = prompt.indexOf('--- SOUL ---');
    const userIdx = prompt.indexOf('--- USER PROFILE ---');
    const toolsIdx = prompt.indexOf('--- AVAILABLE TOOLS ---');
    const memoryIdx = prompt.indexOf('--- LONG-TERM MEMORY ---');
    const heartbeatIdx = prompt.indexOf('--- HEARTBEAT CONFIG ---');

    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(soulIdx).toBeGreaterThan(agentIdx);
    expect(userIdx).toBeGreaterThan(soulIdx);
    expect(toolsIdx).toBeGreaterThan(userIdx);
    expect(memoryIdx).toBeGreaterThan(toolsIdx);
    expect(heartbeatIdx).toBeGreaterThan(memoryIdx);
  });

  // -------------------------------------------------------------------------
  // U-WL-07: Section headers present
  // -------------------------------------------------------------------------
  it('U-WL-07: system prompt contains all section headers', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'valid-full'));
    expect(result.systemPrompt).toContain('--- AGENT IDENTITY ---');
    expect(result.systemPrompt).toContain('--- SOUL ---');
    expect(result.systemPrompt).toContain('--- USER PROFILE ---');
    expect(result.systemPrompt).toContain('--- AVAILABLE TOOLS ---');
    expect(result.systemPrompt).toContain('--- LONG-TERM MEMORY ---');
    expect(result.systemPrompt).toContain('--- HEARTBEAT CONFIG ---');
  });

  // -------------------------------------------------------------------------
  // U-WL-08: Empty optional file
  // -------------------------------------------------------------------------
  it('U-WL-08: empty optional files are included without error', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'agent.md'), '# Agent\nMinimal agent.');
      fs.writeFileSync(path.join(tmpDir, 'soul.md'), ''); // empty

      const result = await loadWorkspace(tmpDir);
      expect(result.files.soulMd).toBe('');
      expect(result.systemPrompt).toContain('--- SOUL ---');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // U-WL-09: isFirstRun = true when bootstrap.md exists
  // -------------------------------------------------------------------------
  it('U-WL-09: sets isFirstRun=true when bootstrap.md exists', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'valid-full'));
    expect(result.files.isFirstRun).toBe(true);
    expect(result.files.bootstrapMd).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // U-WL-10: isFirstRun = false when bootstrap.md absent
  // -------------------------------------------------------------------------
  it('U-WL-10: sets isFirstRun=false when bootstrap.md is absent', async () => {
    const result = await loadWorkspace(path.join(FIXTURES, 'valid-no-bootstrap'));
    expect(result.files.isFirstRun).toBe(false);
    expect(result.files.bootstrapMd).toBeNull();
  });

  // -------------------------------------------------------------------------
  // deleteBootstrap helper
  // -------------------------------------------------------------------------
  it('deleteBootstrap removes bootstrap.md from disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'agent.md'), '# Agent');
      fs.writeFileSync(path.join(tmpDir, 'bootstrap.md'), '# Bootstrap');

      expect(fs.existsSync(path.join(tmpDir, 'bootstrap.md'))).toBe(true);
      await deleteBootstrap(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'bootstrap.md'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('deleteBootstrap is idempotent when bootstrap.md does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
    try {
      // Should not throw even if file is absent
      await expect(deleteBootstrap(tmpDir)).resolves.toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
