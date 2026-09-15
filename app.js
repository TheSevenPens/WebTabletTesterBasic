// ============================================================
// Stylus Hello World
//
// Demonstrates how to read stylus/pen data from the
// Pointer Events API and use it to draw on an HTML5 canvas.
//
// Key stylus properties available on PointerEvent:
//   e.pointerType   - "pen", "mouse", or "touch"
//   e.pressure      - 0.0 to 1.0 (tip pressure)
//   e.tiltX         - -90 to 90 degrees (left/right tilt)
//   e.tiltY         - -90 to 90 degrees (forward/back tilt)
//   e.azimuthAngle  - 0 to 2π radians (compass direction of tilt)
//   e.altitudeAngle - 0 to π/2 radians (0 = flat, π/2 = vertical)
//   e.twist         - 0 to 359 degrees (barrel rotation)
//   e.buttons       - bitmask: 1=tip, 2=barrel button, 32=eraser
// ============================================================

const canvas  = document.getElementById('canvas');
const toolbar = document.getElementById('toolbar');
const modeSelect = document.getElementById('mode');
const cursorIndicator = document.getElementById('cursor-indicator');
const ctx = canvas.getContext('2d');

const infoEls = {
    type:     document.getElementById('val-type'),
    pressure: document.getElementById('val-pressure'),
    tiltX:    document.getElementById('val-tiltX'),
    tiltY:    document.getElementById('val-tiltY'),
    azimuth:  document.getElementById('val-azimuth'),
    altitude: document.getElementById('val-altitude'),
    twist:    document.getElementById('val-twist'),
    eraser:   document.getElementById('val-eraser'),
    buttons:  document.getElementById('val-buttons'),
    rate:     document.getElementById('val-rate'),
};

// Whether this browser will hand over the positions it merged into each move event.
// Chrome, Edge and Firefox have for years; Safari only from 18.2, so on an older iPad
// the app draws from one position per event and says so rather than inventing a rate.
const HAS_COALESCED = typeof PointerEvent.prototype.getCoalescedEvents === 'function';

// PointerEvent.buttons is a bitmask. Bit 5 (value 32) is the eraser end
// of a stylus per the Pointer Events spec.
const ERASER_BUTTON_BIT = 32;

const CANVAS_BG = '#e6e6fa';
const MAX_BRUSH_SIZE = 50; // brush diameter in pixels at full pressure
const OVAL_RADIUS_X = 22;  // long axis of the oval brush (rotation modes)
const OVAL_RADIUS_Y = 4;   // short axis of the oval brush (rotation modes)
const OVAL_STAMP_SPACING = 2; // px between stamps along a stroke

// Curve fitting: the longest straight piece a fitted cubic is cut into, and the
// most pieces one segment may become however long it is.
const FLATTENING_STEP = 1.0;
const MAX_PIECES = 200;

// How far the control handles reach toward their targets, and the distance past
// which a computed intersection is treated as degenerate. Krita's values.
const CONTROL_REACH = 0.8;
const MAX_SANE_POINT = 1e6;


// ── Canvas setup ─────────────────────────────────────────────

// The canvas is laid out in CSS pixels but its backing store is sized in real
// screen pixels, with the context scaled to match. Without this the bitmap is
// stretched by the compositor on any HiDPI display — at devicePixelRatio 2 a
// stroke is rasterised at half the display's resolution and then upscaled,
// which reads as blocky edges and hides the sub-pixel precision a pen reports.
// All drawing code keeps working in CSS pixels, so brush sizes and the pointer
// event's offsetX/offsetY need no adjustment.

// Exact device-pixel content box for the canvas, as reported by
// ResizeObserver. Null until the observer first fires, and on browsers that do
// not support the device-pixel-content-box.
let devicePixelBox = null;

// Sizes last applied, so repeat calls with nothing to do are skipped.
let applied = { cssWidth: 0, cssHeight: 0, width: 0, height: 0 };

let resizeRafId = 0;

// Coalesce bursts of resize/observer callbacks into one resize per frame.
function scheduleResize() {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
        resizeRafId = 0;
        resizeCanvas();
    });
}

// Backing-store size in real screen pixels. The observer's device-pixel
// content box is exact; rounding the CSS box by devicePixelRatio is the
// fallback for browsers that do not report it, and can drift by a fraction of
// a pixel when the layout size is fractional.
function backingSize(cssWidth, cssHeight) {
    if (devicePixelBox && devicePixelBox.width > 0 && devicePixelBox.height > 0) {
        return devicePixelBox;
    }
    const dpr = window.devicePixelRatio || 1;
    return {
        width: Math.max(1, Math.round(cssWidth * dpr)),
        height: Math.max(1, Math.round(cssHeight * dpr)),
    };
}

