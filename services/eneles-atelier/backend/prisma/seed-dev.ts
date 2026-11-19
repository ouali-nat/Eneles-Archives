/**
 * Mock data for the DEVELOPMENT database, so every screen has something to show. Run it with `npm run seed:dev` from backend/.
 *
 * It only ever talks to the database named in backend/.env.development, and refuses to start when NODE_ENV is production or when DATABASE_URL in the environment is anything other than the value in that file.
 *
 * It can be run again at any time. Accounts are upserted by email, so their ids stay the same. Everything else it makes is found again by a stable key (a project uid derived from the project's name here, a template or snip title, an API key name, a payment id, a session's documentation-range IP address), deleted, and made again. Rows it did not make are left alone, including anything else the seeded accounts own and every other account.
 *
 * The LaTeX sources live as real files under prisma/seed-dev/, one folder per project, reference paper, and template, so each main.tex can be compiled with pdflatex as it is.
 *
 * Do not run it while someone has a seeded project open in the editor: the collaboration gateway would later write its in-memory copy of the document back over the fresh rows, and the comment anchors would fall back to matching by quoted text.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { config as loadEnv, parse as parseEnv } from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as Y from 'yjs';
import { PrismaClient } from '../generated/prisma';

// ───────────────────────── Safety ─────────────────────────

const BACKEND_DIR = path.resolve(__dirname, '..');
const DEV_ENV_FILE = path.join(BACKEND_DIR, '.env.development');
const DATA_DIR = path.join(__dirname, 'seed-dev');

/** The development database's URL, or an exit with the reason this run is not allowed. The URL is never printed. */
function developmentDatabaseUrl(): string {
  if (!fs.existsSync(DEV_ENV_FILE)) {
    refuse('backend/.env.development does not exist, so there is no development database to seed.');
  }
  const devEnv = parseEnv(fs.readFileSync(DEV_ENV_FILE));
  // Values already in the environment win over the file, exactly as they do for the app, which is what makes the two checks below meaningful.
  loadEnv({ path: DEV_ENV_FILE, quiet: true });

  if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    refuse('NODE_ENV is "production". This seed is for the development database only.');
  }
  if (!devEnv.DATABASE_URL) {
    refuse('backend/.env.development has no DATABASE_URL.');
  }
  if (process.env.DATABASE_URL !== devEnv.DATABASE_URL) {
    refuse('DATABASE_URL in the environment is not the one in backend/.env.development. Unset it and run again.');
  }
  return devEnv.DATABASE_URL;
}

function refuse(reason: string): never {
  console.error(`Refusing to seed: ${reason}`);
  process.exit(1);
}

function must<T>(value: T | null | undefined | false, message: string): T {
  if (value === null || value === undefined || value === false) throw new Error(message);
  return value;
}

// ───────────────────────── Helpers ─────────────────────────

const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;

/** A moment `days` ago (fractions allowed). */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * A project uid in the format of the app's own generator (generateProjectUid in src/projects/projects.service.ts: 16 characters from the same 62-letter alphabet, one byte each, taken modulo its length). That function is private to its module and draws random bytes; here the bytes come from a hash of the seed's name for the project, so the uid, and with it the project's address in the browser, is the same after every run.
 */
function seedUid(key: string): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = createHash('sha256').update(`texer-seed-dev:${key}`).digest();
  let id = '';
  for (let i = 0; i < 16; i++) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

interface TextFile {
  path: string;
  content: string;
}

/** Every file under a folder of prisma/seed-dev/, with '/'-separated paths relative to it. */
function readTree(relativeDir: string): TextFile[] {
  const root = path.join(DATA_DIR, relativeDir);
  const out: TextFile[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push({ path: rel, content: fs.readFileSync(path.join(dir, entry.name), 'utf8') });
    }
  };
  walk(root, '');
  must(
    out.some((f) => f.path === 'main.tex'),
    `${relativeDir} has no main.tex`,
  );
  return out;
}

/** Every folder the given files sit in, parents first: the same rows ProjectsService.foldersFor makes. */
function foldersFor(files: { path: string }[]): string[] {
  const folders = new Set<string>();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return [...folders].sort((a, b) => a.split('/').length - b.split('/').length);
}

/** A Yjs relative position as the editor stores it (frontend/lib/review/anchors.ts): base64 of the encoded position. `assoc` 0 sticks to the character after the index, -1 to the one before it. */
function anchorAt(ytext: Y.Text, index: number, assoc: 0 | -1): string {
  const anchor = Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, index, assoc))).toString('base64');
  must(anchor.length <= 400, 'An anchor is longer than the API accepts');
  return anchor;
}

// ───────────────────────── Accounts ─────────────────────────

type UserKey = 'razz' | 'aria' | 'kenji' | 'lena' | 'omar';

interface UserSeed {
  email: string;
  name: string;
  bio: string;
  affiliation: string;
  location: string;
  plan: 'free' | 'pro';
  memberForDays: number;
}

const USERS: Record<UserKey, UserSeed> = {
  razz: {
    email: 'razz@texer.org',
    name: 'Razz',
    bio: 'Ph.D. candidate working on spectral methods for graph learning and efficient attention. Writes everything in LaTeX.',
    affiliation: 'Institute for Computational Linguistics',
    location: 'Zurich, Switzerland',
    plan: 'pro',
    memberForDays: 205,
  },
  aria: {
    email: 'aria.nakamura@example.com',
    name: 'Aria Nakamura',
    bio: 'Postdoc in numerical methods for machine learning.',
    affiliation: 'Institute for Computational Linguistics',
    location: 'Zurich, Switzerland',
    plan: 'free',
    memberForDays: 160,
  },
  kenji: {
    email: 'kenji.watanabe@example.com',
    name: 'Kenji Watanabe',
    bio: 'Builds benchmarks for long-context language models.',
    affiliation: 'Department of Computer Science',
    location: 'Kyoto, Japan',
    plan: 'free',
    memberForDays: 120,
  },
  lena: {
    email: 'lena.fischer@example.com',
    name: 'Lena Fischer',
    bio: 'Professor of machine learning. Graphs, kernels, and randomized algorithms.',
    affiliation: 'Institute for Computational Linguistics',
    location: 'Zurich, Switzerland',
    plan: 'free',
    memberForDays: 180,
  },
  omar: {
    email: 'omar.haddad@example.com',
    name: 'Omar Haddad',
    bio: 'M.Sc. student in physics, moving into machine learning.',
    affiliation: 'Department of Physics',
    location: 'Amman, Jordan',
    plan: 'free',
    memberForDays: 75,
  },
};

// ───────────────────────── Projects ─────────────────────────

type Role = 'viewer' | 'editor';

