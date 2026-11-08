declare module 'luaparse' {
  export function parse(code: string, options?: { luaVersion?: string }): unknown;
}