function resizeCanvas() {
    const cssWidth = Math.max(1, window.innerWidth);
    const cssHeight = Math.max(1, window.innerHeight - toolbar.offsetHeight);

    // Layout size, in CSS pixels.
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    const { width, height } = backingSize(cssWidth, cssHeight);
    if (width === applied.width && height === applied.height &&
        cssWidth === applied.cssWidth && cssHeight === applied.cssHeight) {
        return;
    }
    applied = { cssWidth, cssHeight, width, height };

    // Backing-store size, in screen pixels.
    canvas.width = width;
    canvas.height = height;

    // Assigning width/height resets the context, so the scale has to be
    // (re)applied every time the canvas is sized.
    ctx.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0);
    clearCanvas();
}

// Wipes the picture *and* abandons the stroke in progress.
//
// Clearing only the pixels left the fitter and the filter holding samples, so releasing
// the pen after pressing Delete painted the cleared stroke back onto the empty canvas.
// Changing mode mid-stroke did the same thing from the other direction.
function clearCanvas() {
    resetStroke();
    // Fill the whole backing store, which is measured in screen pixels, so
    // drop the CSS-pixel scale for the duration of the fill.
    const transform = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(transform);
}


// ── Drawing ───────────────────────────────────────────────────

// Brush diameter for one pressure reading. Mouse events report 0.5, so a mouse
// draws at half size rather than not at all.
function widthFor(pressure) {
    return Math.max(1, pressure * MAX_BRUSH_SIZE);
}

// Fill the outline of two circles and the region swept between them, so the width
// ramps continuously from one sample to the next instead of stepping. Consecutive
// segments share an endpoint *and* a width, so the ramp is continuous across the
// whole stroke rather than only within each piece of it.
//
// One closed contour, not a quad plus two circles. The obvious construction paints
// the overlaps twice, which is invisible in opaque black and shows as darker
// lozenges at every sample the moment the ink is translucent.
//
// The straight sides are the circles' external tangents. Both touch points lie at the
// same angle from the line of centres, and that angle is the one where the side is
// perpendicular to the radius. Working it out: a side runs from
// `a + ra*(cos t, sin t)` to `b + rb*(cos t, sin t)`, and requiring that direction to
// be perpendicular to `(cos t, sin t)` gives `cos t = (ra - rb) / d` — so the offset
// from the perpendicular is subtracted, not added.
//
// This had the sign the other way and drew sides that were not tangent to anything:
// with radii 25 and 5 thirty pixels apart, the supposed tangent met the radius at a
// dot product of -40 rather than 0, and a corner of the larger disk was left unpainted.
// Invisible in ordinary drawing, where consecutive readings differ by a fraction of a
// pixel and the angle is nearly zero either way; visible wherever width changes
// sharply, which is every stroke's beginning and end.
function drawTaperSegment(from, to) {
    const a = from, b = to;
    const ra = Math.max(widthFor(from.pressure) / 2, 0.01);
    const rb = Math.max(widthFor(to.pressure) / 2, 0.01);

    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);

    ctx.fillStyle = 'black';
    ctx.beginPath();

    // Degenerate: the centres coincide, or one circle swallows the other. There are
    // no tangents to compute and the union is just the larger circle.
    if (d <= Math.abs(ra - rb) + 1e-4) {
        if (ra >= rb) ctx.arc(a.x, a.y, ra, 0, Math.PI * 2);
        else ctx.arc(b.x, b.y, rb, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    const phi = Math.atan2(dy, dx);
    const alpha = Math.asin(clamp((ra - rb) / d, -1, 1));

    // Where the two tangent lines touch, one either side of the axis.
    const up = phi + Math.PI / 2 - alpha;
    const down = phi - Math.PI / 2 + alpha;

    ctx.moveTo(a.x + ra * Math.cos(up), a.y + ra * Math.sin(up));
    ctx.lineTo(b.x + rb * Math.cos(up), b.y + rb * Math.sin(up));

    // Round the far end, then the near one. Both sweeps run the same way round so the
    // contour stays simple, and together they account for the whole turn: the two caps
    // are (pi - 2*alpha) and (pi + 2*alpha), which is 2*pi however unequal the radii.
    ctx.arc(b.x, b.y, rb, up, up - (Math.PI - 2 * alpha), true);
    ctx.lineTo(a.x + ra * Math.cos(down), a.y + ra * Math.sin(down));
    ctx.arc(a.x, a.y, ra, down, down - (Math.PI + 2 * alpha), true);

    ctx.closePath();
    ctx.fill();
}

function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

// Stamp an oval at `pos` with the given radii and rotation.
function stampOval(pos, brush) {
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, brush.rx, brush.ry, brush.rot, 0, Math.PI * 2);
    ctx.fill();
}

// Draw an oval-brush stroke from `from` to `to` by stamping ovals
// along the segment. All stamps in a single segment share the same brush
// (taken from the current pointer event).
function drawOvalStroke(from, to, brush) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / OVAL_STAMP_SPACING));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        stampOval({ x: from.x + dx * t, y: from.y + dy * t }, brush);
    }
}

