# Tests

Run with `npm test`. That builds first (via the protected `scripts/build.mjs`) and then runs Node's built-in
test runner over this directory — there is no test framework dependency to install.

Tests are plain `.mjs` and import the **compiled output** from `build/`, not the TypeScript sources. That is
deliberate: it tests the artifact that actually runs in production, and it avoids needing a TS loader.

## What can and cannot be tested here

Only modules with no runtime dependency on a live Discord client. Today that means `util/ComponentRouter.js`
and `db/migrations/`.

Most util modules **cannot** be imported in a test, because importing them reaches `PointManager.js`, which
calls `client.login()` and binds a port at module evaluation. `util/PermissionUtil.js` is the notable
casualty: its legacy `mod_roles` lookup goes through `BotSettingProvider` → `PointManager`. Breaking that
chain is part of moving `logAction`/`logModAction` into a `LogUtil` module.

When adding a new util module, keep it importable if you want it tested: depend on `Config.js` rather than
`PointManager.js`, and use `import type` for anything only needed as a type.
