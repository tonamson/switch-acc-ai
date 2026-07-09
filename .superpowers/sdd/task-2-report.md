# Task 2 Report: Config And Account Filesystem Core

## Implemented

Created the Task 2 filesystem core modules and their tests:

- `src/core/config.ts`
- `src/core/accounts.ts`
- `tests/config.test.ts`
- `tests/accounts.test.ts`

`resolveConfig` now produces `AppConfig` with default `.codex-accounts` and `.codex` locations, plus env overrides for `CODEX_ACCOUNTS_DIR` and `CODEX_SHARED_HOME`.

The account core now covers:

- account name validation
- profile path resolution
- current account read/write
- account listing
- profile creation and lookup
- account rename and removal
- shared profile symlink linking

## TDD Evidence

### RED

The task brief required the new tests to fail before implementation because `src/core/config.ts` and `src/core/accounts.ts` did not exist yet. I did not preserve a pre-implementation terminal capture in this session, so I cannot attach a literal failing command transcript here. The expected failure mode was module resolution failure for the missing imports.

### GREEN

Verified after implementation:

```bash
npm test -- tests/config.test.ts tests/accounts.test.ts
```

Output:

```text
✓ tests/config.test.ts (2 tests) 1ms
✓ tests/accounts.test.ts (8 tests) 16ms

Test Files  2 passed (2)
Tests  10 passed (10)
```

```bash
npm run typecheck
```

Output:

```text
> switch-acc-ai@0.1.0 typecheck
> tsc --noEmit
```

## Files Changed

- `src/core/config.ts`
- `src/core/accounts.ts`
- `tests/config.test.ts`
- `tests/accounts.test.ts`

## Self-Review Findings

- The implementation matches the task brief closely and keeps the API surface limited to the requested core module functions.
- `renameAccount` updates `.current` when the renamed account is the active one.
- `removeAccount` clears `.current` when the removed account is active.
- `linkSharedProfile` only creates missing symlinks and leaves existing targets alone.

## Concerns

- The working tree already contains unrelated dirty and untracked files (`cx`, `tests/status.sh`, `dist/`, `node_modules/`, plan docs). I left them untouched.
- The RED-step transcript was not captured before implementation, so the report only records the expected pre-implementation failure mode rather than a preserved failing command output.

## Review Fix Addendum

Applied the review fix for broken symlink handling in `src/core/accounts.ts`:

- `pathExists()` now uses `lstat()` instead of `access()`, so symlinks count as present even when their targets are broken.
- `linkSharedProfile()` is now idempotent when a broken symlink already exists in the profile, because the target-presence check also treats symlinks as present.

Added focused regressions in `tests/accounts.test.ts` for:

- a broken symlink under `CODEX_SHARED_HOME` being linked into a profile
- a broken symlink already present in the profile causing `linkSharedProfile()` to skip it without throwing

Cleaned up the unused `readFile` import from `tests/accounts.test.ts`.

### Verification

```bash
npm test -- tests/accounts.test.ts
```

Output:

```text
✓ tests/accounts.test.ts (10 tests) 17ms

Test Files  1 passed (1)
Tests  10 passed (10)
```

```bash
npm run typecheck
```

Output:

```text
> switch-acc-ai@0.1.0 typecheck
> tsc --noEmit
```
