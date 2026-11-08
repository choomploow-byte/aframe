/**
 * A small, strict-enough XML reader for SVG. It has no DOM and no entity machinery on purpose: a
 * DOCTYPE (and anything it declares) is skipped, only the five built-in entities and numeric
 * references are understood, and depth and size are capped, so a hostile file cannot expand or
 * recurse its way into trouble.
 */
import { IMPORT_LIMITS, ImportError } from './types';

export interface XmlElement {
  /** Local name (a namespace prefix is dropped). */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Text directly inside, in order, with the text of child elements not included. */
  text: string;
  /** Text pieces and child elements interleaved, for <text> with <tspan>s. */
  mixed: (string | XmlElement)[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

const localName = (n: string): string => n.slice(n.indexOf(':') + 1);

export function parseXml(source: string): XmlElement {
  if (source.length > IMPORT_LIMITS.maxBytes)
    throw new ImportError('That file is too large to import.');
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let i = 0;
  const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '', mixed: [] };
  const stack: XmlElement[] = [root];
  let elements = 0;

  const skipPast = (token: string): void => {
    const at = src.indexOf(token, i);
    if (at < 0) throw new ImportError('The file ends unexpectedly.');
    i = at + token.length;
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1] as XmlElement;
    if (lt < 0) {
      const tail = src.slice(i);
      if (tail.trim() !== '') top.mixed.push(decodeEntities(tail));
      break;
    }
    if (lt > i) {
      const raw = src.slice(i, lt);
      const decoded = decodeEntities(raw);
      top.text += decoded;
      top.mixed.push(decoded);
    }
    i = lt;
    if (src.startsWith('<!--', i)) {
      skipPast('-->');
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      if (end < 0) throw new ImportError('The file ends unexpectedly.');
      const text = src.slice(i + 9, end);
      top.text += text;
      top.mixed.push(text);
      i = end + 3;
    } else if (src.startsWith('<?', i)) {
      skipPast('?>');
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [...]: skipped whole, never interpreted.
      let depth = 0;
      for (; i < src.length; i += 1) {
        const c = src[i];
        if (c === '[') depth += 1;
        else if (c === ']') depth -= 1;
        else if (c === '>' && depth <= 0) break;
      }
      i += 1;
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i);
      if (end < 0) throw new ImportError('The file ends unexpectedly.');
      const name = localName(src.slice(i + 2, end).trim());
      const open = stack.pop();
      if (stack.length === 0 || open === undefined || open.name !== name) {
        throw new ImportError(`This is not valid SVG: a </${name}> does not match.`);
      }
      i = end + 1;
    } else {
      // An opening tag. Find its end, respecting quotes.
      let j = i + 1;
      let quote = '';
      for (; j < src.length; j += 1) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      if (j >= src.length) throw new ImportError('The file ends unexpectedly.');
      let inner = src.slice(i + 1, j);
      const selfClosing = inner.endsWith('/');
      if (selfClosing) inner = inner.slice(0, -1);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      if (!nameMatch) throw new ImportError('This is not valid SVG: an empty tag.');
      const el: XmlElement = {
        name: localName(nameMatch[0]),
        attrs: {},
        children: [],
        text: '',
        mixed: [],
      };
      const attrRe = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m: RegExpExecArray | null;
      const rest = inner.slice(nameMatch[0].length);
      while ((m = attrRe.exec(rest)) !== null) {
        el.attrs[localName(m[1] as string)] = decodeEntities(m[3] ?? m[4] ?? '');
      }
      elements += 1;
      if (elements > IMPORT_LIMITS.maxNodes * 4) {
        throw new ImportError('This file has too many elements to import.');
      }
      top.children.push(el);
      top.mixed.push(el);
      if (!selfClosing) {
        if (stack.length > IMPORT_LIMITS.maxDepth) {
          throw new ImportError('This file is nested too deeply to import.');
        }
        stack.push(el);
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new ImportError('The file ends before every tag is closed.');
  const svg = root.children[0];
  if (!svg || svg.name !== 'svg') throw new ImportError('This is not an SVG file.');
  return svg;
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Writes an element back out (used to keep a drawing as an image). Attribute values are re-escaped. */
export function serialize(el: XmlElement): string {
  const attrs = Object.entries(el.attrs)
    .filter(([k]) => /^[A-Za-z_][\w:.-]*$/.test(k) && !k.toLowerCase().startsWith('on'))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  const inner = el.mixed
    .map((c) => (typeof c === 'string' ? escapeText(c) : serialize(c)))
    .join('');
  return inner === '' ? `<${el.name}${attrs}/>` : `<${el.name}${attrs}>${inner}</${el.name}>`;
}
