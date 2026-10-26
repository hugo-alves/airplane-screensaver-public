# Adapting the screensaver to another platform

This guide is for a developer or coding agent working without the original
developer's LG TV. The project has a browser renderer, portable flight logic,
and one native integration for rooted LG webOS. No Android TV, Google TV,
Samsung TV, Apple TV, desktop or other native integration is currently
implemented or verified. A browser preview, an app shown on a TV, and an OS
screensaver that starts on idle are different outcomes.

To brief a coding agent, replace the bracketed details and use:

> Read AGENTS.md and docs/PORTING.md. Adapt this screensaver for
> [device model and operating-system version] as [a foreground app or a system
> screensaver]. I [do/do not] have the device available for testing. Keep the
> location, radius, language and units configurable. Build and test what you
> can locally, explain installation, and identify anything still unverified.

## 1. Establish the target

Find out the device and operating-system version, how users install software,
what input is available, and whether the desired outcome is a foreground app,
an app-controlled idle display, or an operating-system screensaver. Check what
the target actually permits and document any restrictions. Do not assume a
vendor's TV browser can register a system screensaver, or that the LG root and
Glasshouse approach applies elsewhere. If hardware or an emulator is not
available, implement and test what you can and state that device validation is
outstanding.

Useful starting points in vendor documentation:

