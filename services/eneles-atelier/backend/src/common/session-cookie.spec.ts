import {
  SESSION_COOKIE,
  cookieRequestAllowed,
  readCookie,
  tokenFromHeaders,
} from './session-cookie';

describe('session cookie', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.DOMAIN_NAME = 'texer.org';
  });
  afterAll(() => {
    process.env = env;
  });

  it('reads one cookie out of a header', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=abc.def; b=2`, SESSION_COOKIE)).toBe('abc.def');
    expect(readCookie('a=1', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(`${SESSION_COOKIE}=%E0%A4%A`, SESSION_COOKIE)).toBeUndefined();
  });

  it('prefers an explicit Bearer header over the cookie', () => {
    expect(
      tokenFromHeaders({ authorization: 'Bearer head', cookie: `${SESSION_COOKIE}=jar` }),
    ).toEqual({ token: 'head', via: 'header' });
    expect(tokenFromHeaders({ cookie: `${SESSION_COOKIE}=jar` })).toEqual({ token: 'jar', via: 'cookie' });
    expect(tokenFromHeaders({ authorization: 'Basic x' })).toBeNull();
  });

  it('lets cookie requests change things only from our own origins', () => {
    expect(cookieRequestAllowed('GET', {})).toBe(true);
    expect(cookieRequestAllowed('POST', { origin: 'https://texer.org' })).toBe(true);
    expect(cookieRequestAllowed('DELETE', { origin: 'https://api.texer.org' })).toBe(true);
    expect(cookieRequestAllowed('POST', {})).toBe(false);
    expect(cookieRequestAllowed('POST', { origin: 'null' })).toBe(false);
    expect(cookieRequestAllowed('PUT', { origin: 'https://evil.example' })).toBe(false);
    expect(cookieRequestAllowed('POST', { origin: 'https://texer.org.evil.example' })).toBe(false);
    expect(cookieRequestAllowed('POST', { origin: 'http://localhost:2160' })).toBe(false);
  });
});
