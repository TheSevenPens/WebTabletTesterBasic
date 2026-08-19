# SevenPens Tablet Tester — User Manual

A simple web app for verifying that your drawing tablet and its pen are working, and for exploring what data the browser reports about each pen event. Useful when:

- You're troubleshooting a pen that "doesn't feel right" (no pressure, tilt missing, etc.).
- You're comparing two tablets or two drivers.
- You're a developer wanting to see what the Pointer Events API actually delivers on your hardware.

It is **not** a drawing app — there are no colors, brushes, layers, or save/export. The strokes you make are only meant to show that the pen is reporting what you'd expect.

## Quick start

1. Open the [live app](https://thesevenpens.github.io/WebTabletTesterBasic/).
2. Draw on the blue canvas with your pen, finger, or mouse.
3. Watch the toolbar readouts update as you draw — they show the raw values the browser is reporting for the current pointer event.
4. Use the **Mode** dropdown to switch which pen property drives the brush (see [Testing modes](#testing-modes) below).
5. Press **Clear**, or **Delete** / **Backspace**, to clear the canvas.

## Toolbar reference

| Control | What it shows / does |
| --- | --- |
| **Clear** | Wipes the canvas. |
| **Mode** | Picks which pen input drives the brush — see below. |
| **Type** | `pen`, `mouse`, or `touch` — what the browser thinks the input device is. |
| **Pressure** | 0.000 – 1.000. Mouse always reports `0.5`. |
| **Tilt X** | -90° to 90°. Left/right tilt of the pen. |
| **Tilt Y** | -90° to 90°. Forward/back tilt of the pen. |
| **Azimuth** | 0° – 360°. Compass direction the pen is leaning. |
| **Altitude** | 0° – 90°. 0° = pen flat on the tablet, 90° = perfectly upright. |
| **Twist** | 0° – 359°. Rotation around the pen's long axis (barrel rotation). |
| **Eraser** | `yes` when the eraser end of the pen is in contact, `no` otherwise. Detected via the eraser bit (32) of `PointerEvent.buttons`. Not all pens have an eraser end, and some drivers report the eraser as a normal tip contact — see [Known quirks](#known-quirks). |
| **Buttons** | The raw `PointerEvent.buttons` bitmask shown in binary (6 bits). From least significant: tip/primary, barrel/secondary, middle, X1, X2, eraser. Handy for spotting which buttons your driver reports. |
| **About** | Opens a dialog with Code and Docs links. |

If a value stays at `0` or `---` while you draw, your pen or driver isn't reporting that property.

## Testing modes

The **Mode** dropdown selects which pen property drives the brush. Each mode is meant to isolate one input so a behavior problem can be narrowed down quickly.

- **Pressure to Size** — Circular brush. Stroke width scales with pressure. *Use this to verify pressure sensitivity is working.* Mouse events synthesize a pressure of 0.5, so a mouse always draws a mid-width stroke.
- **Tilt Azimuth to Brush rotation** — Fixed elongated oval brush, rotated to match the pen's compass-direction tilt. *Use this to verify azimuth reporting.* The oval should rotate as you lean the pen in different directions.
- **Tilt Altitude to Brush size** — Oval brush whose long axis grows as the pen tilts away from upright. Upright pen → small circle; pen flat on the tablet → very elongated oval. Rotation comes from azimuth, so the oval stretches in the direction the pen is leaning. *Use this to verify altitude reporting.*
- **Twist to Brush rotation** — Fixed elongated oval brush, rotated by the pen's barrel twist. *Use this to verify twist reporting* — only meaningful on pens that report twist (e.g. some Wacom Art Pens). Most pens report twist as `0`.
- **Pointer only (no drawing)** — Shows a red crosshair that follows the reported pointer position, with no strokes left behind. The crosshair stays visible even while the pen is pressing down (when the OS would normally hide the system cursor). *Use this to check pointer tracking accuracy and latency, or to confirm the browser is receiving events at all, without cluttering the canvas.*

The rotation modes deliberately use a very elongated oval so that small changes in the driving angle are visible.

## OS & browser compatibility

| OS | Browser | Status |
| --- | --- | --- |
| Windows | Chrome, Edge, Firefox | Works. Requires **Windows Ink** enabled in your tablet driver settings. WinTab-only drivers will not report pressure. |
| macOS | Chrome | Works. |
| macOS | Safari | Works with [a known quirk](#known-quirks). |
| Linux | Chrome | Works. |
| Linux | Firefox (Wayland) | Works. |
| Linux | Firefox (X11) | Requires environment variable `MOZ_USE_XINPUT2=1`. |
| iPadOS | Safari | Works (Apple Pencil). |
| Android | Chrome | Works. |

## Known quirks

- **macOS Safari** — If the app loads while the pen is already in contact with the tablet, the pen may be treated as a mouse (no pressure, no tilt). **Workaround:** lift the pen away from the tablet and bring it back into range.
- **Windows, no pressure** — If pressure reads `0.000` or jumps straight to `1.000` with no in-between, the driver is most likely running in WinTab-only mode. Enable Windows Ink in your tablet's driver utility.
- **Apple Pencil twist** — Apple Pencil does not report barrel rotation; **Twist** will stay at `0°`.
- **Most pens, no twist** — Twist requires hardware support (e.g. Wacom Art Pen). Most styli will report `0°`.
- **Eraser detection is driver-dependent** — Pens with a physical eraser end (e.g. many Wacom pens) will set the eraser bit on Windows Chrome/Edge/Firefox with Windows Ink enabled. Apple Pencil has no eraser end. Some pens/drivers map the eraser to a normal tip contact plus a configurable button, so the **Eraser** readout stays `no` even when the eraser is touching the tablet.
- **Mouse / touch values** — Mouse always reports pressure `0.5` and zero tilt/azimuth/altitude/twist. Touch typically reports no pressure or tilt either. These are not bugs in the tester — they reflect what the browser delivers.

## Privacy

The Tablet Tester:

- Does **not** collect any data about you or your computer.
- Does **not** use cookies.
- Does **not** track your behavior.
- Does **not** record what you draw.

It is a static web page that runs entirely in your browser.

## Source code

The app is open source — review, fork, and modify freely:
<https://github.com/TheSevenPens/WebTabletTesterBasic>

## Further reading

- MDN Pointer Events API: <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events>
- Original docs page: <https://docs.sevenpens.com/drawtab/resources/sevenpens-tablet-tester>
