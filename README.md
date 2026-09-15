# HtmlTabletTester

A simple web app for verifying that drawing tablets and pens are working, and for inspecting what the Pointer Events API actually reports on a given device.

**For end-user docs** (what the app does, how to use it, OS/browser support, troubleshooting), see **[USERMANUAL.md](./USERMANUAL.md)**. This README is for developers working on the app itself.

## Scope guard
This is **NOT** a creative digital painting app. Keep the scope narrow: a canvas, the dropdowns that decide what is drawn, and a live readout of `PointerEvent` properties. Resist adding colors, brushes, undo, layers, etc. If you find yourself reaching for those features, you're probably building a different app.

The test that has held so far: a feature earns its place if it makes something about the **pen or the browser's reporting of it** visible. Pressure driving width qualifies, and so does the Points/s readout. A colour picker would not, and neither would a setting for how strokes are drawn.

**Drawing quality is fixed, deliberately.** The app draws from every reported position, fits a curve through them, ramps width between them, and lightly filters the path on its way in. None of that is configurable, because none of it has a setting a visitor would want to change — and because the app's job is to answer "does my tablet work", which a badly drawn stroke gets wrong by making the hardware look at fault.

Experiments with alternatives belong in [WebStrokeExperimentLab](https://github.com/TheSevenPens/WebStrokeExperimentLab), which has a control for every stage of drawing so any two can be compared. That is where the way this app draws was worked out, and where the next change to it should be tried first. Anything that proves worth having comes back here as fixed behaviour with no setting attached.

## Live site
<https://thesevenpens.github.io/WebTabletTesterBasic/>

## Repo
[`WebTabletTesterBasic`](https://github.com/TheSevenPens/WebTabletTesterBasic)

## Project layout
A single-page static site — no build step, no dependencies.

- `index.html` — toolbar in two rows (controls on top: Clear, Mode, Export, About; pen readouts underneath) and the fullscreen `<canvas>`; About dialog markup
- `app.js` — Pointer Events wiring, canvas sizing (HiDPI-aware: backing store in screen pixels, context scaled so drawing code stays in CSS pixels), drawing (stepped and tapered segments, oval stamps), curve fitting, info display, About-dialog handler
- `style.css` — toolbar layout; `touch-action: none` and `overscroll-behavior: none` on the canvas to suppress browser pan/zoom/pull-to-refresh while drawing; About-dialog styling
- `USERMANUAL.md` — end-user documentation (linked from the README and the in-app About dialog)

## Running locally
Open `index.html` directly in a browser (`file://`). No webserver needed.

## Manual checks before shipping
There are no automated tests. Run each in the relevant **Mode** before pushing changes that touch drawing or pointer handling:

- **Pressure to Size**: pen pressure varies stroke width; mouse draws a mid-width stroke (pressure 0.5)
- Strokes are smooth: width ramps between readings rather than stepping, and a quickly drawn arc has no visible corners. A slowly drawn one is reasonably even, though not perfectly — that residue is quantisation, not a regression
- A stroke begins exactly where the pen touched down. The filter must not drag the first point toward anywhere else The ink lags the pen by one reading, and the final segment appears when the pen lifts — a stroke must not end short of where the pen was raised
- **Points/s** shows a number while a real pointer is moving, returns to `---` within about half a second of it stopping, and reads `n/a` in a browser without `getCoalescedEvents()`. Events dispatched from script contribute nothing, so this cannot be checked by automation
- **Tilt Azimuth to Brush rotation**: leaning the pen in different compass directions rotates the oval accordingly
- **Tilt Altitude to Brush size**: upright pen produces a small circle; tilting the pen toward flat stretches the oval in the leaning direction
- **Twist to Brush rotation**: rotating the pen barrel rotates the oval (only relevant on hardware that reports twist)
- **Pointer only (no drawing)**: a red crosshair follows the pointer; no strokes are drawn. Crosshair stays visible while pressing. Crosshair hides on pointerleave and when switching to another mode.
- Readouts (tiltX/Y, azimuth, altitude, twist) update live regardless of mode
- A tap — press and release without moving — leaves a mark in all four drawing modes
- A stroke reaches the position the pen was lifted from, not one reading short of it
- Pressing a pen's barrel button in mid-air draws nothing, and lifting the tip while holding it ends the stroke
- Clearing mid-stroke and then releasing leaves the canvas empty; changing mode mid-stroke does not paint the abandoned one
- Releasing updates the readouts to the released state; the pointer leaving blanks them
- Twist rotates the brush the same way the pen turns
- With `azimuthAngle`/`altitudeAngle` removed from `PointerEvent.prototype`, both tilt modes still draw and both readouts still show numbers
- Delete / Backspace clears the canvas; the Clear button clears the canvas
- Window resize re-fits and clears the canvas
- **HiDPI rendering**: on a display with `devicePixelRatio` > 1, stroke edges are crisp rather than blocky. Browser zoom (Ctrl +/-) and dragging the window to a monitor with a different scale factor both re-size the backing store and keep strokes crisp
- Right-click does not open a context menu
- About button opens the dialog; Esc and the dialog's Close button both dismiss it
- Export → Save as PNG downloads a `tablet-tester.png` file matching what's on the canvas, at the display's full pixel resolution (on a 2x display a 1200x800 window exports a 2400x1600 image)
- Export → Copy to clipboard pastes as an image into another app (needs a browser with async `ClipboardItem` support)

For OS/browser-specific quirks (and what's known to work), see the [User Manual](./USERMANUAL.md#os--browser-compatibility).

## Deployment
Pushes to `main` are published automatically by GitHub Pages.

## Developer resources
- MDN Pointer Events API: <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events>
- Original docs page: <https://docs.sevenpens.com/drawtab/resources/sevenpens-tablet-tester>
