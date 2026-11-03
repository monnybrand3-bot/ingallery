import assert from 'node:assert/strict';
import test from 'node:test';

const makeJwt = (payload: Record<string, unknown>): string =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

test('user sign-in does not downgrade the server database client role', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;
  const serviceRoleKey = makeJwt({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
  const userAccessToken = makeJwt({ role: 'authenticated', sub: 'test-user', exp: Math.floor(Date.now() / 1000) + 3600 });
  let databaseAuthorization = '';

  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith('/auth/v1/token')) {
      return new Response(JSON.stringify({
        access_token: userAccessToken,
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'test-refresh-token',
        user: { id: 'test-user', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      databaseAuthorization = headers.get('Authorization') ?? headers.get('authorization') ?? '';
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  try {
    const { supabase, supabaseAuth } = await import('../server/supabase.ts');
    const login = await supabaseAuth.auth.signInWithPassword({ email: 'test@example.com', password: 'test-password' });
    assert.equal(Boolean(login.data.session), true);
    const query = await supabase.from('tenant_payment_provider_settings').select('provider');
    assert.equal(query.error, null);
    assert.equal(databaseAuthorization, `Bearer ${serviceRoleKey}`);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