interface ThreadSeed {
  path: string;
  /** Text that occurs in the file. The first occurrence is the commented range. */
  quote: string;
  author: UserKey;
  daysAgo: number;
  content: string;
  replies?: { author: UserKey; content: string; minutesLater: number }[];
  resolvedBy?: UserKey;
}

interface SuggestionSeed {
  path: string;
  author: UserKey;
  daysAgo: number;
  /** An insertion: text that is in the file and is marked as that person's suggested addition. */
  inserted?: string;
  /** A deletion: text that is no longer in the file, kept in the record, shown struck through just before `before`. */
  deleted?: { text: string; before: string };
}

interface HistorySeed {
  path: string;
  /** Oldest first. The last one is the file as it is now. */
  versions: { daysAgo: number; by: UserKey; label?: string; content: (current: string) => string }[];
}

interface ProjectSeed {
  /** Stable name: the uid is derived from it, and it is the folder under prisma/seed-dev/. */
  key: string;
  dir: string;
  owner: UserKey;
  title: string;
  tags?: string[];
  color?: string;
  archived?: boolean;
  createdDaysAgo: number;
  updatedDaysAgo: number;
  collaborators?: { user: UserKey; role: Role; addedDaysAgo: number }[];
  /** Pending invitations. The app gives them seven days, so `sentDaysAgo` stays well under that. */
  invitations?: { email: string; role: Role; from: UserKey; sentDaysAgo: number }[];
  threads?: ThreadSeed[];
  suggestions?: SuggestionSeed[];
  chat?: { author: UserKey; daysAgo: number; content: string }[];
  history?: HistorySeed[];
  /** Reference papers attached to this project. */
  references?: { key: string; dir: string; title: string; arxivId: string; addedBy: UserKey; addedDaysAgo: number }[];
}

const cut = (current: string, from: string): string => {
  const at = current.indexOf(from);
  must(at > 0, `History: "${from}" is not in the file`);
  return `${current.slice(0, at).trimEnd()}\n`;
};

const swap = (current: string, from: string, to: string): string => {
  must(current.includes(from), `History: "${from}" is not in the file`);
  return current.replace(from, to);
};

