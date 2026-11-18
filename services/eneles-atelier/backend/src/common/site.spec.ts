import { siteUrls } from './site';

describe('siteUrls', () => {
  it('works every address out from the domain', () => {
    expect(siteUrls({ DOMAIN_NAME: 'texer.org' })).toEqual({
      domain: 'texer.org',
      frontend: 'https://texer.org',
      api: 'https://api.texer.org',
      admin: 'https://admin.texer.org',
      cdn: 'https://cdn.texer.org',
      compiler: 'https://compile.texer.org',
    });
  });

  it('follows a development domain', () => {
    expect(siteUrls({ DOMAIN_NAME: 'Dev.Eneles.org/' })).toMatchObject({ frontend: 'https://dev.texer.org', api: 'https://api.dev.texer.org', cdn: 'https://cdn.dev.texer.org' });
  });

  it('lets a variable override an address, and tidies it', () => {
    const urls = siteUrls({ DOMAIN_NAME: 'dev.texer.org', FRONTEND_URL: 'http://localhost:2160/', COMPILER_URL: 'compiler.internal:3500' });
    expect(urls.frontend).toBe('http://localhost:2160');
    expect(urls.compiler).toBe('http://compiler.internal:3500');
    expect(urls.cdn).toBe('https://cdn.dev.texer.org');
    expect(urls.api).toBe('https://api.dev.texer.org');
  });

  it('knows nothing without a domain', () => {
    expect(siteUrls({})).toEqual({ domain: '', frontend: '', api: '', admin: '', cdn: '', compiler: '' });
  });
});
