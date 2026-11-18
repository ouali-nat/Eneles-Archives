import { EditSession, buildSystemPrompt, localReply } from './ai-chat.tools';

const doc =
  '\\documentclass{article}\n\\title{Old}\n\\begin{document}\nHello\n\\end{document}\n';

describe('EditSession', () => {
  it('replaces one unique occurrence and proposes it as one edit', () => {
    const s = new EditSession([{ path: 'main.tex', content: doc }]);
    expect(
      s.run('replace_in_file', {
        path: 'main.tex',
        find: 'Hello',
        replace: 'Hi',
      }).ok,
    ).toBe(true);
    expect(s.edits()).toEqual([
      {
        path: 'main.tex',
        oldContent: doc,
        newContent: doc.replace('Hello', 'Hi'),
      },
    ]);
  });

  it('refuses a find that is missing or ambiguous, and changes nothing', () => {
    const s = new EditSession([{ path: 'a.tex', content: 'x x' }]);
    expect(
      s.run('replace_in_file', { path: 'a.tex', find: 'y', replace: 'z' }).ok,
    ).toBe(false);
    expect(
      s.run('replace_in_file', { path: 'a.tex', find: 'x', replace: 'z' }).ok,
    ).toBe(false);
    expect(s.edits()).toEqual([]);
  });

  it('folds several edits to one file into a single proposal against the original', () => {
    const s = new EditSession([{ path: 'main.tex', content: doc }]);
    s.run('replace_in_file', {
      path: 'main.tex',
      find: 'Hello',
      replace: 'Hi',
    });
    s.run('replace_in_file', { path: 'main.tex', find: 'Hi', replace: 'Hey' });
    const edits = s.edits();
    expect(edits).toHaveLength(1);
    expect(edits[0].oldContent).toBe(doc);
    expect(edits[0].newContent).toContain('Hey');
  });

  it('drops a file that ends where it started', () => {
    const s = new EditSession([{ path: 'main.tex', content: doc }]);
    s.run('replace_in_file', {
      path: 'main.tex',
      find: 'Hello',
      replace: 'Hi',
    });
    s.run('replace_in_file', {
      path: 'main.tex',
      find: 'Hi',
      replace: 'Hello',
    });
    expect(s.edits()).toEqual([]);
  });

  it('creates new files with write_file', () => {
    const s = new EditSession([]);
    expect(
      s.run('write_file', { path: 'refs.bib', content: '@book{a}' }).result,
    ).toBe('File created.');
    expect(s.edits()).toEqual([
      { path: 'refs.bib', oldContent: '', newContent: '@book{a}', created: true },
    ]);
  });
});

describe('local provider', () => {
  const files = [{ path: 'main.tex', content: doc }];

  it('sets the title when asked', () => {
    const r = localReply({
      message: 'Rename the title to New results',
      files,
      activeFilePath: 'main.tex',
    });
    expect(r.edits[0].newContent).toContain('\\title{New results}');
  });

  it('reports the first compile error without editing', () => {
    const r = localReply({
      message: 'fix it',
      files,
      context: { compileErrors: 'main.tex:4: Undefined control sequence' },
    });
    expect(r.edits).toEqual([]);
    expect(r.message).toContain('Undefined control sequence');
  });

  it('otherwise adds a note after \\begin{document}', () => {
    const r = localReply({ message: 'anything', files });
    expect(r.edits[0].newContent).toContain(
      '\\begin{document}\n% Note: anything',
    );
  });
});

describe('system prompt', () => {
  it('carries compile errors and the selection when given', () => {
    const p = buildSystemPrompt({
      message: 'x',
      files: [{ path: 'main.tex', content: doc }],
      activeFilePath: 'main.tex',
      context: { compileErrors: 'E1', selection: 'S1' },
    });
    expect(p).toContain('E1');
    expect(p).toContain('S1');
    expect(p).toContain('main.tex');
  });
});

describe('reference papers', () => {
  const references = [
    {
      path: 'references/1706.03762v7/main.tex',
      content: '\\section{Attention}',
    },
  ];

  it('can be read but never changed', () => {
    const session = new EditSession(
      [{ path: 'main.tex', content: doc }],
      references,
    );
    expect(
      session.run('read_file', { path: 'references/1706.03762v7/main.tex' }),
    ).toEqual({ ok: true, result: '\\section{Attention}' });
    expect(
      session.run('replace_in_file', {
        path: 'references/1706.03762v7/main.tex',
        find: 'Attention',
        replace: 'X',
      }).ok,
    ).toBe(false);
    expect(
      session.run('write_file', { path: 'references/new.tex', content: 'x' })
        .ok,
    ).toBe(false);
    expect(session.edits()).toEqual([]);
  });

  it('are listed in the system prompt as read-only', () => {
    const p = buildSystemPrompt({
      message: 'x',
      files: [{ path: 'main.tex', content: doc }],
      references,
    });
    expect(p).toContain('references/1706.03762v7/main.tex');
    expect(p).toContain('read-only');
  });
});