// Build the brush spec {rx, ry, rot} for the current oval-brush mode.
function brushForMode(mode, e) {
    switch (mode) {
        case 'azimuth-rotation':
            return { rx: OVAL_RADIUS_X, ry: OVAL_RADIUS_Y, rot: azimuthOf(e) };
        case 'altitude-size': {
            // Upright (altitude = π/2) → circle. Flat (altitude = 0) → elongated.
            // Azimuth picks the direction the ellipse stretches.
            const tilt = 1 - Math.min(1, altitudeOf(e) / (Math.PI / 2));
            const maxRx = OVAL_RADIUS_X * 2;
            const rx = OVAL_RADIUS_Y + tilt * (maxRx - OVAL_RADIUS_Y);
            return { rx, ry: OVAL_RADIUS_Y, rot: azimuthOf(e) };
        }
        case 'twist-rotation':
            // Not negated. PointerEvent.twist and the canvas ellipse rotation both
            // increase in the same direction, so negating it turned the brush the
            // opposite way from the pen -- a tester reporting a direction backwards.
            return { rx: OVAL_RADIUS_X, ry: OVAL_RADIUS_Y, rot: radians(e.twist ?? 0) };
        default:
            return { rx: OVAL_RADIUS_X, ry: OVAL_RADIUS_Y, rot: 0 };
    }
}


// ── Smoothing ─────────────────────────────────────────────────

// Each position is replaced by a step from the last filtered position toward it.
//
// Streamlining, as the web's drawing libraries do it: perfect-freehand calls the
// amount `streamline` and defaults it to 0.5, which is the value used here;
// atrament's equivalent defaults to 0.85. Every one of them filters by default, so a
// visitor comparing this app against anything else they have drawn in would
// otherwise be comparing a raw signal against filtered ones.
//
// What it is actually fixing here is not a shaky hand. Pen positions arrive
// quantised to whole screen pixels, which is invisible at speed and shows as an
// uneven edge when a slow stroke lands its samples a pixel or two apart; a filter
// reconstructs a path between the grid points. Measured against a true straight line
// on a snapped diagonal, mean distance fell from 0.141 px to 0.082 px at this
// setting.
//
// Half, and no setting. Heavier looks calmer and starts to visibly trail the pen,
// which in a tool for deciding whether a tablet is working would be its own false
// alarm. At this strength and a tablet's report rate the filter settles within a
// couple of readings, which is well under the time it takes a frame to appear.
const STREAMLINE = 0.5;

let streamlined = null;

function resetSmoothing() {
    streamlined = null;
}

// Put the filter exactly on a position, so the next sample is not dragged back toward
// where the ink had lagged to. Used when a stroke ends: the last mark belongs at the
// place the pen was lifted, not one reading short of it.
function settleSmoothing(sample) {
    streamlined = { x: sample.x, y: sample.y };
}

function smooth(sample) {
    // The first position of a stroke has nothing to be filtered toward, and starting
    // anywhere else would drag the stroke away from the point it began at.
    if (streamlined === null) {
        streamlined = { x: sample.x, y: sample.y };
        return sample;
    }

    const step = 1 - STREAMLINE;
    streamlined = {
        x: streamlined.x + (sample.x - streamlined.x) * step,
        y: streamlined.y + (sample.y - streamlined.y) * step,
    };

    return { ...sample, x: streamlined.x, y: streamlined.y };
}


// ── Curve fitting ─────────────────────────────────────────────

// Fits a cubic through the pen samples so the ink between them follows an arc
// rather than a chord. Krita's Bezier interpolation, by way of the C# port in
// TheSevenPens/PenDynamicsPaint (Drawing/CurveFitter.cs); kept close to that
// version deliberately, so the two can be compared.
//
// Without it a stroke is a polygon. A pointermove arrives about once a frame, so on
// anything drawn quickly the samples are far apart and the corners between them are
// plainly visible — which is exactly what the Straight option shows.
//
// It lags one sample. The tangent at a sample is the central difference through its
// neighbours, so the segment ending at a sample cannot be drawn until the next one
// arrives; flush() paints the one still owed when the pen lifts. The alternative, a
// one-sided tangent, gives a curve that does not meet its neighbour smoothly, which
// is the artifact this exists to remove.
//
// Output is a flattened path, not a curve: each fitted segment is subdivided into
// short straight pieces, so whatever draws the ink keeps taking two samples at a
// time and did not have to change.
class CurveFitter {
    constructor() {
        this.reset();
    }

    reset() {
        this.older = null;
        this.previous = null;
        this.previousTangent = null;
        this.haveTangent = false;
    }

