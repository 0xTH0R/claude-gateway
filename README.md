# Claude Gateway

A self-hosted multi-agent Telegram gateway. Run multiple Telegram bots — each powered by an isolated Claude agent with its own personality, memory, and scheduled behaviours.

```
Telegram Bot A ──► Claude subprocess (alfred)  ──► agent.md, soul.md, memory.md …
Telegram Bot B ──► Claude subprocess (warrior) ──► agent.md, soul.md, memory.md …
                        ↑
                  CronScheduler (heartbeat.md)
                  Monitoring (/health, /status, /ui)
```

Each agent is a long-running `claude` subprocess with an MCP-connected Telegram plugin — fully isolated workspace, token, and Telegram state.

---

## Requirements

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) v2.1.0+ installed and authenticated — channels mode is required (`claude --version`)
- [Bun](https://bun.sh) (used to run the Telegram plugin MCP server)
- A Telegram bot token per agent (from [@BotFather](https://t.me/BotFather))

---

## Quick Start

### 1. Install

```bash
git clone <repo>
cd claude-gateway
npm install
npm run build
```

### 2. Install the Telegram plugin

Registers the gateway's Telegram plugin with Claude Code, enables channels mode, and installs dependencies. Only needs to be run once.

```bash
make plugin-install
```

### 3. Create an agent

The interactive wizard handles everything — workspace files, config, bot token, and pairing:

```bash
make create-agent
```

Steps:
1. Choose an agent name
2. Describe the agent — Claude generates workspace files
3. Review and accept generated files
4. Create a Telegram bot via @BotFather and paste the token
5. Send any message to the bot to complete pairing
6. Agent sends a welcome message

### 3. Start the gateway

```bash
npm start
```

Config is auto-loaded from `~/.claude-gateway/config.json`. Bot tokens are auto-loaded from `~/.claude-gateway/agents/<id>/.env`.

---

## Workspace Files

Each agent has a workspace directory with markdown files that define its behaviour:

| File | Required | Purpose |
|------|----------|---------|
| `agent.md` | **Yes** | Core identity, rules, capabilities |
| `soul.md` | No | Tone, personality, speaking style |
| `user.md` | No | User profile and preferences |
| `tools.md` | No | Available tools and how to use them |
| `memory.md` | No | Long-term memory (auto-appended by the agent) |
| `heartbeat.md` | No | Scheduled/proactive tasks |
| `bootstrap.md` | No | One-time first-run setup (auto-deleted after) |

On startup (and on any file change), all files are assembled into `CLAUDE.md` which the Claude subprocess reads as its system prompt. Do not edit `CLAUDE.md` directly.

---

## Configuration Reference

Config lives at `~/.claude-gateway/config.json` (or set `GATEWAY_CONFIG` env var / `--config` flag).

```json
{
  "gateway": {
    "logDir": "~/.claude-gateway/logs",
    "timezone": "Asia/Bangkok"
  },
  "agents": [
    {
      "id": "alfred",
      "description": "Personal assistant",
      "workspace": "~/.claude-gateway/agents/alfred/workspace",
      "env": "",
      "telegram": {
        "botToken": "${ALFRED_BOT_TOKEN}",
        "allowedUsers": [123456789],
        "dmPolicy": "allowlist"
      },
      "claude": {
        "model": "claude-sonnet-4-6",
        "dangerouslySkipPermissions": true,
        "extraFlags": []
      },
      "heartbeat": {
        "rateLimitMinutes": 30
      }
    }
  ]
}
```

### `dmPolicy`

| Value | Behaviour |
|-------|-----------|
| `allowlist` | Only user IDs in `allowedUsers` can DM the agent |
| `open` | Anyone can DM the agent |
| `pairing` | New users DM the bot to receive a pairing code; approve with `npm run pair` |

### `dangerouslySkipPermissions`

Set to `true` for all agents running headless (no interactive terminal). Without it the agent cannot use MCP tools like sending Telegram replies.

### Bot tokens

Tokens are stored per-agent at `~/.claude-gateway/agents/<id>/.env` and auto-loaded at startup. Use `${AGENT_BOT_TOKEN}` syntax in config to reference them, or set them as shell environment variables.

---

## File Structure

### Project

```
claude-gateway/
├── Makefile                            ← make start / create-agent / pair / plugin-install
├── config.example.json                 ← config template
├── src/                                ← gateway source (TypeScript)
│   ├── index.ts                        ← entrypoint, loads config and starts agents
│   ├── agent-runner.ts                 ← spawns and manages claude subprocesses
│   ├── gateway-router.ts               ← HTTP API (/health, /status, /ui)
│   ├── cron-scheduler.ts               ← heartbeat task scheduler
│   └── workspace-loader.ts             ← assembles CLAUDE.md from workspace files
├── scripts/
│   ├── create-agent.ts                 ← interactive wizard (make create-agent)
│   ├── pair.ts                         ← approve Telegram pairing (make pair)
│   └── setup-claude-settings.js        ← enables channelsEnabled in Claude Code
└── plugins/
    ├── marketplace.json                ← plugin registry
    └── telegram/
        ├── server.ts                   ← Telegram MCP server (runs via bun)
        └── skills/
            └── access/SKILL.md         ← /telegram:access skill
```

### Agents data (`~/.claude-gateway/`)

```
~/.claude-gateway/
├── config.json                         ← gateway config
├── logs/
│   ├── alfred.log
│   └── warrior.log
└── agents/
    └── alfred/
        ├── .env                        ← bot token (auto-created by wizard)
        └── workspace/
            ├── CLAUDE.md               ← auto-generated, do not edit
            ├── agent.md
            ├── soul.md
            ├── user.md
            ├── memory.md
            ├── heartbeat.md
            └── .telegram-state/
                ├── access.json         ← allowlist and pairing state
                └── .mcp-config.json    ← auto-generated MCP config for Telegram plugin
```

---

## Heartbeat / Scheduled Tasks

Define proactive tasks in `heartbeat.md`:

```yaml
tasks:
  - name: morning-brief
    cron: "0 8 * * *"
    prompt: "Give a brief morning summary."

  - name: check-in
    interval: 6h
    prompt: "Check if there are any reminders to send."
```

- `cron` — standard 5-field cron expression
- `interval` — shorthand: `30m`, `1h`, `6h`, `1d`, `1w`
- If the agent replies with `HEARTBEAT_OK` (case-insensitive), no message is sent to Telegram
- `rateLimitMinutes` in config suppresses tasks if a proactive message was already sent recently (default: 30 min)

---

## Pairing New Users

1. Set `dmPolicy` to `pairing` in `access.json` (or in config):
   ```json
   { "dmPolicy": "pairing" }
   ```
2. Ask the user to DM the bot — they receive a 6-character pairing code
3. Approve it:
   ```bash
   npm run pair -- --agent=alfred --code=abc123
   ```
4. The bot confirms pairing within 5 seconds
5. Lock down after everyone is paired:
   ```bash
   npm run pair -- --agent=alfred --policy=allowlist
   ```

---

## Monitoring

The gateway runs an HTTP server on port 3000 (set `PORT` env var to change):

| Endpoint | Description |
|----------|-------------|
| `GET /health` | All agent IDs and running status |
| `GET /status` | JSON stats per agent |
| `GET /ui` | Live HTML dashboard (auto-refreshes every 5s) |

---

## Development

```bash
# Build TypeScript
npm run build

# Unit tests only (fast, no external deps)
npm run test:unit

# Integration tests
npm run integration

# Type check without building
npm run typecheck
```

---

## Troubleshooting

**Agent fails to start**
- Check workspace path exists and contains `agent.md`
- Check `dangerouslySkipPermissions: true` is set in config
- Check logs in `~/.claude-gateway/logs/<id>.log`

**Agent not responding to messages**
- Verify `dmPolicy` — if `allowlist`, check the user's ID is in `access.json`
- Ensure no other process is polling the same bot token (causes 409 conflict)

**Personality not applied**
- `CLAUDE.md` is auto-regenerated from workspace files on startup and on any file change
- Trigger a reload by saving any `.md` file in the workspace

**Heartbeat not firing**
- Verify `heartbeat.md` YAML is valid
- Check cron expression (5 fields: `min hour day month weekday`)
- Check rate limit — default 30 min between proactive messages