const PROJECTS: ProjectSeed[] = [
  {
    key: 'thesis',
    dir: 'projects/thesis',
    owner: 'razz',
    title: 'PhD Thesis: Spectral Methods for Large Sparse Graphs',
    tags: ['thesis', 'graphs'],
    color: '#6366f1',
    createdDaysAgo: 150,
    updatedDaysAgo: 0.2,
    collaborators: [
      { user: 'lena', role: 'viewer', addedDaysAgo: 41 },
      { user: 'aria', role: 'editor', addedDaysAgo: 35 },
    ],
    threads: [
      {
        path: 'chapters/introduction.tex',
        quote: 'This thesis asks when that hope is justified, and what to do when it is not.',
        author: 'lena',
        daysAgo: 6,
        content: 'This is the best sentence in the chapter. Move it to the end of the first paragraph, so the reader meets the question on the first page.',
        replies: [
          { author: 'razz', content: 'Will do. I also want to cut the paragraph on scale down to two sentences, it repeats the abstract.', minutesLater: 190 },
          { author: 'lena', content: 'Agreed. Keep the cubic cost, drop the rest.', minutesLater: 260 },
        ],
      },
      {
        path: 'chapters/methods.tex',
        quote: 'with probability at least $1 - 3p^{-p}$',
        author: 'aria',
        daysAgo: 5,
        content: 'For p = 1 this is negative, so the bound says nothing. The statement needs the assumption p >= 2.',
        replies: [
          { author: 'razz', content: 'Right. I will add it to the statement and to the first line of the proof.', minutesLater: 45 },
          { author: 'aria', content: 'I checked the appendix as well: the tail bound there already needs p >= 2, so only the statement changes.', minutesLater: 1500 },
        ],
        resolvedBy: 'aria',
      },
      {
        path: 'chapters/experiments.tex',
        quote: 'every number is the mean over ten random splits',
        author: 'lena',
        daysAgo: 3,
        content: 'Please report the standard deviation as well. The committee will ask.',
        replies: [
          { author: 'razz', content: 'I have them. Another column would make Table 4.1 too wide, so I will put them in a table in the appendix and refer to it here.', minutesLater: 75 },
        ],
      },
      {
        path: 'chapters/background.tex',
        quote: 'The eigenvalues of $\\Lap$ lie in $[0, 2]$',
        author: 'lena',
        daysAgo: 3,
        content: 'Cite Chung for this, or add the two-line proof.',
      },
    ],
    chat: [
      { author: 'lena', daysAgo: 6.1, content: 'I read chapters 1 to 3 over the weekend. My comments are in the margins. The main one is about the order of the introduction.' },
      { author: 'razz', daysAgo: 6.0, content: 'Thank you! I will go through them today.' },
      { author: 'aria', daysAgo: 5.0, content: 'The proof of Theorem 3.1 looks right to me now. One assumption is missing from the statement, see my comment.' },
      { author: 'razz', daysAgo: 4.9, content: 'Fixed. I also moved the Chebyshev lemma so that it comes before the algorithm.' },
      { author: 'lena', daysAgo: 3.0, content: 'Good. Send me chapter 4 when the new table is in.' },
      { author: 'razz', daysAgo: 2.9, content: 'Will do, I am aiming for Friday.' },
      { author: 'aria', daysAgo: 0.3, content: 'Do you want me to proofread the appendix once more before it goes to the committee?' },
    ],
    history: [
      {
        path: 'chapters/introduction.tex',
        versions: [
          { daysAgo: 21, by: 'razz', content: (c) => cut(c, '\\section{Contributions}') },
          { daysAgo: 14, by: 'razz', label: 'Sent to Lena', content: (c) => cut(c, '\\section{Outline}') },
          { daysAgo: 6.2, by: 'razz', content: (c) => swap(c, 'This thesis asks when that hope is justified, and what to do when it is not.', 'This thesis studies when truncation is justified.') },
          { daysAgo: 2, by: 'razz', content: (c) => c },
        ],
      },
      {
        path: 'main.tex',
        versions: [
          { daysAgo: 18, by: 'razz', content: (c) => swap(c, '\\appendix\n\\input{appendix/proofs}\n\n', '') },
          { daysAgo: 4.8, by: 'aria', label: 'Committee draft', content: (c) => c },
        ],
      },
    ],
  },
  {
    key: 'paper',
    dir: 'projects/paper',
    owner: 'razz',
    title: 'Block-Sparse Attention for Long-Document Summarization',
    tags: ['paper', 'nlp', 'deadline'],
    color: '#ef4444',
    createdDaysAgo: 95,
    updatedDaysAgo: 1,
    collaborators: [
      { user: 'kenji', role: 'editor', addedDaysAgo: 90 },
      { user: 'aria', role: 'editor', addedDaysAgo: 88 },
    ],
    invitations: [{ email: USERS.omar.email, role: 'viewer', from: 'razz', sentDaysAgo: 2 }],
    threads: [
      {
        path: 'main.tex',
        quote: 'improves ROUGE-L by up to 1.8 points over truncation baselines',
        author: 'kenji',
        daysAgo: 4,
        content: 'Is 1.8 right? Against BART at 1,024 tokens, Table 1 gives +1.8 on arXiv but +3.2 on GovReport. Either say "up to 3.2" or name the dataset.',
        replies: [
          { author: 'razz', content: 'Good catch, 1.8 is left over from the draft that only had arXiv. I will change it once the rerun is in.', minutesLater: 30 },
          { author: 'aria', content: 'I would write "at least 1.8", so that the claim holds on every dataset.', minutesLater: 95 },
        ],
      },
      {
        path: 'main.tex',
        quote: 'In future work we plan to apply the same pattern to multi-document inputs.',
        author: 'aria',
        daysAgo: 2,
        content: 'Could we mention speech as well? Omar asked about it at the group meeting.',
      },
      {
        path: 'sections/method.tex',
        quote: 'With $b = \\sqrt{n}$ the total is $O(n\\sqrt{n})$',
        author: 'aria',
        daysAgo: 3,
        content: 'Reviewers will ask how this compares with the O(nw) of Longformer. One sentence here would save us a rebuttal.',
        replies: [{ author: 'razz', content: 'On my list for tomorrow.', minutesLater: 400 }],
      },
      {
        path: 'sections/experiments.tex',
        quote: 'a batch size of 8',
        author: 'kenji',
        daysAgo: 9,
        content: 'It was an effective batch size of 8: batches of 2 with gradient accumulation over 4 steps. Should we say so?',
        replies: [
          { author: 'razz', content: 'Yes. It is in the appendix draft, and I will add a footnote here.', minutesLater: 20 },
          { author: 'kenji', content: 'Thanks, that covers it.', minutesLater: 55 },
        ],
        resolvedBy: 'razz',
      },
      {
        path: 'sections/related.tex',
        quote: 'Hierarchical encoders summarize sections separately and then combine them',
        author: 'razz',
        daysAgo: 7,
        content: 'This needs citations. Aria, do you have the two hierarchical summarization papers at hand?',
        replies: [{ author: 'aria', content: 'Yes, I will add them to refs.bib tonight.', minutesLater: 130 }],
      },
    ],
    suggestions: [
      { path: 'main.tex', author: 'kenji', daysAgo: 1.1, inserted: ' We release our code and pretrained checkpoints.' },
      { path: 'main.tex', author: 'kenji', daysAgo: 1.1, deleted: { text: 'simple and effective ', before: 'sparse attention pattern for long documents whose' } },
    ],
    chat: [
      { author: 'kenji', daysAgo: 9.2, content: 'The GovReport rerun finished: ROUGE-L 53.4 with the new checkpoint. The table is updated.' },
      { author: 'razz', daysAgo: 9.1, content: 'Great. I rewrote the abstract around the three-dataset result, have a look when you can.' },
      { author: 'aria', daysAgo: 8.0, content: 'Reading it now. The method section is clear. I left two comments.' },
      { author: 'kenji', daysAgo: 5.5, content: 'Do we want the ablation on block size in the main text or in the appendix?' },
      { author: 'razz', daysAgo: 5.4, content: 'Appendix. We are at eight pages already.' },
      { author: 'aria', daysAgo: 4.2, content: 'I added the two missing citations to refs.bib.' },
      { author: 'razz', daysAgo: 2.0, content: 'Thanks. The camera-ready version is due on 4 December, so let us freeze the numbers by the 27th.' },
      { author: 'kenji', daysAgo: 1.9, content: 'Works for me. I turned on suggesting for my edits to the abstract, accept what you like.' },
      { author: 'aria', daysAgo: 1.0, content: 'Same here. I am free on Thursday afternoon if we want to go through the open comments together.' },
    ],
    history: [
      {
        path: 'main.tex',
        versions: [
          { daysAgo: 24, by: 'razz', content: (c) => swap(swap(c, ' We release our code and pretrained checkpoints.', ''), 'up to 1.8 points', 'up to 1.2 points') },
          { daysAgo: 12, by: 'razz', label: 'Submitted version', content: (c) => swap(c, ' We release our code and pretrained checkpoints.', '') },
          { daysAgo: 1.1, by: 'kenji', content: (c) => c },
        ],
      },
    ],
    references: [
      { key: 'ref-attention', dir: 'references/attention', title: 'Attention Is All You Need', arxivId: '1706.03762v7', addedBy: 'razz', addedDaysAgo: 80 },
      { key: 'ref-longformer', dir: 'references/longformer', title: 'Longformer: The Long-Document Transformer', arxivId: '2004.05150v2', addedBy: 'razz', addedDaysAgo: 78 },
    ],
  },
  {
    key: 'lecture-notes',
    dir: 'projects/lecture-notes',
    owner: 'razz',
    title: 'Measure Theory: Lecture Notes',
    tags: ['notes', 'teaching'],
    color: '#14b8a6',
    createdDaysAgo: 70,
    updatedDaysAgo: 12,
  },
  {
    key: 'talk',
    dir: 'projects/talk',
    owner: 'razz',
    title: 'Group Meeting Talk: Block-Sparse Attention',
    tags: ['talk', 'nlp'],
    color: '#f59e0b',
    createdDaysAgo: 31,
    updatedDaysAgo: 25,
  },
  {
    key: 'homework',
    dir: 'projects/homework',
    owner: 'razz',
    title: 'CS 521: Homework 4',
    tags: ['homework', 'algorithms'],
    createdDaysAgo: 20,
    updatedDaysAgo: 11,
  },
  {
    key: 'cv',
    dir: 'projects/cv',
    owner: 'razz',
    title: 'Curriculum Vitae',
    tags: ['personal'],
    color: '#64748b',
    createdDaysAgo: 140,
    updatedDaysAgo: 38,
  },
  {
    key: 'tikz-notes',
    dir: 'projects/tikz-notes',
    owner: 'razz',
    title: 'TikZ Figure Notebook',
    tags: ['tikz', 'notes'],
    color: '#ec4899',
    createdDaysAgo: 60,
    updatedDaysAgo: 19,
  },
  {
    key: 'lab-report',
    dir: 'projects/lab-report',
    owner: 'razz',
    title: 'Lab Report 3: The Simple Pendulum',
    tags: ['lab', 'physics'],
    color: '#22c55e',
    createdDaysAgo: 56,
    updatedDaysAgo: 49,
    collaborators: [{ user: 'omar', role: 'editor', addedDaysAgo: 55 }],
    history: [
      {
        path: 'main.tex',
        versions: [
          { daysAgo: 27, by: 'omar', content: (c) => swap(c, 'The small-angle approximation contributes less than 0.2\\% at \\ang{10}.', '') },
          { daysAgo: 26, by: 'razz', label: 'Handed in', content: (c) => c },
        ],
      },
    ],
  },
  {
    key: 'cheat-sheet',
    dir: 'projects/cheat-sheet',
    owner: 'razz',
    title: 'Probability Cheat Sheet',
    tags: ['notes', 'probability'],
    createdDaysAgo: 86,
    updatedDaysAgo: 63,
  },
  {
    key: 'workshop-abstract',
    dir: 'projects/workshop-abstract',
    owner: 'razz',
    title: 'Workshop Abstract 2025 (old draft)',
    tags: ['paper', 'graphs'],
    archived: true,
    createdDaysAgo: 172,
    updatedDaysAgo: 88,
  },
  // Owned by collaborators.
  {
    key: 'collab-seminar',
    dir: 'projects/collab-seminar',
    owner: 'lena',
    title: 'Research Seminar: Learning on Graphs',
    tags: ['seminar'],
    color: '#8b5cf6',
    createdDaysAgo: 45,
    updatedDaysAgo: 4,
    collaborators: [
      { user: 'razz', role: 'viewer', addedDaysAgo: 44 },
      { user: 'aria', role: 'editor', addedDaysAgo: 44 },
      { user: 'kenji', role: 'viewer', addedDaysAgo: 43 },
      { user: 'omar', role: 'viewer', addedDaysAgo: 43 },
    ],
  },
  {
    key: 'collab-benchmark',
    dir: 'projects/collab-benchmark',
    owner: 'kenji',
    title: 'A Benchmark for Long-Context Language Models',
    tags: ['paper', 'benchmark'],
    color: '#0ea5e9',
    createdDaysAgo: 34,
    updatedDaysAgo: 2,
    collaborators: [
      { user: 'razz', role: 'editor', addedDaysAgo: 33 },
      { user: 'omar', role: 'editor', addedDaysAgo: 30 },
    ],
    chat: [
      { author: 'kenji', daysAgo: 3.0, content: 'I filled in Table 1 with the numbers from last night. Multi-hop at 512k is worse than I expected.' },
      { author: 'omar', daysAgo: 2.6, content: 'I can add a plot of accuracy against evidence position, it shows the dip in the middle clearly.' },
      { author: 'razz', daysAgo: 2.1, content: 'Yes please. I will write the paragraph on the task generators this week.' },
    ],
  },
  {
    key: 'collab-proposal',
    dir: 'projects/collab-proposal',
    owner: 'aria',
    title: 'Workshop Proposal: Efficient Sequence Models',
    tags: ['proposal'],
    createdDaysAgo: 9,
    updatedDaysAgo: 1,
    collaborators: [{ user: 'kenji', role: 'editor', addedDaysAgo: 8 }],
    invitations: [{ email: USERS.razz.email, role: 'editor', from: 'aria', sentDaysAgo: 1 }],
  },
];

