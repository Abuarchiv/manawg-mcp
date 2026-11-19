import { expect, it } from 'vitest';
import { describeFailure, isSafeCode, ManaWgError } from '../src/errors.js';

it('allowlists app codes that tools can reach', () => {
  for (const code of [
    'inventory_purchase_changed',
    'undo_invalid',
    'idempotency_response_pending',
    'idempotency_response_invalid',
  ]) {
    expect(isSafeCode(code)).toBe(true);
  }
});

it('logs a failed tool call with code and status, without details', () => {
  const error = new ManaWgError('too_many_requests', 429, {
    details: 'secret',
    retryAfterSeconds: 7,
  });
  expect(describeFailure('chore_list', error)).toBe(
    'tool_error tool=chore_list code=too_many_requests status=429 retry_after_s=7',
  );
});

it('logs an unexpected failure with its name and stack', () => {
  const line = describeFailure('chore_list', new TypeError('boom'));
  expect(line).toContain('tool_error tool=chore_list kind=internal name=TypeError');
  expect(line).toContain('boom');
});
