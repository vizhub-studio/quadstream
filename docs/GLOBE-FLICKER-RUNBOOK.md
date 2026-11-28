# Operator runbook: globe and minimap flicker during navigation

## Symptom and current implementation

Intermittently, the globe and minimap appear not to render for one display frame during panning and zooming. The reported occurrence does not involve resizing the browser. Root cause is unknown; do not assume that a skipped draw, geometry transition, or canvas clear is necessarily presented as a blank frame.

The deployed React/Vite demo is at <https://vizhub-studio.github.io/quadstream/>. The relevant source is [runtime.mjs](../quadstream-globe/src/globe/runtime.mjs), with shared [globe](../examples/globe/map.mjs) and [minimap](../examples/globe/minimap.mjs) renderers. Both obtain ordinary visible Canvas 2D contexts and clear them at the start of drawing. There is no application-managed double buffer. Browser-internal buffering/compositing is implementation-dependent. Both draws are synchronous in a single requestAnimationFrame callback, so a clear followed by drawing is normally not independently presented; this is why double buffering is an experiment, not an assumed cure. The runtime also skips alternating draws under motion when the last draw exceeded 12 ms; a skipped draw normally preserves the previous bitmap.

The goal is to find a reproducible mitigation with the smallest local change, not to implement ten fixes or to ship instrumentation. This runbook itself makes no runtime changes.

## Setup and baseline

Use Node 26. From the repository root:

```sh
npm ci
npm run build
cd quadstream-globe
npm ci
npm run dev
```

