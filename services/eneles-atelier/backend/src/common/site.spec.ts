import { siteUrls } from './site';

describe('siteUrls', () => {
  it('works every address out from the domain', () => {
    expect(siteUrls({ DOMAIN_NAME: 'eneles.org' })).toEqual({
      domain: 'eneles.org',
      frontend: 'https://eneles.org',
      api: 'https://api.eneles.org',
      admin: 'https://admin.eneles.org',
      cdn: 'https://cdn.eneles.org',
      compiler: 'https://compile.eneles.org',
    });
  });

  it('follows a development domain', () => {
    expect(siteUrls({ DOMAIN_NAME: 'Dev.Eneles.org/' })).toMatchObject({ frontend: 'https://dev.eneles.org', api: 'https://api.dev.eneles.org', cdn: 'https://cdn.dev.eneles.org' });
  });

  it('lets a variable override an address, and tidies it', () => {
    const urls = siteUrls({ DOMAIN_NAME: 'dev.eneles.org', FRONTEND_URL: 'http://localhost:2160/', COMPILER_URL: 'compiler.internal:3500' });
    expect(urls.frontend).toBe('http://localhost:2160');
    expect(urls.compiler).toBe('http://compiler.internal:3500');
    expect(urls.cdn).toBe('https://cdn.dev.eneles.org');
    expect(urls.api).toBe('https://api.dev.eneles.org');
  });

  it('knows nothing without a domain', () => {
    expect(siteUrls({})).toEqual({ domain: '', frontend: '', api: '', admin: '', cdn: '', compiler: '' });
  });
});
