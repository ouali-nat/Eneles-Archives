import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

export interface Reference {
  key: string;
  bibtex: string;
  source: 'doi' | 'arxiv';
  title?: string;
}

/** Registries doi.org hands citation requests to. Nothing else is fetched. */
const DOI_HOSTS = new Set([
  'doi.org',
  'dx.doi.org',
  'data.crossref.org',
  'api.crossref.org',
  'data.datacite.org',
  'data.crosscite.org',
  'api.datacite.org',
  'data.medra.org',
  'data.jalc.org',
  'data.chinadoi.cn',
]);

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Text that is safe inside a BibTeX field's braces. */
function field(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s.replace(/\s+/g, ' ').trim()) {
    if (ch === '{') depth++;
    if (ch === '}') {
      if (depth === 0) continue;
      depth--;
    }
    out += ch;
  }
  return out + '}'.repeat(depth);
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'on',
  'of',
  'in',
  'for',
  'and',
  'to',
  'with',
  'from',
  'by',
  'at',
]);

/** knuth1984literate: first author's surname, year, first real word of the title. */
export function citationKey(
  author: string,
  year: string,
  title: string,
): string {
  const first = author.split(/\s+and\s+/i)[0] ?? '';
  const surname = (
    first.includes(',')
      ? first.split(',')[0]
      : (first.trim().split(/\s+/).pop() ?? '')
  )
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase();
  const word =
    title
      .normalize('NFD')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .find((w) => w && !STOP.has(w)) ?? '';
  return `${surname || 'ref'}${year.slice(0, 4)}${word}`.slice(0, 60);
}

/** One field per line, the way people keep their .bib files. */
export function formatBibtex(
  type: string,
  key: string,
  fields: [string, string][],
): string {
  const width = Math.max(...fields.map(([k]) => k.length));
  const body = fields
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `  ${k.padEnd(width)} = {${field(v)}}`)
    .join(',\n');
  return `@${type}{${key},\n${body}\n}\n`;
}

/** Split a one-line BibTeX entry, as registries send it, into its parts. */
export function parseBibtex(
  text: string,
): { type: string; key: string; fields: [string, string][] } | null {
  const head = /^\s*@(\w+)\s*\{\s*([^,\s]*)\s*,/.exec(text);
  if (!head) return null;
  const fields: [string, string][] = [];
  let i = head[0].length;
  while (i < text.length) {
    const m = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
    m.lastIndex = i;
    const name = m.exec(text);
    if (!name) break;
    i = m.lastIndex;
    let value: string;
    if (text[i] === '{') {
      let depth = 0;
      const start = i;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) break;
      }
      value = text.slice(start + 1, i);
      i++;
    } else if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      value = text.slice(i + 1, end);
      i = end + 1;
    } else {
      const w = /[^,}\s]+/y;
      w.lastIndex = i;
      value = w.exec(text)?.[0] ?? '';
      i = w.lastIndex;
    }
    fields.push([name[1].toLowerCase(), value]);
    const comma = /\s*,?/y;
    comma.lastIndex = i;
    comma.exec(text);
    i = comma.lastIndex;
  }
  return { type: head[1].toLowerCase(), key: head[2], fields };
}

/**
 * Turns a DOI or an arXiv identifier into a BibTeX entry. DOIs go to
 * doi.org, which answers with the registry's citation data; arXiv IDs to the
 * arXiv API. Only those services are contacted.
 */
@Injectable()
export class ReferencesService {
  private readonly logger = new Logger(ReferencesService.name);
  private readonly cache = new Map<string, Reference>();

