import { spawn } from 'node:child_process';
import { resetLocalCodexStatus } from './agent.js';

// Relays the official `codex login --device-auth` flow for the machine running
// this server. Callers must restrict it to a local development server: the
// resulting ChatGPT login belongs to this computer, not to a website visitor.
const state = globalThis.__atlasCodexLogin ||= { status: 'idle' };
const ansi = /\u001b\[[0-9;]*m/g;

export function localCodexAllowed(request) {
  // Next.js may rebuild request.url from its bind address, so also accept the Host the browser used.
  const hosts = [new URL(request.url).hostname, (request.headers.get('host') || '').replace(/:\d+$/, '')];
  const local = hosts.some(host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host));
  return local && (process.env.NODE_ENV !== 'production' || process.env.ATLAS_LOCAL_CODEX === '1');
}

export const loginStatus = () => ({ status: state.status, url: state.url || null, code: state.code || null, expiresAt: state.expiresAt || null, error: state.error || null });

export function startDeviceLogin() {
  if (state.status === 'pending' && state.child) return Promise.resolve(loginStatus());
  Object.assign(state, { status: 'pending', url: null, code: null, error: null, expiresAt: Date.now() + 15 * 60000, output: '' });
  return new Promise(resolve => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; resolve(loginStatus()); } };
    let child;
    try { child = spawn('codex', ['login', '--device-auth'], { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { Object.assign(state, { status: 'failed', error: error.message }); settle(); return; }
    state.child = child;
    const read = chunk => {
      state.output = (state.output + chunk.toString()).replace(ansi, '').slice(-8000);
      state.url ||= state.output.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0] || null;
      state.code ||= state.output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0] || null;
      if (state.url && state.code) settle();
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.on('error', error => { Object.assign(state, { status: 'failed', error: error.code === 'ENOENT' ? 'The Codex CLI is not installed on this computer.' : error.message }); settle(); });
    child.on('exit', code => {
      state.child = null;
      if (state.status === 'cancelled') return settle();
      if (code === 0) { state.status = 'complete'; resetLocalCodexStatus(); }
      else Object.assign(state, { status: 'failed', error: state.output.split('\n').map(line => line.trim()).filter(Boolean).at(-1) || `Codex login exited with code ${code}.` });
      settle();
    });
    setTimeout(() => { if (!settled) { Object.assign(state, { status: 'failed', error: 'Codex did not return a sign-in code.' }); child.kill(); settle(); } }, 20000);
  });
}

export function cancelDeviceLogin() {
  if (state.child) { state.status = 'cancelled'; state.child.kill(); }
  return loginStatus();
}