Open the Vite URL printed by the server (normally http://localhost:5173/). Reproduce on the deployed page as well if possible. Keep browser, viewport, device-pixel ratio, atlas (default 50m), zoom range, settings, and monitor refresh rate constant. Wait until the atlas is ready before each trial. Repeatedly drag the globe, zoom in/out, and combine drag and wheel/pinch, including rapid reversals. Try the same sequence for 60 seconds, or longer if the baseline is rare, at least three times per condition. Note whether the whole spheres (ocean and graticule) disappear or just the land/highlight. Record whether both canvases flash together.

Make only one change per trial and reload; restore the original source and browser settings between trials. Use a throwaway local branch for source changes; never discard unrelated edits. When a change appears to work, re-enable the original behavior and reproduce again (A/B/A). A zero-event run alone is not proof if the baseline is infrequent. Record console errors and the existing canvas dataset diagnostics when practical. Screen recording or a high-frame-rate external camera may help identify a one-frame compositor glitch; a canvas pixel readback can itself alter the graphics path, so do not use it as the default measurement.

## Ten independent experiments

### 1. Explicit offscreen double buffering (highest-interest code experiment)

In `quadstream-globe/src/globe/runtime.mjs`, keep the existing visible contexts but construct both shared renderers with separate detached canvas contexts. Create one buffer per view, not one shared buffer. For example:

```js
const back = document.createElement("canvas");
const backCtx = back.getContext("2d");
const miniBack = document.createElement("canvas");
const miniBackCtx = miniBack.getContext("2d");
```

Pass `backCtx` to `createGlobeRenderer` and `miniBackCtx` to `createMinimapRenderer`. Before rendering, size each back buffer to match its visible canvas's physical pixel dimensions, assigning only changed dimensions. Keep the existing state DPR, camera, clipping, and scheduler. The existing draw calls now clear and render the back buffers only. After **both** draw calls have completed successfully, present each completed buffer synchronously in the same animation callback, using the existing visible contexts:

```js
function present(frontCtx, backBuffer) {
  frontCtx.save();
  try {
    frontCtx.setTransform(1, 0, 0, 1, 0, 0);
    frontCtx.globalAlpha = 1;
    frontCtx.globalCompositeOperation = "copy";
    frontCtx.drawImage(backBuffer, 0, 0);
  } finally {
    frontCtx.restore();
  }
}
// After both renderers complete:
present(ctx, back);
if (miniCtx) present(miniCtx, miniBack);
```

For this experiment, keep the viewport fixed, leave existing visible-canvas resize behavior unchanged, and do not clear the visible contexts before copying. The buffers have identical dimensions to their destinations so the copy also replaces transparent areas. No worker or OffscreenCanvas transfer is needed. If drawing throws before presentation, the previous visible images remain. The two copies are sequential, not a guaranteed atomic cross-canvas compositor transaction.

**Interpretation:** If flicker disappears, suspect direct rendering/presentation or partial draws; the change also alters timing and GPU resource usage, so confirm with repeat trials. If it persists, application double buffering alone is not sufficient. Watch for added frame time or memory usage.

### 2. Disable motion frame skipping

In `schedule()` in runtime.mjs replace the budget decision and conditional render with:

```js
drawSkipped = false;
render();
```

Leave `advanceCamera()` and the single-rAF scheduling intact. Compare with the original 12 ms budget. **Interpretation:** Improvement implicates scheduling or the cadence of browser presentation; normal skipped draws should retain previous pixels. Slower movement or a different reproduction rate is a confounder.

### 3. Disable smooth navigation

Open the same local URL with `?smooth=0` (or uncheck Settings > Navigation > Smooth navigation). Repeat the gestures at comparable zoom levels. **Interpretation:** Improvement implicates the continuously evolving camera/scheduling path rather than discrete input alone. This also changes draw frequency, so it does not establish a camera math bug.

### 4. Disable viewport clipping

Open with `?clip=0` to use whole-feature culling rather than the padded viewport clipper. Keep smooth navigation and Quadstream geometry enabled as in baseline. **Interpretation:** Improvement narrows the issue to clipping/cache behavior or its workload. If ocean and graticule disappear as well, clipping alone should not explain missing backgrounds.

### 5. Switch to Original geometry

In Settings > Rendering > Geometry choose Original. Keep the same atlas and clipping settings. **Interpretation:** Improvement implicates the progressive geometry/LOD path or its timing; Original may be slower. The coarse minimap context and regional machinery may still be active, so this is not a complete worker shutdown.

### 6. Hold the Quadstream LOD constant

Stay in Quadstream geometry mode. Temporarily replace the body of `targetLevelForView()` in runtime.mjs with `return 4.2;` (the existing minimum automatic LOD). Reload and wait for readiness before interacting. For a more representative follow-up try a constant level matching the zoom region where the glitch was observed. **Interpretation:** Improvement suggests changing LOD requests, reconstruction, or publication timing. Fixed LOD also affects geometry complexity and regional layer thresholds; experiment 7 helps separate those factors.

### 7. Disable regional overlay rendering and loading

In runtime.mjs, temporarily replace the `regional.update(state, { ... })` expression in `render()` with `const overlays = [];` (replace the entire original declaration). Reload, so the session has not already requested regional overlays. Keep the base atlas and LOD behavior unchanged. This prevents the per-frame regional update from requesting or drawing overlay geometry; the catalog fetch may still occur. The existing `?international=0` only disables international catalog loading, not all US overlays. **Interpretation:** Improvement implicates overlay rendering or the additional worker/update workload.

### 8. Change the visible canvas compositing layer

Append this temporary CSS to `quadstream-globe/src/index.css`:

```css
#globe, #minimap {
  transform: translateZ(0);
  will-change: transform;
}
```

Reload and repeat, then remove the CSS. Use the browser's layer inspector, where available, to check whether the layer arrangement actually changed. **Interpretation:** Improvement suggests a compositor/layering sensitivity; these CSS hints do not guarantee GPU promotion and may change performance or stacking. This does not implement double buffering.

### 9. Try a different browser engine

Repeat the baseline in Chromium and Firefox, and Safari/WebKit if available on the same machine. Do not combine this with a source patch. Use equivalent viewport/DPR/settings, and record exact versions. **Interpretation:** If only one engine flickers, prioritize that browser's canvas/compositor path; all engines still share Quadstream logic. Do not infer that a headless WebKit test is equivalent to Safari on real hardware.

### 10. Disable browser graphics acceleration

In Chrome or Edge, turn off Settings > System (or System and performance) > Use graphics acceleration when available, restart the browser, and repeat the unmodified baseline. Restore the setting and restart afterward. Where available, inspect `chrome://gpu` or `edge://gpu` to record the actual graphics backend and feature status. **Interpretation:** If the flicker disappears only on the software path, investigate GPU driver, rasterization, or compositor behavior. Lower FPS can also hide a timing-sensitive defect. Do not ship this browser setting as a product fix.

## Record results

Copy this table into an issue or local notes. Use **improved**, **unchanged**, **worse**, or **inconclusive**, with event counts/duration and relevant visual observations. No outcome is pre-filled.

| Trial | Experiment | Result | Events / duration | Notes |
| --- | --- | --- | --- | --- |
| B | Unmodified baseline | | | |
| 1 | Double buffer | | | |
| 2 | No frame skipping | | | |
| 3 | No smoothing | | | |
| 4 | No viewport clipping | | | |
| 5 | Original geometry | | | |
| 6 | Fixed LOD | | | |
| 7 | No regional overlays | | | |
| 8 | CSS compositing hints | | | |
| 9 | Alternative browser engine | | | |
| 10 | Graphics acceleration off | | | |

Suggested execution order: baseline, 3/4/5 (existing toggles), 1 (double buffering), then 2/6/7/8/9/10 as needed. If the glitch is present on the legacy demo, repeat the successful experiment there using [main.mjs](../examples/globe/main.mjs), which has similar render scheduling. If none works, collect a recording, browser/OS/GPU information, console errors, and a short reproducible gesture sequence before deciding whether deeper instrumentation is justified.

Keep resize investigation out of the primary experiment set unless observations establish that dimensions or DPR change at the time of the glitch. Open a separate implementation PR only after a successful experiment is reproduced and its performance tradeoffs assessed.