  /** What kind of identifier this is, cleaned up. */
  identify(input: string): { kind: 'doi' | 'arxiv'; id: string } | null {
    const s = input.trim().replace(/^<|>$/g, '');
    const doi =
      /(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)/i.exec(s);
    if (doi && !/arxiv\.org/i.test(s))
      return {
        kind: 'doi',
        id: decodeURIComponent(doi[1]).replace(/[.,;]+$/, ''),
      };
    const arxiv =
      /(?:arxiv:\s*|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)?((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?$/i.exec(
        s,
      );
    if (arxiv) return { kind: 'arxiv', id: arxiv[1] };
    return null;
  }

  async lookup(input: string): Promise<Reference> {
    const what = this.identify(input);
    if (!what)
      throw new BadRequestException(
        'Enter a DOI (10.…) or an arXiv ID (2401.01234)',
      );
    const cacheKey = `${what.kind}:${what.id.toLowerCase()}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return hit;
    const ref =
      what.kind === 'doi'
        ? await this.fromDoi(what.id)
        : await this.fromArxiv(what.id);
    const oldest = this.cache.keys().next();
    if (this.cache.size > 500 && !oldest.done) this.cache.delete(oldest.value);
    this.cache.set(cacheKey, ref);
    return ref;
  }

  private async fetchDoi(doi: string): Promise<string> {
    let url = `https://doi.org/${encodeURI(doi)}`;
    for (let hop = 0; hop < 5; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !DOI_HOSTS.has(parsed.hostname)) {
        throw new NotFoundException(
          "That DOI's registry does not provide citation data",
        );
      }
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Accept: 'application/x-bibtex; charset=utf-8',
            'User-Agent': 'Eneles (https://texer.org)',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        throw new HttpException(
          'The DOI service could not be reached. Try again in a moment.',
          HttpStatus.BAD_GATEWAY,
        );
      }
      if (
        res.status >= 300 &&
        res.status < 400 &&
        res.headers.get('location')
      ) {
        url = new URL(res.headers.get('location')!, url).toString();
        continue;
      }
      if (res.status === 404)
        throw new NotFoundException('No publication has that DOI');
      if (!res.ok)
        throw new HttpException(
          'The DOI service did not answer. Try again in a moment.',
          HttpStatus.BAD_GATEWAY,
        );
      const text = await res.text();
      if (!text.trim().startsWith('@'))
        throw new NotFoundException(
          "That DOI's registry does not provide citation data",
        );
      return text;
    }
    throw new NotFoundException(
      "That DOI's registry does not provide citation data",
    );
  }

  private async fromDoi(doi: string): Promise<Reference> {
    const parsed = parseBibtex(await this.fetchDoi(doi));
    if (!parsed)
      throw new NotFoundException("That DOI's citation data could not be read");
    const get = (k: string) => parsed.fields.find(([n]) => n === k)?.[1] ?? '';
    const key = citationKey(get('author'), get('year'), get('title'));
    // Registries add their own url to doi.org; the doi field already says it.
    const order = [
      'author',
      'title',
      'journal',
      'booktitle',
      'publisher',
      'year',
      'volume',
      'number',
      'pages',
      'doi',
      'isbn',
      'issn',
    ];
    const fields = parsed.fields
      .filter(
        ([n]) =>
          !['month', 'keywords', 'copyright', 'abstract', 'language'].includes(
            n,
          ),
      )
      .filter(([n]) => n !== 'url' || !/doi\.org/i.test(get('url')))
      .sort(
        ([a], [b]) =>
          (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
      );
    return {
      key,
      bibtex: formatBibtex(parsed.type, key, fields),
      source: 'doi',
      title: get('title'),
    };
  }

  private async fromArxiv(id: string): Promise<Reference> {
    let xml: string;
    try {
      const res = await fetch(
        `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
        {
          headers: { 'User-Agent': 'Eneles (https://texer.org)' },
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      xml = await res.text();
    } catch {
      throw new HttpException(
        'arXiv could not be reached. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
    const title =
      entry &&
      decodeXml(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!entry || !title || /^Error$/i.test(title))
      throw new NotFoundException('arXiv has no paper with that ID');
    const authors = [
      ...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g),
    ].map((m) => {
      const name = decodeXml(m[1]).trim();
      const parts = name.split(/\s+/);
      return parts.length > 1 ? `${parts.pop()}, ${parts.join(' ')}` : name;
    });
    const year = /<published>(\d{4})/.exec(entry)?.[1] ?? '';
    const category =
      /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(entry)?.[1] ?? '';
    const doi = decodeXml(
      /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/.exec(entry)?.[1] ?? '',
    ).trim();
    const journal = decodeXml(
      /<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/.exec(
        entry,
      )?.[1] ?? '',
    ).trim();
    const bare = id.replace(/v\d+$/, '');
    const author = authors.join(' and ');
    const key = citationKey(author, year, title);
    const fields: [string, string][] = [
      ['author', author],
      ['title', title],
      ['year', year],
      ['eprint', bare],
      ['archiveprefix', 'arXiv'],
      ['primaryclass', category],
      ...(journal ? ([['note', journal]] as [string, string][]) : []),
      ...(doi ? ([['doi', doi]] as [string, string][]) : []),
      ['url', `https://arxiv.org/abs/${bare}`],
    ];
    return {
      key,
      bibtex: formatBibtex('misc', key, fields),
      source: 'arxiv',
      title,
    };
  }
}
