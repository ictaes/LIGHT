# Tests

Run with `npm test`. That builds first (via the protected `scripts/build.mjs`) and then runs Node's built-in
test runner over this directory — there is no test framework dependency to install.

Tests are plain `.mjs` and import the **compiled output** from `build/`, not the TypeScript sources. That is
deliberate: it tests the artifact that actually runs in production, and it avoids needing a TS loader.

## What can and cannot be tested here

Only modules with no runtime dependency on a live Discord client. A module that reaches `PointManager.js`
cannot be imported in a test, because `PointManager` calls `client.login()` and binds port 34583 at module
evaluation — the test process then logs a second bot in and never exits.

`util/PermissionUtil.js` used to be exactly that casualty. It is testable now, and
`PermissionUtil.test.mjs` exists partly to keep it that way: if the cycle comes back, that file hangs
instead of finishing in about a second. Note it has to `process.chdir()` into a scratch directory before
importing, because both `DataBaseManager` and `Config` read from `process.cwd()`.

When adding a new util module, keep it importable if you want it tested:

- depend on `Config.js`, never `PointManager.js`
- use `import type` for anything used only as a type — `BotUserContext` in particular drags in the client
- if you need shared mutable state, put it in a module with no imports (see `util/WebhookSubscriptions.ts`)
  rather than reaching for the module that happens to own the behaviour
