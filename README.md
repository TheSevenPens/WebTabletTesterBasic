# HtmlTabletTester

## Overview
The Tablet Tester is a simple online tool to better understand how digital pens work. It is useful for troubleshooting pen problems and as a basis for developers to explore pen behavior. It is **NOT** intended as a creative digital painting app — keep the scope narrow: a canvas, a live readout of `PointerEvent` properties, and nothing else. Resist adding colors, brushes, undo, layers, save/export, etc.

## Live site
Hosted on GitHub Pages: <!-- TODO: paste the Pages URL, e.g. https://thesevenpens.github.io/WebTabletTesterBasic/ -->

## Repo relationship
This repo is [`WebTabletTesterBasic`](https://github.com/TheSevenPens/WebTabletTesterBasic)

## Project layout
A single-page static site — no build step, no dependencies.

- `index.html` — toolbar (Clear button + live readouts) and the fullscreen `<canvas>`
- `app.js` — Pointer Events wiring, drawing, info display
- `style.css` — toolbar layout; `touch-action: none` and `overscroll-behavior: none` on the canvas to suppress browser pan/zoom/pull-to-refresh while drawing

## Running locally
- Open `index.html` directly in a browser (`file://`)

You don't need to serve this app with a webserver.


## Testing modes
The toolbar has a **Mode** dropdown that selects which pen property drives the brush. Each mode is meant to isolate one input so a behavior problem can be narrowed down quickly.

- **Pressure to Size** — circular brush. Stroke width scales with `e.pressure`. Default mode.
- **Tilt Azimuth to Brush rotation** — fixed oval brush, rotated by `e.azimuthAngle` (the compass direction the pen is leaning).
- **Tilt Altitude to Brush size** — oval brush. When the pen is upright (`altitudeAngle` ≈ π/2) the brush is a small circle; as the pen tilts toward flat (`altitudeAngle` → 0) the long axis grows up to ~2× `OVAL_RADIUS_X`. Rotation is driven by `e.azimuthAngle`, so the brush stretches in the direction the pen is leaning.
- **Twist to Brush rotation** — fixed oval brush, rotated by `-e.twist` (inverted so the brush rotates in the same visual direction the pen barrel is turning, for the hardware tested).

The rotation modes deliberately use a very elongated oval so that small changes in the driving angle are visible.

## Supported browsers / OSes
<!-- TODO: list the actual support targets. The Safari/macOS quirk below implies macOS Safari is one — confirm and add the others (Chrome/Edge on Windows, Firefox, iPadOS Safari, etc.). -->

## Testing without a pen
Mouse and touch are valid `pointerType` values, so you can smoke-test most of the UI without a stylus:
- **Mouse**: `e.pressure` is reported as `0.5` (synthesized), tilt/azimuth/twist are `0`. Good enough to verify drawing, clear, and resize.
- **Touch**: reports as `pointerType === "touch"`, no tilt/pressure on most devices.
- **Pen**: required to actually exercise pressure, tilt, azimuth, altitude, and twist.

There are no automated tests. Manual checks before shipping (run each in the relevant Mode):
- **Pressure to Size**: pen pressure varies stroke width; mouse draws a mid-width stroke (pressure 0.5)
- **Tilt Azimuth to Brush rotation**: leaning the pen in different compass directions rotates the oval accordingly
- **Tilt Altitude to Brush size**: upright pen produces a small circle; tilting the pen toward flat stretches the oval in the leaning direction
- **Twist to Brush rotation**: rotating the pen barrel rotates the oval (only relevant on hardware that reports twist)
- Readouts (tiltX/Y, azimuth, altitude, twist) update live regardless of mode
- Delete / Backspace clears the canvas; the Clear button clears the canvas
- Window resize re-fits and clears the canvas
- Right-click does not open a context menu

## Known browser/OS quirks

- MacOS Safari - When the app starts and the pen is already contacting the tablet, then pen may be treated as a mouse. This is a MacOS issues. The workaround is to initially move the pen away from the tablet and then bring it back in range. 

## Deployment
Pushes to `main` are published automatically by GitHub Pages. <!-- TODO: confirm — is Pages set to build from `main` root, a `docs/` folder, or a `gh-pages` branch? Any custom domain / CNAME? -->

## Docs
https://docs.thesevenpens.com/drawtab/developers/online-tablet-tester

## Code
https://github.com/TheSevenPens/WebTabletTesterBasic

## Developer resources
https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
