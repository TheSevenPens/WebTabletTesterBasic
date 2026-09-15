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

The toolbar has two rows: what you set on top, and what the pen reports underneath. The readouts
change many times a second while you draw, so keeping them on their own row stops the controls
moving under the pointer as values change width.

| Control | What it shows / does |
| --- | --- |
| **Clear** | Wipes the canvas. |
| **Export…** | Save the current canvas as a PNG file, or copy it to the clipboard as an image (paste into chat, an image editor, etc.). The image is captured at your display's full pixel resolution, so stroke detail survives zooming in. Useful for sharing what your pen is producing when reporting a driver issue. |
| **Mode** | Picks which pen input drives the brush — see below. |
| **Stroke** | How the ink between two pen samples is drawn — see [Stroke rendering](#stroke-rendering). Only **Pressure to Size** draws that kind of ink, so the control is disabled in the other modes. |
| **Type** | `pen`, `mouse`, or `touch` — what the browser thinks the input device is. |
| **Pressure** | 0.000 – 1.000. Mouse always reports `0.5`. |
| **Tilt X** | -90° to 90°. Left/right tilt of the pen. |
| **Tilt Y** | -90° to 90°. Forward/back tilt of the pen. |
| **Azimuth** | 0° – 360°. Compass direction the pen is leaning. |
| **Altitude** | 0° – 90°. 0° = pen flat on the tablet, 90° = perfectly upright. |
| **Twist** | 0° – 359°. Rotation around the pen's long axis (barrel rotation). |
| **Eraser** | `yes` when the eraser end of the pen is in contact, `no` otherwise. Detected via the eraser bit (32) of `PointerEvent.buttons`. Not all pens have an eraser end, and some drivers report the eraser as a normal tip contact — see [Known quirks](#known-quirks). |
| **Buttons** | The raw `PointerEvent.buttons` bitmask shown in binary (6 bits). From least significant: tip/primary, barrel/secondary, middle, X1, X2, eraser. Handy for spotting which buttons your driver reports. |
| **Points/s** | Two numbers: how many positions your pen reports each second, and how many of those the stroke is built from — see [Report rate](#report-rate). `n/a` means this browser cannot say. |
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

## Stroke rendering

A pen reports samples, not a stroke. The **Stroke** dropdown picks what is drawn *between* two
samples, which is where a surprising amount of what a stroke looks like is decided. It applies to
**Pressure to Size**; the oval modes stamp ellipses and have no line width to ramp or path to fit.

- **Stepped width** — one width for the whole segment, taken from the pressure at its far end.
  Width therefore changes in a step at every sample rather than along the segment, and the edge of
  a stroke is a staircase. At tablet report rates that is everywhere. *This is what naive canvas
  code does, and it is here to be looked at rather than used.*
- **Taper (straight)** — the segment is the region swept between two circles, one at each sample,
  so the width ramps continuously. Consecutive segments share an endpoint **and** a width, so the
  ramp is continuous across the whole stroke. The path itself is still a chord from each sample to
  the next. *Use this to see where the samples actually are:* on anything drawn quickly the corners
  between chords are plainly visible, and you can count the report rate off them.
- **Taper (curved)** — the same taper, with a cubic fitted through the samples instead of chords.
  The corners go away. *Use this to see how much of a stroke's shape is interpolation rather than
  measurement.*

The difference between the two taper options is entirely about the path, and it grows with the gap
between samples: a slow stroke on a high-reporting tablet looks the same either way, and a fast one
on a slow tablet does not.

**A note on what Curved costs.** The tangent at a sample is computed from its neighbours, so the
segment ending at a sample cannot be drawn until the next one arrives — the ink lags the pen by one
sample, and the last segment is painted when the pen lifts. That is the price of the curve meeting
its neighbours smoothly, and every application that fits curves to pen input pays it in some form.

The curve fitting is Krita's, by way of the C# implementation in
[PenDynamicsPaint](https://github.com/TheSevenPens/PenDynamicsPaint), and is kept close to that
version on purpose so the two can be compared.

## Report rate

Two numbers, and the gap between them is the interesting part.

**pen** — how many positions your pen sends every second. A mouse is usually around 125. Drawing
tablets are typically 130 to 250, and some are much faster. This is your hardware.

**used** — how many of those the stroke on screen is actually built from. This is normally about 60,
whatever the pen is doing, because it matches how often your screen redraws.

So a tablet reporting 200 times a second has roughly 140 of those readings a second discarded before
anything is drawn. That is not a fault in this app; it is how a web page ordinarily receives pen
input, and the same is true of most drawing done in a browser.

**Why the two numbers differ.** The browser does not hand a web page every reading as it arrives. It
waits until the screen is about to redraw and delivers everything that has happened since in one
bundle. An application that takes one position from each bundle — which is the usual thing to do,
and what this app does — gets the display's rate. The rest are still in the bundle, unopened, and
counting them is how **pen** is measured.

**What the values mean**

- **Numbers** — measured over the last second of movement. They settle after about a fifth of a
  second of drawing.
- **`---`** — nothing is moving, or not enough has happened yet to measure.
- **`n/a`** — this browser cannot report it. Chrome, Edge and Firefox have been able to for years;
  Safari only from **18.2**, so an older iPad or Mac says `n/a`. In those browsers a page cannot
  measure the pen's rate at all — only the display's.
- **pen and used the same** — nothing is being discarded, because the pen is not reporting faster
  than the screen refreshes. Normal for a mouse.

**What the difference costs you.** Every discarded reading is a small piece of the shape of your
stroke that no application ever saw: a change of direction, a moment of pressure. The
**Taper (curved)** option under [Stroke rendering](#stroke-rendering) guesses some of it back by
fitting a curve through the positions it did get, which is what most drawing software does. It is a
good guess, not the real thing.

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
