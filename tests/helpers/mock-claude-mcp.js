#!/usr/bin/env node
/**
 * Mock Claude subprocess that speaks the MCP protocol.
 *
 * Used to test the full pipeline:
 *   agent-runner → (spawns this) → reads --mcp-config → spawns MCP server (plugin)
 *   → MCP handshake → receives notifications/claude/channel → writes to stdout
 *
 * Stdout lines:
 *   [mock-claude-mcp] ready            — MCP handshake done
 *   [mock-claude-mcp] prompt: <text>   — initial prompt received from stdin
 *   [mock-claude-mcp] channel: <json>  — notifications/claude/channel received
 *   [mock-claude-mcp] tool-result: <json> — tool call response received
 *
 * Args parsed: --mcp-config <path>  (others are silently ignored)
 * Env: MOCK_CLAUDE_REPLY=1  — auto-call reply tool for each channel message
 */

const { spawn } = require('child_process')
const fs = require('fs')
const readline = require('readline')

// ── arg parsing ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
let mcpConfigPath = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--mcp-config' && i + 1 < argv.length) {
    mcpConfigPath = argv[i + 1]
    i++
  }
}

// ── MCP connection per server ─────────────────────────────────────────────────

class McpClient {
  constructor(name, proc) {
    this.name = name
    this.proc = proc
    this.buf = ''
    this.idSeq = 10
    this.pendingRequests = new Map() // id → { resolve, reject }

    proc.stdout.on('data', (chunk) => {
      this.buf += chunk.toString()
      const lines = this.buf.split('\n')
      this.buf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          this._onMessage(JSON.parse(line))
        } catch {}
      }
    })

    proc.stderr.on('data', (data) => {
      process.stderr.write(`[mock-claude-mcp:${name}] ${data}`)
    })
  }

  send(msg) {
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  request(method, params) {
    const id = ++this.idSeq
    this.send({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`MCP request '${method}' timed out`))
      }, 10000)
      this.pendingRequests.set(id, { resolve, reject, timer })
    })
  }

  _onMessage(msg) {
    // Response to a pending request
    if (msg.id != null && this.pendingRequests.has(msg.id)) {
      const { resolve, reject, timer } = this.pendingRequests.get(msg.id)
      this.pendingRequests.delete(msg.id)
      clearTimeout(timer)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }

    // Notification
    if (msg.method === 'notifications/claude/channel') {
      process.stdout.write(`[mock-claude-mcp] channel: ${JSON.stringify(msg.params)}\n`)

      // Optionally auto-reply (for deeper pipeline tests)
      if (process.env.MOCK_CLAUDE_REPLY === '1' && msg.params?.meta?.chat_id) {
        const chatId = msg.params.meta.chat_id
        const text = `[mock-claude] echo: ${msg.params.content ?? '(no text)'}`
        this.request('tools/call', {
          name: 'reply',
          arguments: { chat_id: chatId, text },
        }).then(result => {
          process.stdout.write(`[mock-claude-mcp] tool-result: ${JSON.stringify(result)}\n`)
        }).catch(err => {
          process.stderr.write(`[mock-claude-mcp] tool error: ${err.message}\n`)
        })
      }
      return
    }

    // Ignore other notifications
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mock-claude-mcp', version: '1.0.0' },
    })
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
    return result
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const clients = []

async function main() {
  // Read initial prompt from stdin (sent by agent-runner before opening channel)
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.once('line', (line) => {
    process.stdout.write(`[mock-claude-mcp] prompt: ${line.trim()}\n`)
  })

  if (!mcpConfigPath) {
    process.stderr.write('[mock-claude-mcp] no --mcp-config provided — running in stdin-echo mode\n')
    // Fallback: act like mock-claude.js (stdin echo)
    rl.on('line', (line) => {
      if (line.trim()) process.stdout.write(`[mock-claude] received: ${line}\n`)
    })
    return
  }

  let config
  try {
    config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'))
  } catch (err) {
    process.stderr.write(`[mock-claude-mcp] failed to read ${mcpConfigPath}: ${err.message}\n`)
    process.exit(1)
  }

  const servers = config.mcpServers || {}

  for (const [name, cfg] of Object.entries(servers)) {
    const { command, args: sArgs = [], env: sEnv = {} } = cfg

    const proc = spawn(command, sArgs, {
      env: { ...process.env, ...sEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    proc.on('error', (err) => {
      process.stderr.write(`[mock-claude-mcp:${name}] spawn error: ${err.message}\n`)
    })

    proc.on('exit', (code, signal) => {
      process.stderr.write(`[mock-claude-mcp:${name}] exited (code=${code} signal=${signal})\n`)
    })

    const client = new McpClient(name, proc)
    clients.push({ name, proc, client })

    try {
      await client.initialize()
      process.stdout.write(`[mock-claude-mcp] ready\n`)
    } catch (err) {
      process.stderr.write(`[mock-claude-mcp:${name}] init error: ${err.message}\n`)
    }
  }
}

main().catch(err => {
  process.stderr.write(`[mock-claude-mcp] fatal: ${err.message}\n`)
  process.exit(1)
})

// ── shutdown ─────────────────────────────────────────────────────────────────

function shutdown() {
  for (const { proc } of clients) {
    try { proc.stdin.end() } catch {}
    try { proc.kill('SIGTERM') } catch {}
  }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.stdin.on('end', shutdown)

// Keep alive
process.stdin.resume()