- [Android TV and Google TV Ambient Mode](https://developer.android.com/training/tv/playback/ambient-mode)
  and Android's [DreamService API](https://developer.android.com/reference/android/service/dreams/DreamService).
  Verify availability and installation on the actual target; an Android API
  alone does not establish that a particular TV exposes custom screensavers.
- [Samsung's TV web-app quick start](https://developer.samsung.com/smarttv/develop/getting-started/quick-start-guide.html),
  including its SDK, signing and testing requirements. This is a starting point
  for an app, not evidence of support for replacing the system screensaver.
- [LG's webOS screensaver policy](https://webostv.developer.lge.com/develop/guides/screensaver)
  describes the platform's app behavior. The root/Glasshouse integration in
  this repository is separate from that documented app policy.

## 2. Run and inspect without a TV

From the repository root, on a development computer with Node.js 20 or newer:

```sh
npm install
npm run test:core
npm start
```

Open <http://127.0.0.1:8894/?simulation=1&phase=overhead> in a **fresh browser
profile**. A labelled simulated flight should appear without entering or
saving a personal location. The in-memory example is a public city centre;
if the browser already has saved settings, the preview uses those settings
instead. `phase=departure` shows another point in the test flight.

The simulated flight and its metadata do not contact the aircraft APIs. The
map renderer still requests OpenFreeMap tiles over the network, so offline
runs can show the aircraft UI over an empty map. A browser rendering check does
not verify the target device's renderer, lifecycle or installation. The normal
preview at `/` asks for a location and uses live data; it saves settings in
that browser's local storage. `npm start` binds to `127.0.0.1`: it is a local
development preview, not a server reachable automatically from a TV or a
production backend.

`npm run test:core` runs portable geography, flight-feed, altitude and units
checks. `node --test test/browser-preview.test.cjs` checks the simulation with
the map stubbed and no network. `npm test` additionally builds the LG IPK and
runs all local tests, including LG installer and setup mocks; it needs the
development dependencies installed but does not need an LG TV. None of these
tests proves an actual device installation.

## 3. Know which pieces to reuse

| Piece | Location | Porting role |
| --- | --- | --- |
| Flight model | `src/js/flight-tracking.js` | Normalises settings and feeds, projects geography, tracks and interpolates aircraft, selects the nearest flight, and handles negative barometric altitude. |
| Camera and icons | `src/js/flight-camera.js`, `src/js/flight-aircraft-icons.js` | Camera framing, dateline handling and aircraft silhouette selection. |
| Language and units | `src/js/preferences.js` | Portuguese/English strings and metric/aviation formatting. |
| Browser display | `src/js/flight-screensaver.js`, `src/styles/flights.css`, `assets/flights/` | The 16:9 visual layout, animation and packaged fonts/icons. Requires DOM, Canvas, SVG and compatible browser APIs. |
| Browser map | `src/js/flight-map.js` | Fetches and renders OpenFreeMap vector tiles; its browser and network requirements are separate from the pure flight model. |
| Data and preview | `src/js/flight-data.js`, `src/js/flight-preview.js`, `scripts/flight-preview.cjs` | Current browser data client, configuration UI, simulated flight and local-only API relay. |
| LG integration | `native/`, `scripts/package-lg.cjs`, `scripts/prepare-native.mjs` | webOS-specific QML, map preparation, Homebrew/Glasshouse integration, installation, boot and restoration. |

The modules are not yet a fully platform-neutral SDK. The model and camera are
ordinary JavaScript, but the browser renderer depends on browser APIs and its
current client expects the preview relay's HTTP routes. A platform without a
compatible web runtime needs an equivalent renderer and transport. Avoid
copying LG-specific paths, root commands or QML into another platform as if
they were portable. Keep a new platform wrapper in its own directory and share
logic only where the runtimes support it.

## 4. Adapt the boundaries

1. **Settings and setup.** Let users choose a city or coordinates, observation
   radius, language and units using the target's input method. Keep settings
   on the user's device or in an explicitly chosen private store; do not embed
   a developer's location, device address or credentials. The normalized
   configuration shape is:

   ```json
   {"location":{"name":"Paris","latitude":48.8566,"longitude":2.3522},"radiusKm":5,"language":"en","units":"metric"}
   ```

   `radiusKm` is always in kilometres (1–50); `language` is `pt` or `en`, and
   `units` is `metric` or `aviation`. The current Mercator implementation
   supports latitudes from −85 to 85 and longitudes from −180 to 180. The
   normalization helper has a public fallback for invalid input: do not use
   that fallback as a substitute for asking the user to choose a location.

2. **Data transport.** `createFlightScreensaver` accepts a `client` with
   `nearby(config)`, `metadata(aircraft)` and `cancel()`. The first two return
   promises; `nearby` returns an ADS-B-style `{now, ac}` feed understood by
   `readAircraftFeed`, while metadata follows the ADSBdb response consumed by
   `readAircraftMetadata`. For example, one simulated response is:

   ```js
   {now: Date.now(), ac: [{hex: 'aabbcc', flight: 'TEST1234',
     lat: 48.857, lon: 2.352, seen_pos: 0, alt_baro: 2000, gs: 120, track: 90}]}
   ```

   `now` is a Unix timestamp in seconds or milliseconds; `seen_pos` is the age
   in seconds, `alt_baro` is in feet, `gs` in knots, and `track` in degrees.
   The simulator in `src/js/flight-preview.js` shows metadata and cancellation
   too. Implement a target-appropriate client or relay: the
   default browser client calls `/api/aircraft` and `/api/aircraft-info` on the
   local preview server, and may not work inside a packaged TV app as-is.
   Respect provider rate limits, permitted use, attribution and privacy.

3. **Rendering and lifecycle.** If the target has a compatible web engine,
   mount `createFlightScreensaver({rootEl, getConfig, client})`, where
   `getConfig()` returns `{flights: config}`, and include the CSS and assets.
   Call `start()` on entry and `stop()` on exit or suspension. Otherwise port
   the model/camera to the target's renderer. Preserve correct distances,
   estimates, stale-data handling, map/aircraft alignment, the clock, readable
   focus and remote navigation. Keep simulated flights
   clearly labelled and never present them as live data.

4. **Packaging and activation.** Implement the platform's supported app or
   screensaver lifecycle, configuration UI, packaging, permissions and
   uninstall/restore path. Verify signing and deployment requirements using
   current official documentation. Do not mutate an owner's existing
   screensaver or device settings without the authorization needed for that
   task. If the platform only supports a foreground app, say so explicitly.

## 5. Validate and hand over

- Run the core tests and the smallest meaningful automated tests for the new
  adapter. Use public coordinates and mock feeds; test valid and invalid
  settings, metric/aviation conversion, dateline handling and stale/offline
  behavior as relevant.
- Exercise one labelled simulated flight and, when network access is
  available, a real feed separately. Check that a map appears, settings can
  be changed, and the controls can be used with the target's input device.
- On the actual device or emulator, separately verify install, configuration,
  rendering, idle activation if supported, exit/re-entry and restoration. A
  reboot or resume check needs an actual reboot or resume; a build or mocked
  hook is not evidence of persistence.
- Report the target, what was tested, what was simulated, and what still
  requires a device or user action. Do not claim support for untested models.

City searches, map tiles and aircraft APIs are third-party requests and can
expose the search or approximate region and network address. See the privacy
and data section of [README.md](../README.md). Keep generated configuration,
maps, screenshots containing personal locations or device details, and other
personal data out of the repository and releases. A reviewed demonstration
image is acceptable when it uses only simulated aircraft and a public example
location, is clearly labelled, includes map attribution, and contains no
personal or device details.
