/**
 * Arithmetic for number fields ("16*2", "(100-8)/2", "-4+10%3"). A small recursive-descent
 * parser rather than `eval`/`Function`, which the project forbids (docs/18).
 */
const MAX_LENGTH = 120;
const MAX_DEPTH = 24;

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private readonly src: string) {}

  parse(): number | null {
    const value = this.expr();
    this.skipSpace();
    return value !== null && this.pos === this.src.length && Number.isFinite(value) ? value : null;
  }

  private skipSpace(): void {
    while (this.src.charAt(this.pos) === ' ') this.pos += 1;
  }

  private peek(): string {
    this.skipSpace();
    return this.src.charAt(this.pos);
  }

  private expr(): number | null {
    let left = this.term();
    while (left !== null) {
      const op = this.peek();
      if (op !== '+' && op !== '-') break;
      this.pos += 1;
      const right = this.term();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number | null {
    let left = this.factor();
    while (left !== null) {
      const op = this.peek();
      if (op !== '*' && op !== '/' && op !== '%') break;
      this.pos += 1;
      const right = this.factor();
      if (right === null) return null;
      if (op === '*') left *= right;
      else if (right === 0) return null;
      else left = op === '/' ? left / right : left % right;
    }
    return left;
  }

  private factor(): number | null {
    const c = this.peek();
    if (c === '-' || c === '+') {
      this.pos += 1;
      const v = this.factor();
      return v === null ? null : c === '-' ? -v : v;
    }
    if (c === '(') {
      this.pos += 1;
      this.depth += 1;
      if (this.depth > MAX_DEPTH) return null;
      const v = this.expr();
      this.depth -= 1;
      if (this.peek() !== ')') return null;
      this.pos += 1;
      return v;
    }
    const m = /^(?:\d+\.?\d*|\.\d+)/.exec(this.src.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return Number(m[0]);
  }
}

/** Evaluates a typed number or expression; returns null for anything that is not a finite number. */
export function evaluateExpression(text: string): number | null {
  const trimmed = text.trim().replace(/px$/i, '').replace(/,/g, '.');
  if (trimmed === '' || trimmed.length > MAX_LENGTH) return null;
  return new Parser(trimmed).parse();
}
