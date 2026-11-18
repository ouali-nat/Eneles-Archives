import {
  cleanKey,
  keyTail,
  openSecret,
  redactSecrets,
  sealSecret,
  sealingKey,
} from './ai-secrets';
import { blockedAddress, checkBaseUrl, checkResolved } from './url-guard';
import { decideAccess, type AccessInput } from './ai-access';
import { normalizeModels, rankModels } from './ai-providers';
import { fitHistory } from './ai-chat.service';
import { EditSession, type ChatTurn } from './ai-chat.tools';

describe('sealing keys at rest', () => {
  const secret = 'a'.repeat(40);
  const key = sealingKey(secret)!;

  it('refuses a missing or short secret', () => {
    expect(sealingKey(undefined)).toBeNull();
    expect(sealingKey('short')).toBeNull();
    expect(sealingKey('x'.repeat(31))).toBeNull();
  });

  it('seals and opens a key, with a fresh nonce each time', () => {
    const a = sealSecret('sk-test-1234567890', key);
    const b = sealSecret('sk-test-1234567890', key);
    expect(a).not.toEqual(b);
    expect(a).not.toContain('sk-test');
    expect(openSecret(a, key)).toBe('sk-test-1234567890');
  });

  it('will not open a key that was changed or sealed under another secret', () => {
    const sealed = sealSecret('sk-test-1234567890', key);
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3], 'base64');
    body[0] ^= 1;
    expect(
      openSecret(
        [parts[0], parts[1], parts[2], body.toString('base64')].join('.'),
        key,
      ),
    ).toBeNull();
    expect(openSecret(sealed, sealingKey('b'.repeat(40))!)).toBeNull();
    expect(openSecret('garbage', key)).toBeNull();
  });

  it('cleans what was typed and keeps only the tail', () => {
    expect(cleanKey('  sk-abc  ')).toEqual({ ok: true, key: 'sk-abc' });
    expect(cleanKey('sk-a\nbc').ok).toBe(false);
    expect(cleanKey('').ok).toBe(false);
    expect(cleanKey('x'.repeat(513)).ok).toBe(false);
    expect(keyTail('sk-abcdef1234')).toBe('1234');
  });

  it('removes keys from messages before they are logged', () => {
    const text = redactSecrets(
      'Invalid API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz0123 (key=AIzaSyA1234567890abcdefghijkl)',
      'sk-proj-abcdefghijklmnopqrstuvwxyz0123',
    );
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).not.toContain('AIzaSy');
  });
});

describe('base URLs for the OpenAI-compatible provider', () => {
  it('needs https, except for localhost while developing', () => {
    expect(checkBaseUrl('https://api.example.com/v1/', true)).toEqual({
      ok: true,
      url: 'https://api.example.com/v1',
      local: false,
    });
    expect(checkBaseUrl('http://api.example.com/v1', false).ok).toBe(false);
    expect(checkBaseUrl('http://localhost:11434/v1', false)).toMatchObject({
      ok: true,
      local: true,
    });
    expect(checkBaseUrl('http://127.0.0.1:1234/v1', false)).toMatchObject({
      ok: true,
      local: true,
    });
    expect(checkBaseUrl('http://localhost:11434/v1', true).ok).toBe(false);
    expect(checkBaseUrl('https://localhost/v1', true).ok).toBe(false);
  });

  it('refuses credentials, queries, junk, and private hosts written as addresses or names', () => {
    expect(checkBaseUrl('https://user:pass@example.com/v1', false).ok).toBe(
      false,
    );
    expect(checkBaseUrl('https://example.com/v1?x=1', false).ok).toBe(false);
    expect(checkBaseUrl('not a url', false).ok).toBe(false);
    expect(checkBaseUrl('ftp://example.com', false).ok).toBe(false);
    expect(checkBaseUrl('https://169.254.169.254/latest', false).ok).toBe(
      false,
    );
    expect(checkBaseUrl('https://10.1.2.3/v1', false).ok).toBe(false);
    expect(checkBaseUrl('https://[fd00::1]/v1', false).ok).toBe(false);
    expect(checkBaseUrl('https://metadata.google.internal/v1', false).ok).toBe(
      false,
    );
    expect(checkBaseUrl('https://intranet/v1', false).ok).toBe(false);
  });

  it('knows which addresses are private, reserved, or metadata', () => {
    for (const a of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.4',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd12:3456::1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::a9fe:a9fe',
      '2002:0a00:0001::1',
    ]) {
      expect([a, blockedAddress(a)]).toEqual([a, true]);
    }
    for (const a of [
      '8.8.8.8',
      '1.1.1.1',
      '172.32.0.1',
      '2606:4700:4700::1111',
    ]) {
      expect([a, blockedAddress(a)]).toEqual([a, false]);
    }
  });

  it('checks every address a name resolves to', async () => {
    const lookup = (addresses: string[]) =>
      ((
        _h: string,
        _o: unknown,
        cb: (e: null, a: Array<{ address: string; family: number }>) => void,
      ) =>
        cb(
          null,
          addresses.map((address) => ({
            address,
            family: address.includes(':') ? 6 : 4,
          })),
        )) as never;
    expect(
      (await checkResolved('example.com', false, lookup(['93.184.216.34']))).ok,
    ).toBe(true);
    expect(
      (
        await checkResolved(
          'rebind.example',
          false,
          lookup(['93.184.216.34', '10.0.0.1']),
        )
      ).ok,
    ).toBe(false);
    expect(
      (await checkResolved('localhost', false, lookup(['127.0.0.1']))).ok,
    ).toBe(false);
    expect(
      (await checkResolved('localhost', true, lookup(['127.0.0.1']))).ok,
    ).toBe(true);
  });
});

