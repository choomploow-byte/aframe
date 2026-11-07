/** A tool's JSON Schema without the `$schema` marker providers do not want. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...schema };
  delete copy.$schema;
  return copy;
}