    // Take one sample, and give back the path that is now settled enough to draw.
    // Empty for the first two samples of a stroke: there is no segment to draw until
    // two have arrived, and no curve until three.
    next(sample) {
        if (this.previous === null) {
            this.previous = sample;
            return [sample];                 // the stroke has to start somewhere
        }

        const previous = this.previous;

        if (!this.haveTangent) {
            // The first tangent is a forward difference, over one interval.
            this.previousTangent = difference(previous, sample, 1);
            this.haveTangent = true;
            this.older = previous;
            this.previous = sample;
            return [];                       // owed: the segment from older to previous
        }

        // A central difference through the neighbours, over two intervals.
        const newTangent = difference(this.older, sample, 2);
        const points = fitCubic(this.older, previous, this.previousTangent, newTangent);

        this.previousTangent = newTangent;
        this.older = previous;
        this.previous = sample;
        return points;
    }

    // The segment still owed, which is the one ending at the last sample. Without
    // this every stroke would stop one sample short of where the pen lifted.
    flush() {
        if (!this.haveTangent || this.older === null || this.previous === null) {
            return [];
        }

        const closing = difference(this.older, this.previous, 1);
        const points = fitCubic(this.older, this.previous, this.previousTangent, closing);

        this.haveTangent = false;
        this.older = null;
        return points;
    }
}

// A difference between two positions, divided by the number of sample intervals it
// spans, which makes it a distance per sample. Krita divides by elapsed time to get
// a speed; pointer events carry a timestamp but not every source fills it usefully,
// and a divisor that silently collapsed to one would make the first tangent count
// double.
function difference(from, to, intervals) {
    return { x: (to.x - from.x) / intervals, y: (to.y - from.y) / intervals };
}

// The cubic through two samples with the given end tangents, cut into straight
// pieces. The construction is Krita's, and its shape is worth stating because the
// arithmetic hides it: the control handles reach toward where the two tangent lines
// would meet, but are pulled back when the tangents are similar in length, because
// a symmetric pair overshoots into a corner rather than a curve.
function fitCubic(from, to, tangentFrom, tangentTo) {
    // A zero tangent carries no direction, so there is no curve to fit. A straight
    // piece is the honest answer, and it is what Krita falls back to.
    if (isZero(tangentFrom) || isZero(tangentTo)) return [to];

    const p1 = from, p2 = to;
    const direction1 = { x: p1.x + tangentFrom.x, y: p1.y + tangentFrom.y };
    const direction2 = { x: p2.x - tangentTo.x, y: p2.y - tangentTo.y };

    let target1, target2;
    const meeting = meet(p1, direction1, p2, direction2);

    if (crosses(direction1, direction2, p1, p2)) {
        // The handles are on opposite sides: the curve turns back on itself, and
        // pulling both to a common point would be wrong. Each keeps its own
        // direction, at half the chord's length.
        const reach = length({ x: p2.x - p1.x, y: p2.y - p1.y }) / 2;
        target1 = along(p1, direction1, reach);
        target2 = along(p2, direction2, reach);
    } else if (meeting && Math.abs(meeting.x) + Math.abs(meeting.y) <= MAX_SANE_POINT) {
        target1 = target2 = meeting;
    } else {
        // Parallel tangents, or a meeting point so far away it says nothing useful.
        target1 = target2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    const speed1 = length(tangentFrom);
    const speed2 = length(tangentTo);
    if (speed1 <= 0 || speed2 <= 0) return [to];

    const chord = length({ x: p2.x - p1.x, y: p2.y - p1.y });

    const similarity = Math.max(0.5, Math.min(speed1 / speed2, speed2 / speed1));

    // Symmetric handles overshoot into a corner, so shorten them as the speeds converge.
    const reachCoefficient = CONTROL_REACH * (1 - Math.max(0, similarity - 0.8));

    let control1, control2;
    if (speed1 > speed2) {
        control1 = lerp(p1, target1, reachCoefficient);
        control2 = lerp(p2, target2, reachCoefficient * similarity);
    } else {
        control2 = lerp(p2, target2, reachCoefficient);
        control1 = lerp(p1, target1, reachCoefficient * similarity);
    }

    // A handle may not reach further than the segment it belongs to.
    //
    // Everything above is a construction for where the handles would like to point,
    // and it has no opinion about how far. When two tangents are nearly parallel their
    // lines meet a very long way off, and the handle chases that meeting point: input
    // confined to sixty pixels produced ink six hundred pixels away, and a fractional
    // change to one sample took it to five thousand. The absolute sanity limit above
    // is far too generous to catch it, being about a screen's width squared.
    //
    // A cubic stays inside the convex hull of its four control points, so bounding each
    // handle by the chord bounds the whole curve to roughly the segment it is drawn
    // for. It changes nothing in the ordinary case, where handles reach a fraction of
    // the chord.
    control1 = within(p1, control1, chord);
    control2 = within(p2, control2, chord);

    const pieces = pieceCount(p1, control1, control2, p2);
    const points = [];
    for (let i = 1; i <= pieces; i++) {
        const t = i / pieces;
        const at = cubic(p1, control1, control2, p2, t);
        // Pressure blended linearly in the curve parameter rather than in arc
        // length. The two differ only where the handles are very uneven, and by
        // less than the pen's own resolution.
        at.pressure = from.pressure + (to.pressure - from.pressure) * t;
        points.push(at);
    }
    return points;
}

// Enough pieces that none is longer than FLATTENING_STEP. Measured on the control
// polygon, which is never shorter than the curve, so this errs toward more pieces.
function pieceCount(p1, c1, c2, p2) {
    const polygon = length({ x: c1.x - p1.x, y: c1.y - p1.y })
                  + length({ x: c2.x - c1.x, y: c2.y - c1.y })
                  + length({ x: p2.x - c2.x, y: p2.y - c2.y });

    return clamp(Math.ceil(polygon / FLATTENING_STEP), 1, MAX_PIECES);
}

function cubic(p1, c1, c2, p2, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;

    return {
        x: a * p1.x + b * c1.x + c * c2.x + d * p2.x,
        y: a * p1.y + b * c1.y + c * c2.y + d * p2.y,
    };
}

// `point`, pulled back toward `anchor` if it lies further away than `limit`.
function within(anchor, point, limit) {
    const dx = point.x - anchor.x, dy = point.y - anchor.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= limit || distance === 0) return point;

    const scale = limit / distance;
    return { x: anchor.x + dx * scale, y: anchor.y + dy * scale };
}

