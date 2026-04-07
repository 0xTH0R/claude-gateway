#!/usr/bin/env node
/**
 * Mock claude subprocess for heartbeat integration tests.
 *
 * Behaviour (controlled by env vars):
 * - MOCK_RESPONSE: The text to emit on each message received (default: "[mock-hb] ok")
 * - MOCK_CHAT_ID:  If set (with TELEGRAM_API_BASE + TELEGRAM_BOT_TOKEN), POST sendMessage to mock Telegram
 * - Exits cleanly on SIGTERM
 */

const http = require('http');
const readline = require('readline');

const telegramApiBase = process.env.TELEGRAM_API_BASE;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.MOCK_CHAT_ID || '12345';
const mockResponse = process.env.MOCK_RESPONSE || '[mock-hb] ok';

function sendTelegramMessage(text) {
  if (!telegramApiBase || !botToken) return;

  const body = JSON.stringify({ chat_id: chatId, text });
  const url = `${telegramApiBase}/bot${botToken}/sendMessage`;
  const urlObj = new URL(url);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || 80,
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = http.request(options, (res) => { res.resume(); });
  req.on('error', () => {});
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

  // Emit the configured response
  process.stdout.write(mockResponse + '\n');

  // If HEARTBEAT_OK, do NOT send to Telegram (the gateway's suppression logic handles this;
  // we just need the subprocess to emit the right response text)
  if (mockResponse.toUpperCase().includes('HEARTBEAT_OK')) {
    return;
  }

  sendTelegramMessage(mockResponse + ' (triggered by: ' + trimmed.substring(0, 50) + ')');
});

process.on('SIGTERM', () => {
  process.exit(0);
});

process.stdin.resume();
