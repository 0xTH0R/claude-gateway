#!/usr/bin/env node
/**
 * Mock claude subprocess for integration tests.
 *
 * Behaviour:
 * - Reads lines from stdin
 * - For each non-empty line, writes "[mock-claude] received: <line>" to stdout
 * - If TELEGRAM_API_BASE and TELEGRAM_BOT_TOKEN are set, POSTs the reply to sendMessage
 * - Exits cleanly on SIGTERM
 */

const http = require('http');
const https = require('https');
const readline = require('readline');

const telegramApiBase = process.env.TELEGRAM_API_BASE;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
// CHAT_ID can be provided to simulate sending back to a specific chat
const chatId = process.env.MOCK_CHAT_ID || '12345';

function sendTelegramMessage(text) {
  if (!telegramApiBase || !botToken) return;

  const body = JSON.stringify({ chat_id: chatId, text });
  const url = `${telegramApiBase}/bot${botToken}/sendMessage`;

  const isHttps = url.startsWith('https://');
  const lib = isHttps ? https : http;

  const urlObj = new URL(url);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = lib.request(options, (res) => {
    // consume response
    res.resume();
  });
  req.on('error', () => {
    // ignore errors in mock
  });
  req.write(body);
  req.end();
}

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  // If the line is a stream-json user turn, extract the text content.
  // This mirrors the --input-format stream-json format that agent-runner now uses.
  let text = trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === 'user' && parsed.message?.content?.[0]?.text) {
      text = parsed.message.content[0].text;
    }
  } catch {}

  const reply = `[mock-claude] received: ${text}`;
  process.stdout.write(reply + '\n');

  sendTelegramMessage(reply);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Keep alive
process.stdin.resume();