function isZero(p) { return p.x === 0 && p.y === 0; }

function length(p) { return Math.hypot(p.x, p.y); }

function lerp(from, to, t) {
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

// A point `distance` from `origin` toward `toward`.
function along(origin, toward, distance) {
    const dx = toward.x - origin.x, dy = toward.y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return { x: origin.x, y: origin.y };

    return { x: origin.x + dx / len * distance, y: origin.y + dy / len * distance };
}

// True when the two segments cross within both of their spans.
function crosses(a1, a2, b1, b2) {
    const p = parameters(a1, a2, b1, b2);
    return !!p && p.ta >= 0 && p.ta <= 1 && p.tb >= 0 && p.tb <= 1;
}

// Where two infinite lines meet, or null when they are parallel.
function meet(a1, a2, b1, b2) {
    const p = parameters(a1, a2, b1, b2);
    if (!p) return null;

    return { x: a1.x + (a2.x - a1.x) * p.ta, y: a1.y + (a2.y - a1.y) * p.ta };
}

// How far along each line the two of them meet.
function parameters(a1, a2, b1, b2) {
    const ax = a2.x - a1.x, ay = a2.y - a1.y;
    const bx = b2.x - b1.x, by = b2.y - b1.y;

    const denominator = ax * by - ay * bx;
    if (Math.abs(denominator) < 1e-12) return null;   // parallel, or a zero-length line

    const dx = b1.x - a1.x, dy = b1.y - a1.y;
    return {
        ta: (dx * by - dy * bx) / denominator,
        tb: (dx * ay - dy * ax) / denominator,
    };
}


// ── Report rate ───────────────────────────────────────────────

// How many positions the pen reports each second.
//
// Not the rate move events arrive at, which is the display's. What is counted is the
// positions inside each event, which is what the app draws from.
//
// This is here because it is the first thing to ask when a stroke looks segmented:
// a tablet reporting 25 times a second cannot draw a smooth curve however good the
// software is, and one reporting 200 times can. Without it there is no way to tell a
// slow tablet from a slow application.
const RATE_WINDOW_MS = 1000;

// Below this the window is too short to divide by and the answer would be noise.
const RATE_MIN_SPAN_MS = 150;

// After this much quiet the last figure is stale: the pen has stopped or left.
const RATE_IDLE_MS = 400;

let rateWindow = [];

// Which pointer the window is measuring. A second device is a second rate.
let ratePointer = null;

function noteRate(e) {
    if (!HAS_COALESCED) return;

    // A different pointer means a different device reporting at its own speed, and
    // Type shows only the latest one, so the figure would be labelled with a device
    // that did not produce most of it. Measured: one pen sample, a ten-sample mouse
    // burst and one more pen sample across 200 ms read 50 points/s, where the same
    // pen traffic on its own reads 9.
    if (ratePointer !== e.pointerId) {
        rateWindow = [];
        ratePointer = e.pointerId;
    }

    // An untrusted event has an empty coalesced list by definition, so anything
    // dispatched from script contributes nothing rather than a false zero.
    const positions = e.getCoalescedEvents().length;
    if (positions === 0) return;

    const now = performance.now();

    // A gap means the pen stopped, left, or was lifted between strokes. Carrying the
    // old entries across it would divide this burst's positions by the pause as well.
    const previous = rateWindow[rateWindow.length - 1];
    if (previous && now - previous.at > RATE_IDLE_MS) rateWindow = [];

    rateWindow.push({ at: now, positions });
    while (rateWindow.length > 1 && now - rateWindow[0].at > RATE_WINDOW_MS) rateWindow.shift();
}

function reportRate() {
    // Without getCoalescedEvents the only countable thing is move events, which is
    // the display's rate wearing the pen's name. Better to say nothing.
    if (!HAS_COALESCED) return 'n/a';
    if (rateWindow.length < 2) return '---';

    const first = rateWindow[0];
    const last = rateWindow[rateWindow.length - 1];
    if (performance.now() - last.at > RATE_IDLE_MS) return '---';

    const span = last.at - first.at;
    if (span < RATE_MIN_SPAN_MS) return '---';

    // The first entry is excluded: its positions were reported before its timestamp,
    // so they fall outside the span being divided by.
    let positions = 0;
    for (let i = 1; i < rateWindow.length; i++) positions += rateWindow[i].positions;

    return String(Math.round(positions / span * 1000));
}

// The readouts are otherwise driven by pointer events, so without this the rate would
// keep claiming whatever it last measured after the pen was lifted.
setInterval(() => {
    if (infoEls.rate.textContent !== '---') infoEls.rate.textContent = reportRate();
}, 200);


// ── Optional properties ───────────────────────────────────────

// azimuthAngle and altitudeAngle are newer than the rest of PointerEvent: Safari only
// grew them in 18.2. Used unconditionally they come out undefined, the readouts show
// NaN, and the two tilt brushes hand a non-finite angle to canvas and draw nothing at
// all -- which in a tablet tester looks exactly like hardware that is not reporting.
//
// Both can be derived from tiltX and tiltY, which every implementation has, so the
// modes keep working and the numbers stay true rather than being blanked out. The
// conversion is the one in the Pointer Events specification.
function azimuthOf(e) {
    if (typeof e.azimuthAngle === 'number') return e.azimuthAngle;

    const x = Math.tan(radians(e.tiltX ?? 0));
    const y = Math.tan(radians(e.tiltY ?? 0));
    if (x === 0 && y === 0) return 0;

    // atan2 gives (-pi, pi]; the property is defined over [0, 2*pi).
    const angle = Math.atan2(y, x);
    return angle < 0 ? angle + 2 * Math.PI : angle;
}

function altitudeOf(e) {
    if (typeof e.altitudeAngle === 'number') return e.altitudeAngle;

    const x = Math.tan(radians(e.tiltX ?? 0));
    const y = Math.tan(radians(e.tiltY ?? 0));

    // Upright when there is no tilt, which is also the specification's default.
    return Math.atan2(1, Math.hypot(x, y));
}

function radians(degrees) {
    return degrees * Math.PI / 180;
}


// ── Info display ──────────────────────────────────────────────

function updateInfo(e) {
    const toDeg = radians => (radians * 180 / Math.PI).toFixed(1);
    infoEls.type.textContent     = e.pointerType || '---';
    infoEls.pressure.textContent = e.pressure.toFixed(3);
    infoEls.tiltX.textContent    = e.tiltX.toFixed(1) + '°';
    infoEls.tiltY.textContent    = e.tiltY.toFixed(1) + '°';
    infoEls.azimuth.textContent  = toDeg(azimuthOf(e)) + '°';
    infoEls.altitude.textContent = toDeg(altitudeOf(e)) + '°';
    infoEls.twist.textContent    = e.twist.toFixed(1) + '°';
    infoEls.eraser.textContent   = (e.buttons & ERASER_BUTTON_BIT) ? 'yes' : 'no';
    // Show the buttons bitmask as a 6-bit binary string so all defined
    // pointer buttons (tip, barrel, middle, X1, X2, eraser) are visible.
    infoEls.buttons.textContent  = '0b' + e.buttons.toString(2).padStart(6, '0');
    infoEls.rate.textContent     = reportRate();
}


// Say that there is nothing to report, rather than leaving the last pointer's values
// standing as though they were still true.
function blankInfo() {
    for (const el of Object.values(infoEls)) el.textContent = '---';
}


// ── Pointer event state ───────────────────────────────────────

let isDrawing = false;

// The previous pointer position, for the oval-brush modes, which stamp between two
// positions and need nothing else.
let lastPos = null;

// Where the ink last reached, for Pressure to Size. Not the same thing as the last
// sample: what the fitter hands back is a point on the painted path, and there may
// be many of them between two samples, or none at all.
let lastDrawn = null;

// The pressure of the last sample that had any. A release reports zero, and ending a
// stroke at zero width would undo its final mark rather than finish it.
let lastPressure = 0;

const fitter = new CurveFitter();

// Which pointer the stroke in progress belongs to, or null when nothing is drawing.
//
// A tablet reports a palm resting on the glass as a second contact, and a second
// contact used to be written straight into the same stroke: a pen drawing at (120,100)
// with a touch arriving at (500,300) painted a 400-pixel streak between them, and the
// palm lifting ended the pen's stroke. Both look like the tablet misbehaving.
let activePointerId = null;

// Whether an event concerns the stroke in progress. Anything is welcome when no stroke
// is running -- that is hovering, and the readouts should follow it.
function ownsStroke(e) {
    return activePointerId === null || e.pointerId === activePointerId;
}

// Whether the pen, mouse or finger is actually touching.
//
// Not the same question as "did a pointerdown arrive". A pen's barrel button sends one
// while the tip is still in the air, and holding that button while lifting the tip
// sends no pointerup -- so a stroke would begin on a button press and continue after
// the pen had left the tablet. Contact is the tip, or the eraser end.
function isContact(e) {
    return (e.buttons & (1 | ERASER_BUTTON_BIT)) !== 0;
}

// Forget everything about the stroke in progress. Called wherever one can end, which is
// more places than a pointerup: a release, the pointer leaving, a cancellation, Clear,
// a change of mode, and a resize.
function resetStroke() {
    if (activePointerId !== null && canvas.hasPointerCapture?.(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    isDrawing = false;
    lastPos = null;
    lastDrawn = null;
    fitter.reset();
    resetSmoothing();
}

function sampleFrom(e) {
    if (e.pressure > 0) lastPressure = e.pressure;

    return { x: e.offsetX, y: e.offsetY, pressure: e.pressure };
}

// Draw from wherever the ink last reached to one more point along the path.
function drawTo(point) {
    if (lastDrawn) drawTaperSegment(lastDrawn, point);
    lastDrawn = point;
}

// Mark the point of contact, so that a tap leaves something behind.
//
// Without this a press and release with no movement drew nothing at all: the fitter
// has no segment until a second sample arrives, and the oval modes stamp only between
// two positions. Tapping is the first thing anyone does to check a pen works.
function beginStroke(e, mode) {
    const at = sampleFrom(e);

    if (mode === 'pressure-size') {
        for (const point of fitter.next(smooth(at))) drawTo(point);
        drawTaperSegment(at, at);
    } else {
        stampOval(at, brushForMode(mode, e));
    }
}

// Finish at the position the pen was actually lifted from, then forget the stroke.
//
// The filter lags by a reading and the fitter holds a segment back, so flushing alone
// leaves the ink short of where the pen left: pressed at 100, moved to 200, released at
// 220, the last mark landed at 150. Settling the filter onto the release position and
// feeding it through fixes both lags at once.
function endStroke(e) {
    if (isDrawing && e && modeSelect.value === 'pressure-size' && isFinite(e.offsetX)) {
        const at = { x: e.offsetX, y: e.offsetY, pressure: lastPressure };
        settleSmoothing(at);
        for (const point of fitter.next(at)) drawTo(point);
    }

    for (const point of fitter.flush()) drawTo(point);
    resetStroke();
}


// ── Pointer event handlers ────────────────────────────────────

canvas.addEventListener('pointerdown', (e) => {
    // A contact arriving while another is already drawing is a palm, a second finger,
    // or a mouse someone nudged. The stroke keeps the pointer it started with.
    if (!ownsStroke(e)) return;

    updateInfo(e);

    const mode = modeSelect.value;
    if (mode === 'pointer-only') return;

    // A barrel button in mid-air also sends a pointerdown. Only contact draws.
    if (!isContact(e)) return;

    resetStroke();
    isDrawing = true;
    activePointerId = e.pointerId;

    // Capture keeps this pointer's events coming to the canvas even when it moves over
    // the toolbar, which is otherwise a pointerleave: crossing into the toolbar and
    // back with the tip still down left the stroke dead until the next press. Ink
    // outside the canvas is clipped by the bitmap, as it always was.
    try {
        canvas.setPointerCapture(e.pointerId);
    } catch {
        // No capture available. The stroke still works; it just ends at the edge.
    }

    lastPos = sampleFrom(e);
    beginStroke(e, mode);
});

// Every position the pen reported since the last frame, rather than the single one
// the event carries.
//
// A pointermove is delivered about once per screen refresh however fast the tablet
// reports, and the rest of the readings are inside it waiting to be asked for. Using
// them costs nothing -- they have already arrived -- and a stroke drawn from all of
// them follows the pen more closely than one drawn from a fifth of them.
//
// An untrusted event has an empty list by definition, so anything dispatched from
// script falls back to the event itself.
function positionsIn(e) {
    if (!HAS_COALESCED) return [e];

    const merged = e.getCoalescedEvents();
    return merged.length > 0 ? merged : [e];
}

canvas.addEventListener('pointermove', (e) => {
    // Before the readouts, not just before the drawing: a palm's pressure and tilt
    // shown in place of the pen's is the same fault wearing different clothes.
    if (!ownsStroke(e)) return;

    noteRate(e);
    updateInfo(e);
    const mode = modeSelect.value;

    if (mode === 'pointer-only') {
        // Show a visible cursor at the reported position; never draw.
        // The indicator stays visible even when the pen is pressing down.
        showCursorIndicator(e);
        return;
    }
    hideCursorIndicator();

    if (!isDrawing) return;

    // Contact can end without a pointerup: lifting the tip while the barrel button is
    // still held sends a move with the button bit and no contact bit.
    if (!isContact(e)) {
        endStroke(e);
        return;
    }

    // Every mode draws from the same stream of positions, each with the pressure and
    // the angles it was reported with. The oval modes used to take the outermost event
    // alone and span straight to it: a batch bending through (150,200) on its way from
    // (100,100) to (200,100) drew a flat bar 7px tall with the corner discarded --
    // while Points/s counted every one of those positions as one the stroke was built
    // from.
    for (const position of positionsIn(e)) {
        const at = sampleFrom(position);

        if (mode === 'pressure-size') {
            // Pressure (0–1) scales the brush size.
            for (const point of fitter.next(smooth(at))) drawTo(point);
        } else {
            drawOvalStroke(lastPos, at, brushForMode(mode, position));
        }

        lastPos = at;
    }
});

canvas.addEventListener('pointerup', (e) => {
    if (!ownsStroke(e)) return;

    endStroke(e);

    // After the release, not before: the panel should report a released pen rather than
    // keep showing the pressure and buttons of the last moment it was down.
    updateInfo(e);
});

canvas.addEventListener('pointercancel', (e) => {
    if (!ownsStroke(e)) return;

    endStroke(e);
    updateInfo(e);
});

// Capture can be taken away rather than given up -- the element going away, or the
// browser deciding. However it went, the stroke has no owner any more.
canvas.addEventListener('lostpointercapture', (e) => {
    if (isDrawing && e.pointerId === activePointerId) endStroke(e);
});

canvas.addEventListener('pointerleave', (e) => {
    if (!ownsStroke(e)) return;

    endStroke(e);
    hideCursorIndicator();

    // Nothing is being reported any more, and the last values were about a pointer that
    // has gone. Dashes are what the panel says before anything has been seen.
    blankInfo();
});


// ── Cursor indicator (Pointer-only mode) ──────────────────────

function showCursorIndicator(e) {
    cursorIndicator.style.left = e.clientX + 'px';
    cursorIndicator.style.top = e.clientY + 'px';
    cursorIndicator.hidden = false;
}

function hideCursorIndicator() {
    cursorIndicator.hidden = true;
}

modeSelect.addEventListener('change', () => {
    if (modeSelect.value !== 'pointer-only') hideCursorIndicator();

    // Whatever is half-drawn belongs to the mode being left. Finishing it under the new
    // one would paint a segment nobody asked for, in a style nobody chose.
    resetStroke();
});


// ── Export ────────────────────────────────────────────────────

const exportSelect = document.getElementById('export');

exportSelect.addEventListener('change', () => {
    const action = exportSelect.value;
    exportSelect.value = ''; // reset so the user can pick the same action again
    if (action === 'png') exportPng();
    else if (action === 'clipboard') exportClipboard();
});

function exportPng() {
    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tablet-tester.png';
        a.click();
        // click() only queues the download, so the blob URL has to outlive this
        // tick — revoking synchronously races the browser's read of the blob.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
}

function exportClipboard() {
    canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch (err) {
            alert('Copy to clipboard failed: ' + err.message);
        }
    }, 'image/png');
}


// ── About dialog ──────────────────────────────────────────────

document.getElementById('about-btn').addEventListener('click', () => {
    document.getElementById('about-dialog').showModal();
});


// ── Init ──────────────────────────────────────────────────────

window.addEventListener('resize', scheduleResize);

// Picks up device-pixel-ratio changes that leave the CSS size unchanged —
// browser zoom, or moving the window to a monitor with a different scale
// factor — which the window resize event alone can miss.
const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
        // Only the canvas has a device-pixel box worth keeping. The toolbar is observed
        // for its height alone, and its box would be the wrong one to size ink by.
        if (entry.target !== canvas) continue;

        const box = entry.devicePixelContentBoxSize?.[0];
        if (box) devicePixelBox = { width: box.inlineSize, height: box.blockSize };
    }
    scheduleResize();
});
try {
    resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
} catch {
    // Browsers without device-pixel-content-box support fall back to
    // devicePixelRatio in backingSize().
    resizeObserver.observe(canvas);
}

// The canvas takes whatever height the window has left after the toolbar, so a toolbar
// that changes height has to resize it. Nothing else notices: the canvas keeps the CSS
// height it was last given, so its own box does not change and neither does the
// window's, and the bottom of the canvas ends up below the bottom of the screen.
// Reserving the readout widths is what stops that happening while someone is drawing;
// this is what keeps the canvas honest when the toolbar wraps for any other reason.
resizeObserver.observe(toolbar);

// Delete or Backspace clears the canvas
document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearCanvas();
    }
});

resizeCanvas();
