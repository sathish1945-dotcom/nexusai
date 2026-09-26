import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NEXUSAI_TEST = '1';
process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.OPENROUTER_API_KEY;
const original = process.cwd();
for (const old of ['api/chat.ts', 'api/config.ts', 'api/tools/execute.ts']) assert.equal(existsSync(old), false, `Duplicate insecure handler: ${old}`);
const temporary = mkdtempSync(join(tmpdir(), 'nexusai-test-'));
process.chdir(temporary);
const { default: app } = await import('../server');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}`;
const request = async (path: string, body?: unknown, token?: string, extra = {}) => {
 const response = await fetch(base + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
  body: body === undefined ? undefined : JSON.stringify(body)
 });
 return { status: response.status, body: await response.json() };
};
try {
 assert.equal((await request('/api/config')).status, 200);
 assert.equal((await request('/api/tools/execute', {}, undefined, {'x-user-id':'victim'})).status, 401);
 assert.equal((await request('/api/tools/audit-log')).status, 401);
 const registration = await request('/api/auth/register', {email:'test@example.com',password:'SecureTestPassword123!',displayName:'Test'});
 assert.equal(registration.status, 200, JSON.stringify(registration.body));
 const login = await request('/api/auth/login', {email:'test@example.com',password:'SecureTestPassword123!'});
 assert.equal(login.status, 200);
 const token = login.body.token;
 assert.ok(token);
 const me = await request('/api/auth/me', undefined, token);
 assert.equal(me.body.user.email, 'test@example.com');
 assert.equal((await request('/api/auth/login', {email:'test@example.com',password:'incorrect'})).status, 401);
 const guest = await request('/api/auth/guest', {});
 const first = await request('/api/tools/audit-log', undefined, token);
 const second = await request('/api/tools/audit-log', undefined, guest.body.token);
 assert.notEqual(first.body.userId, second.body.userId);
 const { encryptString, decryptString } = await import('../server/crypto');
 const encrypted = encryptString('test-only-value');
 assert.equal(decryptString(encrypted), 'test-only-value');
 assert.throws(() => decryptString(encrypted.slice(0,-5)+'AAAAA'));
 console.log('PASS: config, spoofed identity rejection, register, login, wrong-password rejection, account isolation, encryption tamper rejection');
} finally {
 await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
 process.chdir(original);
 rmSync(temporary, { recursive:true, force:true });
}
