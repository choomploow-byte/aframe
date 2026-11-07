import { describe, expect, it } from 'vitest';
import { CoreError, toOpError } from './errors';

describe('toOpError', () => {
  it('keeps code, message, hint and path, and adds the op index', () => {
    const err = new CoreError('BAD_PARENT', 'nope', 'try a frame', 'parentId');
    expect(toOpError(err, 3)).toEqual({
      op: 3,
      code: 'BAD_PARENT',
      message: 'nope',
      hint: 'try a frame',
      path: 'parentId',
    });
  });

  it('leaves out what is not there', () => {
    expect(toOpError(new CoreError('NOT_FOUND', 'gone'))).toEqual({
      code: 'NOT_FOUND',
      message: 'gone',
    });
  });

  it('reports unexpected failures as INTERNAL', () => {
    expect(toOpError(new Error('boom'), 1)).toEqual({
      op: 1,
      code: 'INTERNAL',
      message: 'Unexpected error: boom',
    });
    expect(toOpError('text')).toEqual({ code: 'INTERNAL', message: 'Unexpected error: text' });
  });

  it('exposes a readable name', () => {
    expect(new CoreError('CYCLE', 'x').name).toBe('CoreError');
  });
});
