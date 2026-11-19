import { expect, it } from 'vitest';
import { describeError, describeFailure, isSafeCode, ManaWgError } from '../src/errors.js';

it('tells the model the code, the next step and the retry delay, but not unrelated detail', () => {
  expect(describeError(new ManaWgError('too_many_requests', 429, { retryAfterSeconds: 7 }))).toBe(
    'ManaWG request failed: too_many_requests retry_after_s=7',
  );
  expect(describeError(new ManaWgError('wg_code_required', 400))).toBe(
    'ManaWG request failed: wg_code_required (the account belongs to several flats: call wg_list and pass wgCode)',
  );
});

it('hides every failure that did not come from the app behind the generic message', () => {
  expect(describeError(new TypeError('connect ECONNREFUSED 10.0.0.1'))).toBe(
    'ManaWG request failed',
  );
});

it('logs a failed call with code and status, without details', () => {
  const error = new ManaWgError('too_many_requests', 429, {
    details: 'secret',
    retryAfterSeconds: 7,
  });
  expect(describeFailure('chore_list', error)).toBe(
    'failure source=chore_list code=too_many_requests status=429 retry_after_s=7',
  );
});

it('logs the cause of a failed call for the operator only', () => {
  const error = new ManaWgError('auth_failed', 401, {
    cause: new Error('token endpoint answered 500'),
  });

  expect(describeFailure('chore_list', error)).toBe(
    'failure source=chore_list code=auth_failed status=401 cause=token endpoint answered 500',
  );
  expect(describeError(error)).toBe('ManaWG request failed: auth_failed');
});

it('logs an unexpected failure with its name and stack', () => {
  const line = describeFailure('chore_list', new TypeError('boom'));
  expect(line).toContain('failure source=chore_list kind=internal name=TypeError');
  expect(line).toContain('boom');
});

it('lets the codes that only tools reach through the app pass, and nothing else', () => {
  for (const code of [
    'inventory_purchase_changed',
    'undo_invalid',
    'idempotency_response_pending',
    'idempotency_response_invalid',
  ]) {
    expect(isSafeCode(code)).toBe(true);
  }
  expect(isSafeCode('<script>')).toBe(false);
  expect(isSafeCode(undefined)).toBe(false);
});