describe('who pays for an assistant request', () => {
  const base: AccessInput = {
    keys: new Set(),
    platformEnabled: false,
    platformConfigured: true,
    planIncludesAssistant: true,
    production: true,
  };

  it('with Platform AI off, only an own key works, on every plan', () => {
    expect(decideAccess(base)).toEqual({
      ok: false,
      reason: 'no_key',
      upgrade: false,
    });
    expect(decideAccess({ ...base, keys: new Set(['openai']) })).toEqual({
      ok: true,
      source: 'own',
      provider: 'openai',
    });
    expect(
      decideAccess({
        ...base,
        planIncludesAssistant: false,
        keys: new Set(['anthropic']),
      }),
    ).toEqual({ ok: true, source: 'own', provider: 'anthropic' });
    expect(decideAccess({ ...base, requested: 'platform' })).toMatchObject({
      ok: false,
    });
  });

  it('with Platform AI on, a plan that includes the assistant may use the platform', () => {
    const on = { ...base, platformEnabled: true };
    expect(decideAccess(on)).toEqual({
      ok: true,
      source: 'platform',
      provider: 'platform',
    });
    expect(decideAccess({ ...on, planIncludesAssistant: false })).toEqual({
      ok: false,
      reason: 'no_key',
      upgrade: true,
    });
    expect(decideAccess({ ...on, platformConfigured: false })).toEqual({
      ok: false,
      reason: 'no_key',
      upgrade: false,
    });
  });

  it('an own key is used before the platform, and the chosen provider before others', () => {
    const on = {
      ...base,
      platformEnabled: true,
      keys: new Set(['openai', 'groq'] as const),
    };
    expect(decideAccess(on)).toEqual({
      ok: true,
      source: 'own',
      provider: 'openai',
    });
    expect(decideAccess({ ...on, preferred: 'groq' })).toEqual({
      ok: true,
      source: 'own',
      provider: 'groq',
    });
    expect(
      decideAccess({ ...on, requested: 'groq', preferred: 'openai' }),
    ).toEqual({ ok: true, source: 'own', provider: 'groq' });
    expect(decideAccess({ ...on, requested: 'platform' })).toEqual({
      ok: true,
      source: 'platform',
      provider: 'platform',
    });
    expect(decideAccess({ ...on, requested: 'mistral' })).toEqual({
      ok: true,
      source: 'own',
      provider: 'openai',
    });
  });

  it('the local test model exists only outside production, and only when chosen', () => {
    expect(decideAccess({ ...base, requested: 'local' })).toMatchObject({
      ok: false,
    });
    expect(
      decideAccess({ ...base, production: false, requested: 'local' }),
    ).toEqual({ ok: true, source: 'local', provider: 'local' });
    expect(decideAccess({ ...base, production: false })).toMatchObject({
      ok: false,
    });
  });
});

describe('model lists', () => {
  it('reads each provider shape and puts the suggested models first', () => {
    const openrouter = normalizeModels('openrouter', {
      data: [
        {
          id: 'x/no-tools',
          name: 'No tools',
          context_length: 8000,
          supported_parameters: ['temperature'],
        },
        {
          id: 'anthropic/claude-haiku-5.5',
          name: 'Haiku',
          context_length: 1000000,
          supported_parameters: ['tools'],
        },
      ],
    });
    expect(openrouter.find((m) => m.id === 'x/no-tools')?.tools).toBe(false);
    expect(rankModels('openrouter', openrouter)[0]).toMatchObject({
      id: 'anthropic/claude-haiku-5.5',
      suggested: 'fast',
      contextTokens: 1000000,
      tools: true,
    });
    const openai = rankModels(
      'openai',
      normalizeModels('openai', {
        data: [
          { id: 'gpt-6-luna' },
          { id: 'text-embedding-3-large' },
          { id: 'gpt-6-astra' },
          { id: 'whisper-1' },
        ],
      }),
    );
    expect(openai.map((m) => [m.id, m.suggested])).toEqual([
      ['gpt-6-astra', 'flagship'],
      ['gpt-6-luna', 'fast'],
    ]);
    const gemini = normalizeModels('gemini', {
      models: [
        {
          name: 'models/gemini-3.8-flash',
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          supportedGenerationMethods: ['generateContent'],
        },
        {
          name: 'models/embedding-001',
          supportedGenerationMethods: ['embedContent'],
        },
      ],
    });
    expect(gemini).toEqual([
      {
        id: 'gemini-3.8-flash',
        // Listed without a display name, so it gets the formatted one (model-name.ts).
        name: 'Gemini 3.8 Flash',
        contextTokens: 1048576,
        maxOutputTokens: 65536,
        tools: true,
      },
    ]);
  });
});

describe('history that fits', () => {
  it('keeps the newest turns that fit, starting with a question', () => {
    const turns: ChatTurn[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'x'.repeat(350),
    }));
    const all = fitHistory(turns, 10_000);
    expect(all).toEqual({ turns, dropped: 0 });
    const some = fitHistory(turns, 330);
    expect(some.turns[0].role).toBe('user');
    expect(some.turns.length).toBeLessThan(10);
    expect(some.dropped).toBe(10 - some.turns.length);
  });
});

describe('edit session flags', () => {
  it('marks created and deleted files', () => {
    const s = new EditSession([
      { path: 'a.tex', content: 'A' },
      { path: 'b.tex', content: 'B' },
    ]);
    s.run('write_file', { path: 'c.tex', content: 'C' });
    s.run('delete_file', { path: 'b.tex' });
    expect(s.edits()).toEqual([
      { path: 'b.tex', oldContent: 'B', newContent: '', deleted: true },
      { path: 'c.tex', oldContent: '', newContent: 'C', created: true },
    ]);
    expect(s.paths()).toEqual(['a.tex', 'c.tex']);
  });
});
