#!/usr/bin/env node
// Deterministic ACP process for interruption and same-session continuation tests.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
const root = process.env.PAPERCLIP_STOP_FIXTURE_ROOT ?? process.cwd();
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let active;
let timer;
const update = (sessionId, value) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: value } });
async function request(message) {
  fs.appendFileSync(`${root}/requests`, `${Date.now()} ${message.method}\n`);
  switch (message.method) {
    case 'initialize': return { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } }, agentInfo: { name: 'stop-fixture', version: '1' } };
    case 'session/new': {
      const sessionId = randomUUID();
      fs.writeFileSync(`${root}/session`, sessionId);
      return { sessionId };
    }
    case 'session/load':
      if (fs.readFileSync(`${root}/session`, 'utf8') !== message.params.sessionId) throw Error('Unknown session');
      return {};
    case 'session/prompt': {
      fs.appendFileSync(`${root}/prompts`, `${JSON.stringify(message.params)}\n`);
      if (fs.existsSync(`${root}/continued`)) {
        update(message.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answered the pending follow-up once.' } });
        return { stopReason: 'end_turn' };
      }
      active = message;
      if (process.env.PAPERCLIP_STOP_FIXTURE_TOOL === 'read') {
        update(message.params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'Read local file', kind: 'read', status: 'completed' });
      }
      if (process.env.PAPERCLIP_STOP_FIXTURE_TOOL === 'write') {
        update(message.params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'write-1', title: 'Write local file', kind: 'edit', status: 'in_progress' });
        timer = setInterval(() => fs.appendFileSync(`${root}/writes`, 'tick\n'), 20);
      }
      update(message.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Waiting for Stop.' } });
      return undefined;
    }
    case 'session/cancel':
      clearInterval(timer);
      fs.writeFileSync(`${root}/continued`, 'ready');
      if (active) send({ jsonrpc: '2.0', id: active.id, result: { stopReason: 'cancelled' } });
      active = undefined;
      return undefined;
    case 'session/close': clearInterval(timer); return {};
    case 'session/set_mode': case 'session/set_config_option': return {};
    default: throw Error(`Unsupported method: ${message.method}`);
  }
}
createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line);
  try {
    const result = await request(message);
    if (message.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } });
  }
});
