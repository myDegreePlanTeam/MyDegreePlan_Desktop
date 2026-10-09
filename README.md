# MyDegreePlan Desktop

The MyDegreePlan web build (`MyDegreePlan_Frontend/dist`) hosted in a locked-down Electron window, shipped as a Windows installer.
It replaces the Docker install (`MyDegreePlan_Deploy`) once it is ready; until then both exist side by side.
Plan: `MyDegreePlan_Frontend/docs/claude/plans/PLAN_electron-migration.md`.

No server: the app uses its local-first backend (the bundled catalog plus the student's plan in IndexedDB, in `%APPDATA%\MyDegreePlan`).

## Decisions (2026-10-09)

- **Windows only** for launch (x64). Mac and Linux later.
- **Unsigned** for now. Windows SmartScreen will warn on first run ("More info", then "Run anyway"). Signing is a later decision; when it
  happens, set the signing options in `electron-builder.yml` and add the certificate as a secret of the `release` environment.
- **No required updates.** Updates are always optional.

## Run it

```bash
cd ../MyDegreePlan_Frontend && npm run build     # once, and after every Frontend change
cd ../MyDegreePlan_Desktop && npm install && npm start
```

| Command | What it does |
|---|---|
| `npm start` | Run the app from source against `../MyDegreePlan_Frontend/dist` (`MDP_WEB_ROOT=<folder>` overrides) |
| `npm test` | Unit tests (security rules, updater) |
| `npm run smoke` | Launch, check the page renders from `app://mdp`, IndexedDB opens, an outside request is blocked and Node is not exposed; exit 0 / 1 |
| `npm run pack` | Build the unpacked app into `release/win-unpacked` (fast) |
| `npm run dist` | Build the installer `release/MyDegreePlan-Setup-<version>.exe`, its blockmap and `latest.yml` |

The built app can be smoke-tested too: `MDP_SMOKE_OUT=report.json release\win-unpacked\MyDegreePlan.exe --mdp-smoke`
(a packaged GUI exe does not print to a pipe, so the report goes to the file).

## Releasing

Actions -> **Release** -> Run workflow (`version`, `notes`, optional `frontend_ref`), then approve the `release` environment (required reviewer: bradyg7;
only `main` may deploy to it). Versions cannot be reused. Add `SOURCES_TOKEN` if the Frontend repo is private.

1. **test job** (needs no approval, so a failure shows before anyone is asked): version is free, Frontend tests and build, this repo's tests, which include
   "every file the web build refers to exists" (`test/web-assets.test.js`).
2. **release job** (after approval, Windows runner): builds the installer; smoke-tests the built app, which fetches every file of the web build through
   `app://mdp` and fails on any 404 / 403; attests provenance; creates the release as a **draft** and checks that every file is there at the right size;
   publishes; then checks every public URL an installed app or the website will request (the releases feed, `latest.yml`, the versioned installer and its
   blockmap, the fixed-name `MyDegreePlan-Setup.exe`), and that the installer's SHA-512 equals the one in `latest.yml`. If a public check fails the release
   is pulled back to a draft (delete it, and its tag, before reusing the version).

Each release carries the installer under two names: `MyDegreePlan-Setup-<version>.exe` (what `latest.yml` names, for the updater) and `MyDegreePlan-Setup.exe`
(fixed, for the website). The Site picks a release up on its next build (its daily cron, or run its workflow by hand).

## Updates

`electron-updater` checks GitHub Releases 15 seconds after start and every 6 hours, only in an installed app (`MDP_UPDATES=off` in the environment turns it off).
The student chooses when to download and when to restart; a downloaded update also installs when the app is closed. The page sees
`window.mdpDesktop.updates` (`state`, `check`, `download`, `install`, `onChange`); the Frontend card that shows it is still to be written (plan phase 3).
Integrity today rests on the SHA-512 in `latest.yml` served over HTTPS from this repo's releases, not on a code signature.

## Rules that must hold

- **The origin is `app://mdp` forever.** IndexedDB is keyed by origin; changing the scheme or host orphans every saved plan (`src/security.js`, with a test).
- **The install folder and app name are permanent too:** `package.json` `name` (`mydegreeplan`) sets `%LOCALAPPDATA%\Programs\mydegreeplan` and
  `appId` is the Windows identity; changing either makes an update install beside the old copy instead of over it. `productName` sets the data folder.
- **The page never reaches the network.** The session cancels every request that is not `app:`, `data:`, `blob:` or `devtools:`. The one exception
  is the update check to GitHub, and only for requests made by the main process (they carry no page); a page can never reach those hosts.
- **Renderer hardening:** `contextIsolation`, `sandbox`, no `nodeIntegration`, no navigation away from the app origin, no `window.open`
  (an `https:` link opens in the system browser), all permission requests denied, one instance at a time.
- **Binary hardening (fuses):** `RunAsNode`, `NODE_OPTIONS` and `--inspect` are off; the app loads only from the asar, with integrity validation on.
- The preload exposes data and the four update actions, never a file, shell or network capability.
- The uninstaller keeps the student's data (`deleteAppDataOnUninstall: false`).

## Not done yet (see the plan)

- The Frontend update card and the Docker removal (plan phases 3 and 5-6).
- An application icon: the installer and window use Electron's default icon.
- A real update, end to end: it needs two published releases. Everything up to it is tested; the first pair of releases is the test.
- Manual checks in the real window: a plan surviving a restart, drag-and-drop, PDF export, Import/Export.
- Code signing, other platforms.
