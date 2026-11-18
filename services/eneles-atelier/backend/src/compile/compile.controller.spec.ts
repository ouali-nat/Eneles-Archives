import { HttpException } from '@nestjs/common';
import { CompileController } from './compile.controller';

/** The public POST /compile: source compiled on Eneles's compiler, projects through the editor's own route, a signed link on success, 422 with the log on a document error. */
describe('CompileController', () => {
  const realFetch = global.fetch;
  const storage = {
    uploadBuild: jest.fn().mockResolvedValue('ok'),
    getSignedUrl: jest
      .fn()
      .mockResolvedValue('https://signed.example/build.pdf'),
  };
  const projects = { compile: jest.fn() };
  const moduleRef = { get: jest.fn().mockReturnValue(projects) };
  const res = { status: jest.fn() };
  const controller = new CompileController(
    moduleRef as never,
    storage as never,
  );

  beforeAll(() => {
    process.env.COMPILER_URL = 'http://compiler.test';
  });
  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = realFetch;
  });

  const compilerAnswers = (status: number, body: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({
      status,
      ok: status < 400,
      json: () => Promise.resolve(body),
    }) as never;
  };

  it('compiles source and answers with a signed link to the stored PDF', async () => {
    compilerAnswers(200, {
      success: true,
      pdf: Buffer.from('%PDF').toString('base64'),
      log: 'This is pdfTeX',
      errors: [],
      duration: 812,
    });
    const out = await controller.compile(
      7,
      { source: '\\documentclass{article}' },
      res as never,
    );
    expect(out).toMatchObject({
      status: 'success',
      pdf_url: 'https://signed.example/build.pdf',
      logs: 'This is pdfTeX',
      compile_time_ms: 812,
    });
    expect(storage.uploadBuild).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^api-builds\/7\//),
      'application/pdf',
    );
    expect(storage.getSignedUrl).toHaveBeenCalledWith(
      expect.any(String),
      3600,
      'builds',
    );
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { body: string },
    ];
    const sent = JSON.parse(init.body) as {
      files: unknown[];
      mainFile: string;
      engine: string;
    };
    expect(sent).toMatchObject({
      files: [{ path: 'main.tex', content: '\\documentclass{article}' }],
      mainFile: 'main.tex',
      engine: 'pdflatex',
    });
  });

  it('answers a document with errors with 422 and its log', async () => {
    compilerAnswers(200, {
      success: false,
      pdf: null,
      log: '! Undefined control sequence.',
      errors: ['Undefined control sequence'],
      duration: 300,
    });
    const out = await controller.compile(
      7,
      { source: '\\undefined' },
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(422);
    expect(out).toMatchObject({
      status: 'error',
      logs: '! Undefined control sequence.',
      compile_time_ms: 300,
    });
    expect(storage.uploadBuild).not.toHaveBeenCalled();
  });

  it('compiles a project through the editor route, with the engine asked for', async () => {
    projects.compile.mockResolvedValue({
      success: true,
      pdf: Buffer.from('%PDF').toString('base64'),
      log: 'ok',
      errors: [],
      duration: 1200,
    });
    const out = await controller.compile(
      7,
      { project_uid: 'abc', engine: 'xelatex' },
      res as never,
    );
    expect(projects.compile).toHaveBeenCalledWith(7, 'abc', {
      engine: 'xelatex',
    });
    expect(out).toMatchObject({ status: 'success' });
  });

  it('passes on a busy compiler as 429 or 503', async () => {
    compilerAnswers(503, {
      success: false,
      pdf: null,
      log: '',
      errors: ['Server is too busy, please try again later.'],
      duration: 0,
    });
    await expect(
      controller.compile(7, { source: 'x' }, res as never),
    ).rejects.toMatchObject({ status: 503 });
    compilerAnswers(429, { success: false, errors: ['Rate limit exceeded.'] });
    await expect(
      controller.compile(7, { source: 'x' }, res as never),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
