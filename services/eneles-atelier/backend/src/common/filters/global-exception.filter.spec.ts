import { BadGatewayException, BadRequestException, HttpException, InternalServerErrorException, type ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

function run(exception: unknown, production: boolean) {
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = production ? 'production' : 'development';
  const filter = new GlobalExceptionFilter();
  process.env.NODE_ENV = env;
  (filter as any).logger = { error: () => {} };
  let sent: { status: number; body: any } = { status: 0, body: null };
  const response = { status: (status: number) => ({ json: (body: any) => (sent = { status, body }) }) };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: 'GET', path: '/x', ip: '::1' }) }) } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return sent;
}

describe('GlobalExceptionFilter in production', () => {
  it('keeps the message of a 4xx', () => {
    expect(run(new BadRequestException('Give the project a name'), true).body.message).toBe('Give the project a name');
  });

  it('keeps our own sentence about a dependency', () => {
    const sent = run(new BadGatewayException('The compiler refused this document: it uses \\write18.'), true);
    expect(sent.status).toBe(502);
    expect(sent.body.message).toBe('The compiler refused this document: it uses \\write18.');
  });

  it('hides a dependency error that carries network or runtime detail', () => {
    for (const text of ['connect ECONNREFUSED 10.0.3.7:3500', 'getaddrinfo ENOTFOUND compiler.railway.internal', 'Request failed with status code 500', 'fetch failed', 'boom\n    at Object.run (/app/dist/main.js:1:1)']) {
      const sent = run(new HttpException(text, 502), true);
      expect(sent.body.message).toBe('A service Eneles depends on did not answer properly. Try again in a moment.');
    }
  });

  it('hides anything nobody wrote a message for', () => {
    expect(run(new Error('column "x" does not exist'), true).body.message).not.toContain('column');
    expect(run(new InternalServerErrorException('secret detail'), true).body.message).not.toContain('secret');
    expect(run('a thrown string', true).status).toBe(500);
  });

  it('never returns database text, whatever the status', () => {
    expect(run(new BadRequestException('Invalid `this.prisma.client.user.findUnique()` invocation'), true).body.message).toBe('Something went wrong on our side. Try again in a moment.');
  });
});

describe('GlobalExceptionFilter in development', () => {
  it('returns the real message of a 5xx', () => {
    expect(run(new Error('column "x" does not exist'), false).body.message).toBe('column "x" does not exist');
  });
});
