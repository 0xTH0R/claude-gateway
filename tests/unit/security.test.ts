import { isAllowed, isGroupChat } from '../../src/security';
import { AgentConfig } from '../../src/types';

function makeAgentConfig(dmPolicy: 'allowlist' | 'open', allowedUsers: number[]): AgentConfig {
  return {
    id: 'test-agent',
    description: 'Test agent',
    workspace: '/tmp/workspace',
    env: '/tmp/.env',
    telegram: {
      botToken: 'test-token',
      allowedUsers,
      dmPolicy,
    },
    claude: {
      model: 'claude-sonnet-4-6',
      dangerouslySkipPermissions: false,
      extraFlags: [],
    },
  };
}

describe('security', () => {
  // -------------------------------------------------------------------------
  // isGroupChat
  // -------------------------------------------------------------------------
  it('isGroupChat returns true for negative chatIds (group chats)', () => {
    expect(isGroupChat('-1001234567890')).toBe(true);
    expect(isGroupChat('-100')).toBe(true);
  });

  it('isGroupChat returns false for positive chatIds (DMs)', () => {
    expect(isGroupChat('991177022')).toBe(false);
    expect(isGroupChat('123456789')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // U-SEC-01: Allowed user — allowlist policy
  // -------------------------------------------------------------------------
  it('U-SEC-01: allows a user in the allowlist (allowlist policy)', () => {
    const config = makeAgentConfig('allowlist', [991177022, 111222333]);
    expect(isAllowed(991177022, config, '991177022')).toBe(true);
    expect(isAllowed(111222333, config, '111222333')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // U-SEC-02: Blocked user — allowlist policy
  // -------------------------------------------------------------------------
  it('U-SEC-02: blocks a user not in the allowlist (allowlist policy)', () => {
    const config = makeAgentConfig('allowlist', [991177022]);
    expect(isAllowed(999999999, config, '999999999')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // U-SEC-03: Open policy — any user allowed
  // -------------------------------------------------------------------------
  it('U-SEC-03: allows any user with open policy', () => {
    const config = makeAgentConfig('open', []);
    expect(isAllowed(123456789, config, '123456789')).toBe(true);
    expect(isAllowed(999999999, config, '999999999')).toBe(true);
    expect(isAllowed(0, config, '0')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // U-SEC-04: Empty allowedUsers + allowlist policy → all blocked
  // -------------------------------------------------------------------------
  it('U-SEC-04: blocks all users when allowedUsers is empty and policy is allowlist', () => {
    const config = makeAgentConfig('allowlist', []);
    expect(isAllowed(991177022, config, '991177022')).toBe(false);
    expect(isAllowed(111222333, config, '111222333')).toBe(false);
    expect(isAllowed(0, config, '0')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // U-SEC-05: Group chat — allowlist policy — always allowed
  // -------------------------------------------------------------------------
  it('U-SEC-05: allows group chat messages regardless of allowlist policy', () => {
    const config = makeAgentConfig('allowlist', [991177022]);
    // A user NOT in the allowlist, but in a group chat
    expect(isAllowed(999999999, config, '-1001234567890')).toBe(true);
  });

  it('allows group chat even with empty allowedUsers', () => {
    const config = makeAgentConfig('allowlist', []);
    expect(isAllowed(999999999, config, '-1001234567890')).toBe(true);
  });

  it('allows group chat with open policy too', () => {
    const config = makeAgentConfig('open', []);
    expect(isAllowed(999999999, config, '-1001234567890')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // isAllowed without chatId (falls back to userId-only check)
  // -------------------------------------------------------------------------
  it('isAllowed without chatId respects dmPolicy open', () => {
    const config = makeAgentConfig('open', []);
    expect(isAllowed(123, config)).toBe(true);
  });

  it('isAllowed without chatId respects dmPolicy allowlist', () => {
    const config = makeAgentConfig('allowlist', [123]);
    expect(isAllowed(123, config)).toBe(true);
    expect(isAllowed(456, config)).toBe(false);
  });
});
