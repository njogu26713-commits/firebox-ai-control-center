# No-login verification

## Scope
The Firebox AI control center dashboard is intentionally public. Anonymous requests use the shared workspace owner ID `0`; authenticated requests, if present, continue to use their existing owner ID.

## API verification
A `curl` request to `/api/trpc/controlCenter.overview` with no cookies or authorization headers returned the overview successfully. The response contained `account.plan: "Public workspace"`, `persona.ownerId: 0`, and `session.ownerId: 0`; it did not contain `UNAUTHORIZED`, `Please login`, or other authentication errors.

## Browser verification
The local dashboard loaded directly at `http://localhost:4173/` without a redirect or login prompt. The navigation showed `Public workspace` and `No sign-in required`; the overview showed `Workspace summary`, `Shared Firebox workspace`, and `Available without sign-in`.

## Automated checks
The TypeScript check and focused auth/control-center tests passed: 9 tests passed across `auth.logout.test.ts`, `controlCenter.procedures.test.ts`, and `controlCenter.validation.test.ts`. The full suite has one unrelated environment-dependent failure in `groq.credential.test.ts` because `GROQ_API_KEY` is not configured; the other 15 tests passed.

## Follow-up browser check
The dashboard continued to render the public workspace label after navigation attempts. The URL changed to `/?section=persona`, but the visible content stayed on Overview in the sandbox browser; this appears to be an existing client-side route-state issue unrelated to authentication removal and should be corrected if section navigation is in scope.