// ───────────────────────── Templates ─────────────────────────

interface TemplateSeed {
  dir: string;
  owner: UserKey;
  name: string;
  description: string;
  category: string;
  tags: string[];
  isPublic: boolean;
  review: 'none' | 'pending' | 'approved' | 'rejected';
  reviewNote?: string;
  reviewedDaysAgo?: number;
  usageCount?: number;
  createdDaysAgo: number;
  updatedDaysAgo: number;
}

const TEMPLATES: TemplateSeed[] = [
  {
    dir: 'templates/problem-set',
    owner: 'razz',
    name: 'Weekly Problem Set',
    description: 'A header with the course, the assignment, and your name, numbered problems, and a solution environment.',
    category: 'Homework',
    tags: ['homework', 'course'],
    isPublic: false,
    review: 'none',
    createdDaysAgo: 120,
    updatedDaysAgo: 64,
  },
  {
    dir: 'templates/meeting-notes',
    owner: 'razz',
    name: 'Research Meeting Notes',
    description: 'Agenda, updates, decisions, and a checklist of action items for a weekly meeting.',
    category: 'Notes',
    tags: ['notes', 'meeting'],
    isPublic: false,
    review: 'none',
    createdDaysAgo: 98,
    updatedDaysAgo: 30,
  },
  {
    dir: 'templates/referee-report',
    owner: 'razz',
    name: 'Referee Report',
    description: 'Summary, assessment, major and minor comments, and a recommendation.',
    category: 'Letter',
    tags: ['review', 'journal'],
    isPublic: false,
    review: 'none',
    createdDaysAgo: 52,
    updatedDaysAgo: 52,
  },
  {
    dir: 'templates/lab-report',
    owner: 'razz',
    name: 'Physics Lab Report',
    description: 'Abstract, theory, method, results, and discussion, with siunitx for quantities and a table of measurements in its own file.',
    category: 'Paper',
    tags: ['lab', 'physics', 'siunitx'],
    isPublic: true,
    review: 'pending',
    createdDaysAgo: 5,
    updatedDaysAgo: 2,
  },
  {
    dir: 'templates/poster',
    owner: 'razz',
    name: 'Two-Column Research Poster',
    description: 'A plain A2 poster in two columns with colored section blocks.',
    category: 'Poster',
    tags: ['poster', 'conference'],
    isPublic: true,
    review: 'rejected',
    reviewNote: 'The description says this is a general poster template, but the source still has the title, authors, and results of one particular paper. Replace them with placeholders and send it again.',
    reviewedDaysAgo: 8,
    createdDaysAgo: 16,
    updatedDaysAgo: 15,
  },
  {
    dir: 'templates/conference-paper',
    owner: 'aria',
    name: 'Two-Column Conference Paper',
    description: 'A compact two-column article with natbib, a bibliography file, and the introduction in its own file.',
    category: 'Paper',
    tags: ['paper', 'conference', 'natbib'],
    isPublic: true,
    review: 'approved',
    reviewedDaysAgo: 70,
    usageCount: 37,
    createdDaysAgo: 74,
    updatedDaysAgo: 72,
  },
  {
    dir: 'templates/research-talk',
    owner: 'kenji',
    name: 'Minimal Research Talk',
    description: 'A quiet 16:9 Beamer deck: title, one-slide summary, problem, method, results, and takeaways.',
    category: 'Beamer',
    tags: ['beamer', 'talk', 'slides'],
    isPublic: true,
    review: 'approved',
    reviewedDaysAgo: 96,
    usageCount: 112,
    createdDaysAgo: 101,
    updatedDaysAgo: 99,
  },
  {
    dir: 'templates/seminar-handout',
    owner: 'lena',
    name: 'Seminar Handout',
    description: 'A one-page handout for presenting a paper: the main claim, key ideas, weak points, and questions for discussion.',
    category: 'Notes',
    tags: ['seminar', 'handout'],
    isPublic: true,
    review: 'approved',
    reviewedDaysAgo: 40,
    usageCount: 18,
    createdDaysAgo: 43,
    updatedDaysAgo: 42,
  },
];

