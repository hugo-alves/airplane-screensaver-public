# Airplane screensaver

An aircraft radar display showing nearby aircraft on an animated map, with estimated positions, trails and flight information. Choose Portuguese or English and metric or aviation units (nautical miles, feet and knots).

## Browser

Install Node.js 20 or newer and run `npm install`, then `npm start`. Open http://127.0.0.1:8894/. Search for a city, select a result and choose an observation radius (1–50 km, or its equivalent in nautical miles). Coordinates can also be entered manually. The map uses Web Mercator and supports latitudes between 85° south and 85° north. **TESTAR PASSAGEM / TEST FLIGHT** shows a labelled simulated flight; on a fresh browser it uses a public example without saving it. User-saved settings persist in the browser. This display does not install itself as an operating-system screensaver.

Developers and coding agents can use the [platform adaptation guide](docs/PORTING.md) to preview the project, identify reusable components, and port it without having an LG TV. Repository-specific agent instructions are in [AGENTS.md](AGENTS.md).

## LG webOS: install and configure on the TV

The native screensaver is experimental. It needs a **rooted LG webOS TV**, Homebrew Channel, and [Glasshouse](https://rorygallagher2024.github.io/glasshouse/install/) with its **Starfield** screensaver selected. It does not require TV Clean or its launcher. A different replacement of Starfield, including the older TV Clean radar, must be restored before activation. Root availability depends on the TV model and firmware; this is not an LG App Store app. The on-TV setup and native map have been exercised on one webOS 5 TV; this release's display changes, compatibility with other models and persistence after a physical restart have not been established.

Download the location-free `.ipk` installer from [GitHub Releases](https://github.com/hugo-alves/airplane-screensaver-public/releases).

To install it, use the Glasshouse dashboard's **Apps → Install app from a URL or file → Upload .ipk** from a computer or phone. Enable that option for the upload, confirm the package, and turn it off again afterwards. Alternatively, install the IPK using your existing webOS development tools.

To build the installer from source instead:

```sh
npm install
npm run build:lg
```

The resulting file is `build/com.airplanescreensaver.app_0.2.1_all.ipk`. It can be shared without first adding anyone's coordinates.

Open **Airplane Screensaver** on the TV. Search for a city with the TV keyboard, select the correct result, choose the observation radius, language and units, and select **Prepare and activate**. The TV downloads and prepares the map, then activates the screensaver. The radius control is always in kilometres (1–50 km); display units can be metric or aviation. To change settings later, reopen the app and repeat the selection. The app's **Restore previous screensaver** button restores the saved Glasshouse Starfield files and removes this project's boot hook.

The chosen location and maps are kept on the TV in a private configuration directory. The local helper also provides the exact configured location over an unauthenticated loopback endpoint: other applications on the TV that can access that endpoint can read it. It is not directly exposed on the local network. The initial download needs internet access and can take a little while. City searches use Open-Meteo, map downloads use OpenFreeMap, and aircraft providers receive approximate coordinates; see Privacy below.

### Advanced: prepare a location-specific package on a computer

On the computer, create a private settings JSON file outside this repository. The following is a public example; replace the city and coordinates with the location you want:

```json
{"location":{"name":"Tokyo","latitude":35.6895,"longitude":139.6917},"radiusKm":5,"language":"en","units":"aviation"}
```

`language` is `pt` or `en`; `units` is `metric` or `aviation`. The radius in this file is always in kilometres. Run `npm install`, then:

```sh
npm run prepare:lg -- /absolute/path/to/settings.json
```

This generates `build/native/`, containing the configuration, a map for that area, the native renderer and an installer. **Unlike the IPK above, this folder contains the exact coordinates**. It is ignored by Git; keep it private. Preparing the map downloads public OpenFreeMap tiles for the selected area and requires network access.

Transfer the entire `build/native/` folder to a temporary directory on the TV using an already configured root-access method. On the TV, from that transferred directory, run `node install.js install` as root. The installer checks that Glasshouse Starfield is selected and mounted, saves the original QML, copies its own resources, starts the helper, verifies that the expected helper process is responding, and installs a boot hook. It refuses to overwrite an unrecognised replacement. If the older TV Clean radar is present, the installer adds a reversible guard to its known installer so it cannot retake the slot while this one is active; unknown versions are refused. The guard is removed on restore. Running it modifies the TV's Glasshouse screensaver and boot configuration.

To restore the saved original, run `node /var/lib/airplane-screensaver/install.js restore` as root. To inspect the hook and helper state, use the same command with `status`. With this advanced method, changing location, radius, language or units requires preparing and transferring a new package and rerunning the installer. Neither successful preparation nor a status report establishes that the picture is visible or survives a physical TV restart; check those separately.

## Privacy and data

City searches go to Open-Meteo. Aircraft searches send the selected location rounded to two decimal places to ADSB.lol (the native helper also uses ADSB.fi); map tiles come from OpenFreeMap and aircraft information from ADSBdb. Those providers receive network requests and can observe network addresses. Aircraft positions are estimates and coverage depends on the providers. Reported barometric altitude is not height above ground; negative pressure readings are shown as unavailable with an explanation rather than rounded to zero. The project's MIT licence does not override provider terms: the free [ADSB.fi](https://github.com/adsbfi/opendata#terms) and [Open-Meteo](https://open-meteo.com/en/terms) APIs are for non-commercial use; [ADSB.lol](https://api.adsb.lol/docs) publishes its data under ODbL and asks production users to contact it.

## Credits

Based on components from [Launch Home](https://github.com/gprot42/webos-launch-home), MIT licensed; see LICENSE. Map data © OpenStreetMap contributors via OpenFreeMap/OpenMapTiles. Aircraft data: ADSB.fi, ADSB.lol and ADSBdb. Font and aircraft asset licence notices are in `assets/flights/`. The aircraft silhouettes are schematic family approximations, not manufacturer drawings.
