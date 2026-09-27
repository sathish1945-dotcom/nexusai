import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NEXUSAI_TEST = '1';
process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.OPENROUTER_API_KEY;
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/integrations/google/callback';
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
 assert.equal((await request('/api/integrations/google/oauth-url')).status, 401);
 assert.equal((await request('/api/integrations/google/oauth-url?connectorId=github', undefined, token)).status, 400);
 const oauth = await request('/api/integrations/google/oauth-url?connectorId=all', undefined, token);
 assert.equal(oauth.status, 200);
 const consent = new URL(oauth.body.url);
 assert.equal(consent.searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
 assert.equal(consent.searchParams.get('access_type'), 'offline');
 const realFetch = globalThis.fetch;
 let exchanges = 0;
 let granted = consent.searchParams.get('scope')!;
 globalThis.fetch = (async (input: any, init?: any) => {
   const url = String(input);
   if (url === 'https://oauth2.googleapis.com/token') {
     exchanges++;
     assert.equal(init.body.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
     return Response.json({access_token:'mock-access',refresh_token:'mock-refresh',expires_in:3600,scope:granted});
   }
   if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') return Response.json({email:'test@example.com'});
   return realFetch(input, init);
 }) as typeof fetch;
 try {
   const callback = (state: string) => fetch(base + '/api/integrations/google/callback?code=test&state=' + encodeURIComponent(state), {redirect:'manual'});
   assert.match((await callback('forged')).headers.get('location')!, /oauth_error/);
   assert.equal(exchanges, 0);
   assert.match((await callback(oauth.body.state)).headers.get('location')!, /integration_connected=all/);
   const connected = await request('/api/integrations', undefined, token);
   const isolated = await request('/api/integrations', undefined, guest.body.token);
   const { dbGetUserIntegration } = await import('../server/db');
   for (const id of ['gmail','google_calendar','google_drive']) {
     assert.equal(connected.body.connectors.find((c: any) => c.id === id).connected, true);
     assert.equal(isolated.body.connectors.find((c: any) => c.id === id).connected, false);
     const record = await dbGetUserIntegration(me.body.user.id, id);
     assert.ok(record?.encryptedRefreshToken);
     assert.notEqual(record?.encryptedAccessToken, 'mock-access');
   }
   assert.match((await callback(oauth.body.state)).headers.get('location')!, /oauth_error/);
   assert.equal(exchanges, 1);
   const partial = await request('/api/integrations/google/oauth-url?connectorId=all', undefined, guest.body.token);
   granted = 'openid email';
   assert.match((await callback(partial.body.state)).headers.get('location')!, /oauth_error/);
   const denied = await request('/api/integrations', undefined, guest.body.token);
   assert.equal(denied.body.connectors.some((c: any) => c.connected), false);
 } finally { globalThis.fetch = realFetch; }
 console.log('PASS: authenticated OAuth, custom callback URL, suite token persistence, encrypted refresh tokens, tenant isolation, forged/replayed state rejection, denied scopes');
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