// ───────────────────────── Snips ─────────────────────────

/**
 * Image-to-LaTeX conversions. Their rows normally point at an uploaded image; the development bucket cannot be written to, so these have an empty image path. The Snips list, the dashboard, and the Statistics page then show a placeholder icon. PDFs are not seeded: without a stored file their list and detail pages show "Failed to load".
 */
const SNIPS: { owner: UserKey; title: string; latex: string; tags: string[]; fileSize: number; daysAgo: number }[] = [
  {
    owner: 'razz',
    title: 'Gaussian integral (whiteboard)',
    latex: '\\[\n  \\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}\n\\]',
    tags: ['calculus', 'whiteboard'],
    fileSize: 412_608,
    daysAgo: 2,
  },
  {
    owner: 'razz',
    title: 'Sketching error bound, notebook page 14',
    latex: '\\[\n  \\left\\lVert U_k U_k^\\top - Q Q^\\top U_k U_k^\\top \\right\\rVert_2 \\le C \\sqrt{\\frac{n}{p}} \\, \\gamma^{q}\n\\]',
    tags: ['thesis', 'linear-algebra'],
    fileSize: 688_128,
    daysAgo: 6,
  },
  {
    owner: 'razz',
    title: 'Bayes theorem from lecture slides',
    latex: '\\[\n  \\mathbb{P}(A \\mid B) = \\frac{\\mathbb{P}(B \\mid A) \\, \\mathbb{P}(A)}{\\mathbb{P}(B)}\n\\]',
    tags: ['probability', 'lecture'],
    fileSize: 156_672,
    daysAgo: 15,
  },
  {
    owner: 'razz',
    title: 'Maxwell equations, textbook photo',
    latex: '\\begin{align}\n  \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} & \\nabla \\cdot \\mathbf{B} &= 0 \\\\\n  \\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t} & \\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}\n\\end{align}',
    tags: ['physics', 'lecture'],
    fileSize: 934_912,
    daysAgo: 29,
  },
  {
    owner: 'razz',
    title: 'Knapsack recurrence, homework 4',
    latex: '\\[\n  K(c) = \\max\\Bigl( K(c - 1), \\ \\max_{i \\,:\\, w_i \\le c} \\bigl( K(c - w_i) + v_i \\bigr) \\Bigr)\n\\]',
    tags: ['algorithms', 'homework'],
    fileSize: 248_832,
    daysAgo: 12,
  },
  {
    owner: 'razz',
    title: 'Fourier coefficients',
    latex: '\\[\n  a_n = \\frac{1}{\\pi} \\int_{-\\pi}^{\\pi} f(x) \\cos(nx) \\, dx, \\qquad b_n = \\frac{1}{\\pi} \\int_{-\\pi}^{\\pi} f(x) \\sin(nx) \\, dx\n\\]',
    tags: ['calculus', 'archived'],
    fileSize: 301_056,
    daysAgo: 71,
  },
  {
    owner: 'aria',
    title: 'Cauchy integral formula',
    latex: '\\[\n  f(a) = \\frac{1}{2\\pi i} \\oint_{\\gamma} \\frac{f(z)}{z - a} \\, dz\n\\]',
    tags: ['complex-analysis'],
    fileSize: 198_656,
    daysAgo: 10,
  },
];

// ───────────────────────── Account extras (Razz) ─────────────────────────

/** Conversions per month, oldest first, ending with the current month. Pro allows 300 snips and 200 PDF pages a month. */
const USAGE = [
  { snips: 38, pdfPages: 24, conversions: 44 },
  { snips: 61, pdfPages: 47, conversions: 70 },
  { snips: 54, pdfPages: 112, conversions: 68 },
  { snips: 97, pdfPages: 86, conversions: 109 },
  { snips: 143, pdfPages: 131, conversions: 158 },
  { snips: 42, pdfPages: 61, conversions: 47 },
];

/** Documentation-range addresses (RFC 5737). No real visitor can have one, which is how a later run tells these sessions from real ones. */
const SESSIONS: { user: UserKey; deviceType: string; browser: string; os: string; ipAddress: string; /** The country AuthService would have looked up from a real address. */ country: string; createdDaysAgo: number; lastActiveDaysAgo: number }[] = [
  { user: 'razz', deviceType: 'desktop', browser: 'Firefox', os: 'Linux', ipAddress: '203.0.113.24', country: 'CH', createdDaysAgo: 12, lastActiveDaysAgo: 3 },
  { user: 'razz', deviceType: 'mobile', browser: 'Safari', os: 'iOS', ipAddress: '198.51.100.7', country: 'CH', createdDaysAgo: 20, lastActiveDaysAgo: 9 },
  { user: 'razz', deviceType: 'desktop', browser: 'Chrome', os: 'macOS', ipAddress: '192.0.2.41', country: 'DE', createdDaysAgo: 5, lastActiveDaysAgo: 0.2 },
  { user: 'aria', deviceType: 'desktop', browser: 'Chrome', os: 'Windows', ipAddress: '203.0.113.80', country: 'CH', createdDaysAgo: 6, lastActiveDaysAgo: 0.05 },
  { user: 'aria', deviceType: 'tablet', browser: 'Safari', os: 'iOS', ipAddress: '198.51.100.93', country: 'JP', createdDaysAgo: 30, lastActiveDaysAgo: 14 },
  { user: 'kenji', deviceType: 'desktop', browser: 'Edge', os: 'Windows', ipAddress: '192.0.2.118', country: 'JP', createdDaysAgo: 3, lastActiveDaysAgo: 1.4 },
  { user: 'kenji', deviceType: 'mobile', browser: 'Chrome', os: 'Android', ipAddress: '203.0.113.201', country: 'US', createdDaysAgo: 9, lastActiveDaysAgo: 6 },
];

