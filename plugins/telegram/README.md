# Claude Gateway — Telegram Plugin

A custom Telegram channel plugin for Claude Gateway. Based on the official `claude-plugins-official/telegram` plugin, adapted for multi-agent operation where each agent has its own bot token and isolated state directory.

## Overview

- Bridges Telegram DMs and groups to Claude Code sessions via MCP
- Access control: pairing codes, allowlists, group policies
- Each gateway agent runs its own plugin instance with a separate bot token and state
- Token and state dir are injected via MCP config `env` block — no `.env` file needed

## Dependencies

- `grammy` ^1.21.0 — Telegram Bot API client
- `@modelcontextprotocol/sdk` ^1.0.0 — MCP server SDK

## Configuration

The plugin is launched automatically by `agent-runner.ts`. The MCP config written per agent looks like:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "bun",
      "args": ["/path/to/plugins/telegram/server.ts"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "123456789:AAH...",
        "TELEGRAM_STATE_DIR": "/path/to/workspace/.telegram-state"
      }
    }
  }
}
```

### Required environment variables

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_STATE_DIR` | Per-agent state directory (access.json, inbox/, approved/) |

Both are required. The plugin exits with an error if either is missing.

## Pairing Guide (multi-agent)

Because the gateway runs headless (no interactive terminal per agent), pairing must be done externally. There are two methods:

### Method 1 — Gateway Pair Script (recommended)

```bash
npm run pair -- --agent=my-agent --code=abc123
```

The script (`scripts/pair.ts`):
1. Reads the gateway config to find the agent's workspace path
2. Opens `{workspace}/.telegram-state/access.json`
3. Verifies the code exists in `pending` and is not expired
4. Adds `senderId` to `allowFrom`
5. Writes `{workspace}/.telegram-state/approved/<senderId>` (content = chatId)
6. Saves `access.json`

The plugin polls the `approved/` directory every 5 seconds and sends "Paired! Say hi to Claude." when it detects the file.

### Method 2 — Claude Session with TELEGRAM_STATE_DIR env

Open a Claude Code session with the correct state dir, then run the skill:

```bash
TELEGRAM_STATE_DIR=~/.claude-gateway/agents/my-agent/workspace/.telegram-state claude
```

Then in the Claude session:

```
/telegram:access pair <code>
```

The `SKILL.md` included in this plugin reads `TELEGRAM_STATE_DIR` before falling back to the default `~/.claude/channels/telegram/` path.

## Adding New Users After Gateway Is Running

1. (Optional) Enable pairing mode if the agent is in allowlist mode:

   ```bash
   npm run pair -- --agent=my-agent --policy=pairing
   ```
   Or edit `{workspace}/.telegram-state/access.json` and set `"dmPolicy": "pairing"`.

2. Ask the user to DM the bot (`@YourBotUsername`) — they will receive a pairing code.

3. Run the pair script with the code they receive:

   ```bash
   npm run pair -- --agent=my-agent --code=<code>
   ```

4. The bot will confirm pairing within 5 seconds.

## Differences from Official Plugin

| Feature | Official Plugin | Gateway Plugin |
|---|---|---|
| Token source | `{STATE_DIR}/.env` file | `TELEGRAM_BOT_TOKEN` env (MCP config injects it) |
| State dir | `~/.claude/channels/telegram/` | `TELEGRAM_STATE_DIR` env (required, no fallback) |
| STATIC mode | Supported (`TELEGRAM_ACCESS_MODE=static`) | Removed (gateway manages lifecycle) |
| `.env` loading | Reads and parses `.env` at startup | Not needed — env already injected |
| Skill paths | Hardcoded `~/.claude/channels/telegram/` | STATE_DIR-aware (reads `TELEGRAM_STATE_DIR` env) |
| Deployment | Single global instance | One instance per agent, fully isolated |

Everything else is identical to the official plugin: Grammy long polling, 409 Conflict retry, MCP channel/permission capabilities, all message types, tools, inline keyboard permission relay, bot commands.
