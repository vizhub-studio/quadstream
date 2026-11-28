# International administrative boundaries

The globe can load a local, versioned geoBoundaries gbOpen catalog in addition
to the existing US Census atlas. No external browser requests are necessary.
The empty checked-in catalog keeps ordinary installs and CI independent of
network downloads.


## Unified CDN geometry transport (React globe)

Append `?geometry=cdn` to select version-pinned jsDelivr assets for all
built-in production geometry: Visionscarto world 50m/110m (1.0.0), US Atlas
states/counties (3.0.1), and the Geo Packs ADM1 source below (0.1.0).
World geometry is requested on atlas selection; subdivisions are still
admitted lazily by the existing regional worker scheduler. User-supplied
files and embedded test fixtures do not use the CDN. The legacy globe is
unchanged.

The ordinary build continues to include local geometry and defaults to local
transport for deterministic offline browser tests. To build the React globe
without copying any geographic public assets, run from `quadstream-globe`:

```sh
VITE_GEOMETRY_CDN_ONLY=1 npm run build -- --base=/quadstream/
```

This opt-in build forces CDN transport. It retains root dependency
installation for the application and tests, but does not publish the atlas
files. `?international=0` still disables international layers.
There is no automatic local fallback in CDN mode; failed fetches surface
through the existing geometry and regional diagnostics. A CDN outage can
prevent startup. CDN requests expose which areas are being viewed.

Before switching Pages to CDN-only, verify each pinned URL, browser CORS,
world geometry parity at both resolutions, US state/county lazy loading,
international ADM1 coverage, offline fixture tests, and failure/retry behavior
in Chromium and WebKit. Compare build artifact sizes and cold/warm request
timing. Confirm that a CDN-only dist has no copied `globe-data` directory.
No Pages workflow default changes are made until these checks pass.

## Experimental npm/CDN ADM1 source (React globe)

Start the React globe normally and append `?international=cdn` to its URL.
No regional downloader or package installation is needed for this mode.
The existing local catalog remains the default, and `?international=0`
still disables international boundaries. US states and counties are unchanged.

The source is [@paramira/geo-packs 0.1.0](https://www.npmjs.com/package/@paramira/geo-packs),
served as version-pinned static data through jsDelivr. Startup fetches the
package file inventory and its world topology (country envelopes); it does
not fetch subdivision topology until a country is admitted at 3x zoom.
Only non-US ADM1 files are selected; ADM2 is intentionally out of scope.
The package documents roughly 200 ADM1 country files, with known gaps.
The globe retains the six-international-worker admission limit. Country
envelopes use the package world outlines with a five-degree margin;
these are approximate, not proven bounds on the subdivision geometry.

The Settings > Data source panel links to per-country source and license
credits. Data licenses differ by country; some are share-alike.
Unlike local mode, the CDN receives requests that reveal the areas being
viewed. No CDN availability or cache hit is guaranteed.

### Live acceptance gates

- Confirm the version-pinned jsDelivr flat inventory, world topology and
  CAN ADM1 URL return valid JSON with browser CORS enabled. Inspect country
  counts and sizes; ensure the expected polygon collection and shared arcs.
- Start the React app with the CDN query parameter and inspect Diagnostics:
  catalog status should report a nonzero layer count. Verify no subdivision
  requests before the activation threshold, and Canada boundaries above 3x.
- Test Brazil, India, Germany, France and the antimeridian, both geometry
  modes, zoom reversal, worker eviction, HTTP failures, and mobile memory.
- Run root and React checks and browser tests. Existing tests must remain
  independent of the external network.
- Promote this mode to default only after successful live validation.
  The source package's data resolution, real payload sizes, browser CORS,
  and exact coverage are not established by synthetic tests.

## Generate and try

```sh
npm ci
node scripts/download-regional-atlas.mjs CAN BRA IND DEU FRA
npm run demo:globe
```

Pass `--level=ADM1` and/or `--level=ADM2` to limit which layers are
requested (default: both). For example, ADM1 only:

```sh
node scripts/download-regional-atlas.mjs --level=ADM1
```

Run the downloader without country arguments to request all available ADM1 and
ADM2 layers other than USA. Each successful invocation replaces the catalog
with the selected set. Assets are content-hashed and ignored by Git; do not
commit the generated catalog or data. Restore the empty catalog with
`git restore examples/globe/regional-data/catalog.json` if necessary.
The script records source, version, boundary ID, SHA-256, byte size, license
and attribution metadata. Failed downloads leave the old catalog intact.
The pinned gb80 API endpoint and data format need a live smoke test; do not
silently switch to a moving current release if the endpoint is unavailable.

ADM1 enters at 3x and ADM2 at 6x (exit 2.7x/5.4x). The catalog bounds each
layer conservatively, and only the six nearest eligible international layers
are admitted at once. Offscreen or unadmitted workers and their cached frames
are discarded. This caps worker count, not bytes; broad caps can cause
unneeded loads or omit visible neighbors under the admission limit.
US workers and geometry remain independent. Use `?international=0` to disable
the extension, or `?counties=0` to disable both US counties and ADM2.

International meshes draw internal shared arcs only. Separately sourced ADM1
and ADM2 layers may have duplicate or mismatched parent borders; the existing
US FIPS-based filtering does not apply. Cross-source snapping and general
parent reconciliation are deferred. GeoBoundaries gbOpen data requires
attribution; inspect the catalog license and source fields before distribution.

## Merge gates

- Run the sample downloader, confirm it resolves the pinned release and that
  data is valid TopoJSON, and inspect catalog coverage, file sizes and license fields.
- Run npm run check, npm run lint and npm run test:globe:browser.
- Visually inspect Canada, Brazil, India and Europe at both thresholds,
  including reverse zoom, panning across countries and original mode.
- Measure cold download, worker build, query and peak memory on mobile; verify
  no unexpected boundary fallback, missing visible layers, or distracting overlap.
- Confirm existing US rendering is unchanged.

Global data generation, distribution via npm/CDN, per-country attribution
display, memory-byte budgets and validated global coverage remain follow-ups.
