# Working on Airplane Screensaver

This project shows nearby aircraft on an animated map. The browser preview and
shared flight logic work without an LG TV. The existing native installation is
specifically for rooted LG webOS with Homebrew Channel and Glasshouse; it is not
a generic screensaver installer.

Start with [README.md](README.md) and [docs/PORTING.md](docs/PORTING.md). For a
new target, identify the actual operating system, version, input method, and
whether the request is for a foreground app or a system idle screensaver.
Check the target's official documentation. If a necessary detail is missing,
ask a focused question and continue work that does not depend on the answer.

Use Node.js 20 or newer on the development computer. `npm install`,
`npm run test:core`, and `npm start` do not need a TV. The labelled
`/?simulation=1&phase=overhead` browser preview can run without a personal
location; its aircraft are simulated, while map tiles still require network
access. `npm test` also builds and exercises the LG package locally but does
not prove behavior on a TV.

Keep portable flight logic, platform UI, data transport, and installation
separate. Reuse existing modules when the target supports them; `native/` and
the local preview relay are examples, not drop-in installers or backends for
other platforms. Keep city, radius, language, and units configurable. Do not
put a person's location, credentials, generated configuration, or recordings in
source control or examples; use public demonstration data.

Preserve the simulated/live distinction, provider terms and attribution, and
reversible installation or restoration where the platform supports it. Never
claim a browser, unit test, package build, or emulator proves physical-device
behavior. State what was actually tested and what still needs device validation.
Preserve unrelated work and follow the current user's instructions on editing,
device access, commits, pushes, releases, and deployment.
