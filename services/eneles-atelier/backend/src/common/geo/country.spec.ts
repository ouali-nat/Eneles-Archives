import { countryOf } from './country';

describe('countryOf', () => {
  it('finds the country of public IPv4 addresses', () => {
    expect(countryOf('1.0.0.1')).toBe('AU');
    expect(countryOf('8.8.8.8')).toBe('US');
  });

  it('finds the country of public IPv6 addresses', () => {
    expect(countryOf('2001:4860:4860::8888')).toBe('US');
    expect(countryOf('2001:2::1')).toBe('JP');
  });

  it('reads an IPv4 address written inside IPv6', () => {
    expect(countryOf('::ffff:1.0.0.1')).toBe('AU');
  });

  it('answers null for private, local, and malformed addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.0.1', '::1', 'fe80::1%eth0', 'not an address', '999.1.1.1', '', null, undefined]) {
      expect(countryOf(ip)).toBeNull();
    }
  });
});
