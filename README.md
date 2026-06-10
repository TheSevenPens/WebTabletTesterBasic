# HtmlTabletTester

A simple web app for verifying that drawing tablets and pens are working, and for inspecting what the Pointer Events API actually reports on a given device.

**For end-user docs** (what the app does, how to use it, OS/browser support, troubleshooting), see **[USERMANUAL.md](./USERMANUAL.md)**. This README is for developers working on the app itself.

## Scope guard
This is **NOT** a creative digital painting app. Keep the scope narrow: a canvas, a Mode dropdown, and a live readout of `PointerEvent` properties. Resist adding colors, brushes, undo, layers, save/export, etc. If you find yourself reaching for those features, you're probably building a different app.

## Live site
<https://thesevenpens.github.io/WebTabletTesterBasic/>

## Repo
[`WebTabletTesterBasic`](https://github.com/TheSevenPens/WebTabletTesterBasic)

## Project layout
A single-page static site — no build step, no dependencies.

- `index.html` — toolbar (Clear, Mode dropdown, live readouts, About) and the fullscreen `<canvas>`; About dialog markup
- `app.js` — Pointer Events wiring, drawing (circular + oval-stamp brushes), info display, About-dialog handler
- `style.css` — toolbar layout; `touch-action: none` and `overscroll-behavior: none` on the canvas to suppress browser pan/zoom/pull-to-refresh while drawing; About-dialog styling
- `USERMANUAL.md` — end-user documentation (linked from the README and the in-app About dialog)

## Running locally
Open `index.html` directly in a browser (`file://`). No webserver needed.

## Manual checks before shipping
There are no automated tests. Run each in the relevant **Mode** before pushing changes that touch drawing or pointer handling:

- **Pressure to Size**: pen pressure varies stroke width; mouse draws a mid-width stroke (pressure 0.5)
- **Tilt Azimuth to Brush rotation**: leaning the pen in different compass directions rotates the oval accordingly
- **Tilt Altitude to Brush size**: upright pen produces a small circle; tilting the pen toward flat stretches the oval in the leaning direction
- **Twist to Brush rotation**: rotating the pen barrel rotates the oval (only relevant on hardware that reports twist)
- **Pointer only (no drawing)**: a red crosshair follows the pointer; no strokes are drawn. Crosshair stays visible while pressing. Crosshair hides on pointerleave and when switching to another mode.
- Readouts (tiltX/Y, azimuth, altitude, twist) update live regardless of mode
- Delete / Backspace clears the canvas; the Clear button clears the canvas
- Window resize re-fits and clears the canvas
- Right-click does not open a context menu
- About button opens the dialog; Esc and the dialog's Close button both dismiss it

For OS/browser-specific quirks (and what's known to work), see the [User Manual](./USERMANUAL.md#os--browser-compatibility).

## Deployment
Pushes to `main` are published automatically by GitHub Pages.

## Developer resources
- MDN Pointer Events API: <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events>
- Original docs page: <https://docs.sevenpens.com/drawtab/resources/sevenpens-tablet-tester>
