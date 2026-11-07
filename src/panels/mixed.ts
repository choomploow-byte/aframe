import { deepEqual } from '@core/util';

/**
 * Multi-selection shows one value when every selected node agrees and "Mixed" when they differ.
 * `undefined` entries (property not set / not applicable) count as a value like any other.
 */
export interface Common<T> {
  mixed: boolean;
  /** The shared value; undefined when mixed or when none of the nodes has it. */
  value: T | undefined;
}

export function commonValue<T>(values: readonly (T | undefined)[]): Common<T> {
  if (values.length === 0) return { mixed: false, value: undefined };
  const first = values[0];
  const same = values.every((v) => deepEqual(v, first));
  return same ? { mixed: false, value: first } : { mixed: true, value: undefined };
}