/** How much of the assistant and dictation each seeded account used on each of the last 30 days, as [chat messages, dictated clips] ranges. The rows carry the provider name below, which is how a later run finds them again. */
const AI_SEED_PROVIDER = 'anthropic (seed)';
const AI_USE: Partial<Record<UserKey, { chat: [number, number]; dictation: [number, number] }>> = {
  razz: { chat: [2, 9], dictation: [0, 4] },
  kenji: { chat: [0, 3], dictation: [0, 1] },
};

const API_KEYS = [
  { name: 'CI: thesis build', createdDaysAgo: 64, lastUsedDaysAgo: 0.4 as number | null },
  { name: 'Local scripts', createdDaysAgo: 18, lastUsedDaysAgo: null as number | null },
];

const DICTIONARY_WORDS = ['laplacian', 'eigendecomposition', 'chebyshev', 'summarizer', 'longformer', 'texer'];

const MACROS = [
  { name: 'norm', expansion: '\\left\\lVert #1 \\right\\rVert' },
  { name: 'Lap', expansion: '\\mathcal{L}' },
];

/** Pro, billed monthly, in cents (frontend/lib/plans.ts). */
const PRO_MONTHLY_CENTS = 799;

// ───────────────────────── Seeding ─────────────────────────

async function main() {
  const databaseUrl = developmentDatabaseUrl();

  // The same connection setup as PrismaService.
  const pool = new Pool({ connectionString: databaseUrl, max: 4, ssl: { rejectUnauthorized: false } });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log('Seeding the development database (backend/.env.development).');

    // ── Accounts ──
    const userIds = {} as Record<UserKey, number>;
    for (const key of Object.keys(USERS) as UserKey[]) {
      const u = USERS[key];
      const existing = await prisma.user.findUnique({ where: { email: u.email } });
      const memberSince = daysAgo(u.memberForDays);
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: {
              name: u.name,
              verified: true,
              accountStatus: 'active',
              subscriptionType: u.plan,
              // Profile text someone typed in is theirs to keep.
              bio: existing.bio ?? u.bio,
              affiliation: existing.affiliation ?? u.affiliation,
              location: existing.location ?? u.location,
              // An account made just before seeding would show usage from before it existed.
              createdAt: existing.createdAt < memberSince ? existing.createdAt : memberSince,
            },
          })
        : await prisma.user.create({
            data: {
              email: u.email,
              name: u.name,
              verified: true,
              accountStatus: 'active',
              subscriptionType: u.plan,
              bio: u.bio,
              affiliation: u.affiliation,
              location: u.location,
              createdAt: memberSince,
            },
          });
      userIds[key] = user.id;
    }
    // The main account is an administrator here, so the operators' panel can be opened in development with an emailed code.
    await prisma.user.update({ where: { id: userIds.razz }, data: { isAdmin: true } });
    const seededUserIds = Object.values(userIds);
    const razz = userIds.razz;

    // ── Remove what an earlier run made ──
    const projectUids = PROJECTS.flatMap((p) => [seedUid(p.key), ...(p.references ?? []).map((r) => seedUid(r.key))]);
    must(new Set(projectUids).size === projectUids.length, 'Two seeded projects share a uid');
    // Files, collaborators, invitations, comments, chat, history, the Yjs document, and reference papers all go with their project.
    await prisma.project.deleteMany({ where: { uid: { in: projectUids } } });
    await prisma.template.deleteMany({ where: { userId: { in: seededUserIds }, name: { in: TEMPLATES.map((t) => t.name) } } });
    await prisma.snip.deleteMany({ where: { userId: { in: seededUserIds }, imagePath: '', title: { in: SNIPS.map((s) => s.title) } } });
    await prisma.apiKey.deleteMany({ where: { userId: razz, name: { in: API_KEYS.map((k) => k.name) } } });
    await prisma.session.deleteMany({ where: { userId: { in: seededUserIds }, ipAddress: { in: SESSIONS.map((s) => s.ipAddress) } } });
    await prisma.aiUsage.deleteMany({ where: { userId: { in: seededUserIds }, provider: { endsWith: '(seed)' } } });

    // ── Projects ──
    const projectIds = new Map<string, number>();
    for (const p of PROJECTS) {
      const files = readTree(p.dir);
      const createdAt = daysAgo(p.createdDaysAgo);
      const updatedAt = daysAgo(p.updatedDaysAgo);
      const snapshots = new Map((p.history ?? []).map((h) => [h.path, h.versions.length]));

      const project = await prisma.project.create({
        data: {
          uid: seedUid(p.key),
          userId: userIds[p.owner],
          title: p.title,
          status: 'pending',
          tags: p.tags ?? [],
          color: p.color ?? null,
          archived: p.archived ?? false,
          createdAt,
          updatedAt,
          files: {
            create: [
              ...foldersFor(files).map((folder) => ({ path: folder, isFolder: true, createdAt, updatedAt: createdAt })),
              ...files.map((f) => ({
                path: f.path,
                content: f.content,
                isMain: f.path === 'main.tex',
                version: snapshots.get(f.path) ?? 0,
                createdAt,
                updatedAt: f.path === 'main.tex' ? updatedAt : createdAt,
              })),
            ],
          },
          collaborators: {
            create: (p.collaborators ?? []).map((c) => ({ userId: userIds[c.user], role: c.role, addedAt: daysAgo(c.addedDaysAgo) })),
          },
          invitations: {
            create: (p.invitations ?? []).map((inv) => {
              const sentAt = daysAgo(inv.sentDaysAgo);
              // The same token and lifetime as ProjectsService.inviteCollaborator. No email is sent.
              return { email: inv.email, role: inv.role, token: randomBytes(32).toString('hex'), status: 'pending' as const, invitedBy: userIds[inv.from], createdAt: sentAt, expiresAt: plusDays(sentAt, 7) };
            }),
          },
        },
      });
      projectIds.set(p.key, project.id);
      const contentOf = (filePath: string) => must(files.find((f) => f.path === filePath), `${p.key}: no file ${filePath}`).content;

      // Reference papers: projects of their own that point at this one, as the editor's "Add reference" makes them.
      for (const ref of p.references ?? []) {
        const refFiles = readTree(ref.dir);
        const addedAt = daysAgo(ref.addedDaysAgo);
        await prisma.project.create({
          data: {
            uid: seedUid(ref.key),
            userId: userIds[ref.addedBy],
            title: ref.title,
            status: 'pending',
            referenceOfId: project.id,
            arxivId: ref.arxivId,
            createdAt: addedAt,
            updatedAt: addedAt,
            files: {
              create: [
                ...foldersFor(refFiles).map((folder) => ({ path: folder, isFolder: true, createdAt: addedAt, updatedAt: addedAt })),
                ...refFiles.map((f) => ({ path: f.path, content: f.content, isMain: f.path === 'main.tex', createdAt: addedAt, updatedAt: addedAt })),
              ],
            },
          },
        });
      }

      // Review: comments and suggested changes are anchored in the project's Yjs document, which the collaboration gateway restores from yjs_documents when the project is opened. The document here holds each reviewed file's text, inserted the way the gateway seeds a file from the database, so the anchors name real characters in it.
      const reviewed = [...new Set([...(p.threads ?? []).map((t) => t.path), ...(p.suggestions ?? []).map((s) => s.path)])];
      if (reviewed.length > 0) {
        const doc = new Y.Doc();
        for (const filePath of reviewed) {
          const text = doc.getText(filePath);
          doc.transact(() => text.insert(0, contentOf(filePath)));
        }

        for (const t of p.threads ?? []) {
          const content = contentOf(t.path);
          const offset = content.indexOf(t.quote);
          must(offset >= 0, `${p.key}: "${t.quote}" is not in ${t.path}`);
          const text = doc.getText(t.path);
          const startedAt = daysAgo(t.daysAgo);
          const replies = (t.replies ?? []).map((r) => ({ authorId: userIds[r.author], content: r.content, createdAt: plusMinutes(startedAt, r.minutesLater) }));
          const lastAt = replies.length ? replies[replies.length - 1].createdAt : startedAt;
          const resolvedAt = t.resolvedBy ? plusMinutes(lastAt, 25) : null;
          await prisma.commentThread.create({
            data: {
              projectId: project.id,
              path: t.path,
              anchorStart: anchorAt(text, offset, 0),
              anchorEnd: anchorAt(text, offset + t.quote.length, -1),
              quote: t.quote,
              offset,
              resolved: !!t.resolvedBy,
              resolvedAt,
              resolvedById: t.resolvedBy ? userIds[t.resolvedBy] : null,
              createdById: userIds[t.author],
              createdAt: startedAt,
              updatedAt: resolvedAt ?? lastAt,
              messages: { create: [{ authorId: userIds[t.author], content: t.content, createdAt: startedAt }, ...replies] },
            },
          });
        }

        // Suggested changes are records in a map beside the text (frontend/lib/review/track-changes.ts): the file reads as if each were accepted.
        for (const s of p.suggestions ?? []) {
          const content = contentOf(s.path);
          const text = doc.getText(s.path);
          const who = { authorId: userIds[s.author], authorName: USERS[s.author].name, time: daysAgo(s.daysAgo).getTime() };
          const records = doc.getMap(`tc:${s.path}`);
          if (s.inserted) {
            const from = content.indexOf(s.inserted);
            must(from >= 0, `${p.key}: "${s.inserted}" is not in ${s.path}`);
            records.set(randomUUID(), { kind: 'insert', start: anchorAt(text, from, 0), end: anchorAt(text, from + s.inserted.length, -1), ...who });
          }
          if (s.deleted) {
            const at = content.indexOf(s.deleted.before);
            must(at > 0, `${p.key}: "${s.deleted.before}" is not in ${s.path}`);
            records.set(randomUUID(), { kind: 'delete', at: anchorAt(text, at, -1), text: s.deleted.text, ...who });
          }
        }

        const state = Buffer.from(Y.encodeStateAsUpdate(doc));
        await prisma.yjsDocument.create({ data: { projectUid: project.uid, state, sizeBytes: state.length } });
        doc.destroy();
      }

      if (p.chat?.length) {
        // Inserted oldest first: the chat pages by id.
        await prisma.projectChatMessage.createMany({
          data: [...p.chat].sort((a, b) => b.daysAgo - a.daysAgo).map((m) => ({ projectId: project.id, userId: userIds[m.author], content: m.content, createdAt: daysAgo(m.daysAgo) })),
        });
      }

      // File history: one row per save, kept for thirty days.
      for (const h of p.history ?? []) {
        const current = contentOf(h.path);
        must(h.versions[h.versions.length - 1].content(current) === current, `${p.key}: the newest snapshot of ${h.path} must be the file as it is`);
        await prisma.fileHistory.createMany({
          data: h.versions.map((v, i) => {
            const savedAt = daysAgo(v.daysAgo);
            must(v.daysAgo < 30, 'A snapshot older than thirty days would already have expired');
            return { projectId: project.id, filePath: h.path, version: i + 1, content: v.content(current), label: v.label ?? null, userId: userIds[v.by], createdAt: savedAt, expiresAt: plusDays(savedAt, 30) };
          }),
        });
      }
    }

    // ── Templates ──
    for (const t of TEMPLATES) {
      const files = readTree(t.dir);
      const extra = files.filter((f) => f.path !== 'main.tex');
      await prisma.template.create({
        data: {
          userId: userIds[t.owner],
          name: t.name,
          description: t.description,
          category: t.category,
          content: must(files.find((f) => f.path === 'main.tex'), 'no main.tex').content,
          files: extra.length ? extra.map((f) => ({ path: f.path, content: f.content })) : undefined,
          isPublic: t.isPublic,
          tags: t.tags,
          usageCount: t.usageCount ?? 0,
          review: t.review,
          reviewedAt: t.reviewedDaysAgo !== undefined ? daysAgo(t.reviewedDaysAgo) : null,
          reviewNote: t.reviewNote ?? null,
          createdAt: daysAgo(t.createdDaysAgo),
          updatedAt: daysAgo(t.updatedDaysAgo),
        },
      });
    }

    // ── Snips ──
    await prisma.snip.createMany({
      data: SNIPS.map((s) => ({
        userId: userIds[s.owner],
        title: s.title,
        imagePath: '',
        latexContent: s.latex,
        status: 'completed' as const,
        tags: s.tags,
        fileSize: s.fileSize,
        createdAt: daysAgo(s.daysAgo),
        updatedAt: daysAgo(s.daysAgo),
      })),
    });

    // ── Usage: the last six months, for the Statistics and Billing pages ──
    for (let i = 0; i < USAGE.length; i++) {
      const monthStart = new Date(NOW.getFullYear(), NOW.getMonth() - (USAGE.length - 1 - i), 1);
      const month = monthStart.getMonth() + 1;
      const year = monthStart.getFullYear();
      const counts = { snipsUsed: USAGE[i].snips, pdfPagesUsed: USAGE[i].pdfPages, conversionsUsed: USAGE[i].conversions };
      await prisma.usageRecord.upsert({
        where: { userId_month_year: { userId: razz, month, year } },
        create: { userId: razz, month, year, ...counts, createdAt: monthStart },
        update: counts,
      });

      // One Pro payment a month, on the 12th, for the months whose 12th has passed. The Billing page lists these rows as they are; nothing asks Stripe about them, and the ids say what they are.
      const paidAt = new Date(year, month - 1, 12, 9, 30);
      if (paidAt < NOW) {
        const stamp = `${year}${String(month).padStart(2, '0')}`;
        const stripePaymentId = `pi_seeddev_${stamp}_${createHash('sha256').update(`texer-seed-dev:payment:${stamp}`).digest('hex').slice(0, 8)}`;
        const payment = { userId: razz, amount: PRO_MONTHLY_CENTS, currency: 'usd', status: 'succeeded', description: 'Eneles Pro, monthly', createdAt: paidAt };
        await prisma.payment.upsert({ where: { stripePaymentId }, create: { stripePaymentId, ...payment }, update: payment });
      }
    }

    // ── Sessions: plain rows, as AuthService.completeLogin writes them. No sign-in exists for them: the cookie is a JWT signed with the server's secret, and none is issued here. ──
    await prisma.session.createMany({
      data: SESSIONS.map((s) => ({
        userId: userIds[s.user],
        token: randomBytes(48).toString('hex'),
        deviceType: s.deviceType,
        browser: s.browser,
        os: s.os,
        ipAddress: s.ipAddress,
        location: s.country,
        isActive: true,
        createdAt: daysAgo(s.createdDaysAgo),
        lastActive: daysAgo(s.lastActiveDaysAgo),
        expiresAt: plusDays(NOW, 30),
      })),
    });

    // ── AI usage: what AiUsageService records for each assistant message and dictated clip, for the admin panel. Counts only; there is no content to seed. ──
    const aiRows: { userId: number; kind: string; provider: string; model: string | null; requests: number; inputTokens: number; outputTokens: number; audioBytes: number; durationMs: number; ok: boolean; createdAt: Date }[] = [];
    for (const [key, use] of Object.entries(AI_USE) as [UserKey, NonNullable<(typeof AI_USE)[UserKey]>][]) {
      for (let day = 0; day < 30; day++) {
        // The same numbers on every run: each draw is a hash of what it is for.
        const draw = (what: string, [min, max]: [number, number]) => min + (createHash('sha256').update(`texer-seed-dev:ai:${key}:${day}:${what}`).digest().readUInt32BE(0) % (max - min + 1));
        const at = (n: number) => new Date(daysAgo(day).getTime() - draw(`at${n}`, [0, 8 * 60]) * 60_000);
        for (let n = 0; n < draw('chat', use.chat); n++) {
          const requests = draw(`r${n}`, [1, 4]);
          aiRows.push({ userId: userIds[key], kind: 'chat', provider: AI_SEED_PROVIDER, model: 'claude-sonnet-4-5', requests, inputTokens: requests * draw(`i${n}`, [2500, 14000]), outputTokens: requests * draw(`o${n}`, [150, 1400]), audioBytes: 0, durationMs: requests * draw(`d${n}`, [1800, 6500]), ok: draw(`ok${n}`, [0, 24]) !== 0, createdAt: at(n) });
        }
        for (let n = 0; n < draw('dictation', use.dictation); n++) {
          aiRows.push({ userId: userIds[key], kind: 'dictation', provider: 'speech (seed)', model: null, requests: 1, inputTokens: 0, outputTokens: 0, audioBytes: draw(`b${n}`, [40_000, 600_000]), durationMs: draw(`dd${n}`, [700, 3200]), ok: true, createdAt: at(100 + n) });
        }
      }
    }
    await prisma.aiUsage.createMany({ data: aiRows });

    // ── API keys: hashed as ApiKeysService does. The key itself is thrown away here, so nobody can use it; the rows are there for the list. ──
    for (const k of API_KEYS) {
      const key = `txr_${randomBytes(32).toString('hex')}`;
      await prisma.apiKey.create({
        data: {
          userId: razz,
          name: k.name,
          keyHash: createHash('sha256').update(key).digest('hex'),
          keyPrefix: key.substring(0, 12),
          lastUsedAt: k.lastUsedDaysAgo === null ? null : daysAgo(k.lastUsedDaysAgo),
          createdAt: daysAgo(k.createdDaysAgo),
        },
      });
    }

    // ── Editor dictionary and macros ──
    const dictionary = await prisma.userDictionary.findUnique({ where: { userId: razz } });
    const words = [...new Set([...(dictionary?.words ?? []), ...DICTIONARY_WORDS])];
    await prisma.userDictionary.upsert({ where: { userId: razz }, create: { userId: razz, words }, update: { words } });
    for (const m of MACROS) {
      await prisma.userMacro.upsert({ where: { userId_name: { userId: razz, name: m.name } }, create: { userId: razz, ...m }, update: { expansion: m.expansion } });
    }

    // ── Report ──
    const tables: [string, Promise<number>][] = [
      ['users', prisma.user.count()],
      ['projects', prisma.project.count()],
      ['  of which reference papers', prisma.project.count({ where: { referenceOfId: { not: null } } })],
      ['project_files', prisma.projectFile.count()],
      ['project_collaborators', prisma.projectCollaborator.count()],
      ['project_invitations', prisma.projectInvitation.count()],
      ['comment_threads', prisma.commentThread.count()],
      ['comment_messages', prisma.commentMessage.count()],
      ['project_chat_messages', prisma.projectChatMessage.count()],
      ['file_history', prisma.fileHistory.count()],
      ['yjs_documents', prisma.yjsDocument.count()],
      ['templates', prisma.template.count()],
      ['snips', prisma.snip.count()],
      ['pdfs', prisma.pDF.count()],
      ['usage_records', prisma.usageRecord.count()],
      ['payments', prisma.payment.count()],
      ['subscriptions', prisma.subscription.count()],
      ['api_keys', prisma.apiKey.count()],
      ['sessions', prisma.session.count()],
      ['user_dictionaries', prisma.userDictionary.count()],
      ['user_macros', prisma.userMacro.count()],
    ];
    console.log('\nAccounts:');
    for (const key of Object.keys(USERS) as UserKey[]) console.log(`  ${USERS[key].email} (id ${userIds[key]}, ${USERS[key].plan})`);
    console.log('\nRows per table, whole database:');
    for (const [name, count] of tables) console.log(`  ${name.padEnd(30)} ${await count}`);

    const [own, shared, invited] = await Promise.all([
      prisma.project.count({ where: { userId: razz, referenceOfId: null, uid: { in: projectUids } } }),
      prisma.projectCollaborator.count({ where: { userId: razz } }),
      prisma.projectInvitation.count({ where: { email: USERS.razz.email, status: 'pending' } }),
    ]);
    console.log(`\n${USERS.razz.email}: ${own} seeded projects of their own, ${shared} shared with them, ${invited} pending invitation.`);
    console.log('Done.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
