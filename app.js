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
const strokeSelect = document.getElementById('stroke');
const allPointsCheck = document.getElementById('allpoints');
const cursorIndicator = document.getElementById('cursor-indicator');
const ctx = canvas.getContext('2d');

const infoEls = {
    type:     document.getElementById('val-type'),
    x:        document.getElementById('val-x'),
    y:        document.getElementById('val-y'),
    pressure: document.getElementById('val-pressure'),
    tiltX:    document.getElementById('val-tiltX'),
    tiltY:    document.getElementById('val-tiltY'),
    azimuth:  document.getElementById('val-azimuth'),
    altitude: document.getElementById('val-altitude'),
    twist:    document.getElementById('val-twist'),
    eraser:   document.getElementById('val-eraser'),
    buttons:  document.getElementById('val-buttons'),
    penRate:  document.getElementById('val-pen-rate'),
    usedRate: document.getElementById('val-used-rate'),
};

// Whether this browser can say what it merged. Chrome, Edge and Firefox have had
// it for years; Safari only from 18.2, so an older iPad reports nothing here and
// the readout says so rather than claiming one sample per move.
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

function clearCanvas() {
    // Fill the whole backing store, which is measured in screen pixels, so
    // drop the CSS-pixel scale for the duration of the fill.
    const transform = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(transform);
}


// ── Drawing ───────────────────────────────────────────────────

// Draw a line from `from` to `to` at one width, taken from the pressure at `to`.
//
// The width is therefore constant within a segment and changes in a step at every
// sample boundary, which at tablet report rates is everywhere: the silhouette of a
// stroke is a staircase rather than a ramp. Kept as a choice because seeing the
// artefact is half of understanding why the taper below exists.
function drawSteppedSegment(from, to) {
    ctx.lineWidth = widthFor(to.pressure);
    ctx.strokeStyle = 'black';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
}

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
// The straight sides are the circles' external tangents: for centres `d` apart with
// radii `ra` and `rb`, both tangent points lie along the same normal, offset from
// the centre line by asin((ra - rb) / d). That is what makes the sides meet the
// round caps smoothly instead of cutting across them.
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

    // The shared normal of the two external tangent lines, one either side of the axis.
    const up = phi + Math.PI / 2 + alpha;
    const down = phi - Math.PI / 2 - alpha;

    ctx.moveTo(a.x + ra * Math.cos(up), a.y + ra * Math.sin(up));
    ctx.lineTo(b.x + rb * Math.cos(up), b.y + rb * Math.sin(up));

    // Round the far end, then the near one. Both sweeps run the same way round so the
    // contour stays simple; together they account for the full turn the caps share.
    ctx.arc(b.x, b.y, rb, up, up - (Math.PI + 2 * alpha), true);
    ctx.lineTo(a.x + ra * Math.cos(down), a.y + ra * Math.sin(down));
    ctx.arc(a.x, a.y, ra, down, down - (Math.PI - 2 * alpha), true);

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
            return { rx: OVAL_RADIUS_X, ry: OVAL_RADIUS_Y, rot: e.azimuthAngle };
        case 'altitude-size': {
            // Upright (altitude = π/2) → circle. Flat (altitude = 0) → elongated.
            // Azimuth picks the direction the ellipse stretches.
            const tilt = 1 - Math.min(1, e.altitudeAngle / (Math.PI / 2));
            const maxRx = OVAL_RADIUS_X * 2;
            const rx = OVAL_RADIUS_Y + tilt * (maxRx - OVAL_RADIUS_Y);
            return { rx, ry: OVAL_RADIUS_Y, rot: e.azimuthAngle };
        }
        case 'twist-rotation':
            return { rx: OVAL_RADIUS_X, ry: OVAL_RADIUS_Y, rot: -e.twist * Math.PI / 180 };
        default:
            return { rx: OVAL_RADIUS_X, ry: OVAL_RADIUS_Y, rot: 0 };
    }
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
    next(sample, curved) {
        if (!curved) {
            this.previous = sample;
            return [sample];
        }

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
    flush(curved) {
        if (!curved || !this.haveTangent || this.older === null || this.previous === null) {
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


// ── Info display ──────────────────────────────────────────────

function updateInfo(e) {
    const toDeg = radians => (radians * 180 / Math.PI).toFixed(1);
    infoEls.type.textContent     = e.pointerType || '---';
    infoEls.x.textContent        = position(e.clientX);
    infoEls.y.textContent        = position(e.clientY);
    infoEls.pressure.textContent = e.pressure.toFixed(3);
    infoEls.tiltX.textContent    = e.tiltX.toFixed(1) + '°';
    infoEls.tiltY.textContent    = e.tiltY.toFixed(1) + '°';
    infoEls.azimuth.textContent  = toDeg(e.azimuthAngle) + '°';
    infoEls.altitude.textContent = toDeg(e.altitudeAngle) + '°';
    infoEls.twist.textContent    = e.twist.toFixed(1) + '°';
    infoEls.eraser.textContent   = (e.buttons & ERASER_BUTTON_BIT) ? 'yes' : 'no';
    // Show the buttons bitmask as a 6-bit binary string so all defined
    // pointer buttons (tip, barrel, middle, X1, X2, eraser) are visible.
    infoEls.buttons.textContent  = '0b' + e.buttons.toString(2).padStart(6, '0');
    showRates();
}


// A coordinate, always to two decimals.
//
// Pointer positions are doubles in the spec, not integers, and a pen can report
// between pixels. Whether a given browser and driver actually pass that through
// is the thing worth seeing, so the decimals are always shown: .00 every time
// means whole pixels, and anything else means finer than the screen can draw.
//
// Taken from clientX/clientY rather than offsetX/offsetY, which is the only part
// of this that needed thought. An offset is the client position minus the
// canvas's own left edge, and that edge is very often a fraction — so offsets
// come out fractional on a device reporting perfectly whole pixels, and the
// readout would answer a question about the browser with a fact about the
// layout. The stroke is still drawn from the offsets; only the display differs,
// and the two carry the same precision.
//
// The display only. Nothing here rounds the value the stroke is drawn from.
function position(value) {
    return typeof value === 'number' && isFinite(value) ? value.toFixed(2) : '---';
}


// ── Report rate ───────────────────────────────────────────────

// How many positions the pen is reporting each second.
//
// This is not the rate move events arrive at. A pointermove is delivered about
// once per animation frame however fast the tablet reports, so counting events
// would measure the display and call it the pen. What is counted here is the
// samples inside each event, which is what getCoalescedEvents() hands back: the
// ones the browser merged because it had nowhere to put them.
//
// Measured over a rolling second rather than a whole stroke, so the figure
// follows what the pen is doing now.
const RATE_WINDOW_MS = 1000;

// Below this the window is too short to divide by and the answer would be noise.
const RATE_MIN_SPAN_MS = 150;

// After this much quiet the last figure is stale: the pen has stopped or left.
const RATE_IDLE_MS = 400;

let rateWindow = [];

// Record what one move event carried, and how many of those the app acted on.
function noteSamples(e, used) {
    if (!HAS_COALESCED || typeof e.getCoalescedEvents !== 'function') return;
    if (e.type !== 'pointermove' && e.type !== 'pointerrawupdate') return;

    // An untrusted event has an empty coalesced list by definition, so anything
    // dispatched from script contributes nothing rather than a false zero.
    const samples = e.getCoalescedEvents().length;
    if (samples === 0) return;

    const now = performance.now();

    // A gap means the pen stopped, left, or was lifted between strokes. Carrying
    // the old entries across it would divide this burst's samples by the pause as
    // well, and report a rate far below the truth.
    const previous = rateWindow[rateWindow.length - 1];
    if (previous && now - previous.at > RATE_IDLE_MS) rateWindow = [];

    rateWindow.push({ at: now, samples, used });
    while (rateWindow.length > 1 && now - rateWindow[0].at > RATE_WINDOW_MS) rateWindow.shift();
}

// Two rates from the same window, because the gap between them is the point.
//
//   pen   what the hardware reports
//   used  what the stroke is built from, which is one sample per move event and
//         therefore one per screen refresh
//
// Everything in between is thrown away. Saying only the first would invite
// reading it as the rate the drawing uses, which it is not.
function rates() {
    // Without getCoalescedEvents the only thing countable is move events, so the
    // pen's rate is unknowable and both numbers would be the display's.
    if (!HAS_COALESCED) return { pen: 'n/a', used: 'n/a' };
    if (rateWindow.length < 2) return { pen: '---', used: '---' };

    const first = rateWindow[0];
    const last = rateWindow[rateWindow.length - 1];
    if (performance.now() - last.at > RATE_IDLE_MS) return { pen: '---', used: '---' };

    const span = last.at - first.at;
    if (span < RATE_MIN_SPAN_MS) return { pen: '---', used: '---' };

    // The first entry is excluded from both counts: its samples were reported
    // before its timestamp, so they fall outside the span being divided by.
    let samples = 0, used = 0;
    for (let i = 1; i < rateWindow.length; i++) {
        samples += rateWindow[i].samples;
        used += rateWindow[i].used;
    }

    const perSecond = count => String(Math.round(count / span * 1000));

    return { pen: perSecond(samples), used: perSecond(used) };
}

function showRates() {
    const { pen, used } = rates();
    infoEls.penRate.textContent = pen;
    infoEls.usedRate.textContent = used;
}

// The readouts are otherwise driven by pointer events, so without this they would
// keep claiming whatever was last measured after the pen was lifted.
setInterval(() => {
    if (infoEls.penRate.textContent !== '---') showRates();
}, 200);


// ── Pointer event state ───────────────────────────────────────

let isDrawing = false;

// The previous pointer position, for the oval-brush modes, which stamp between two
// positions and need nothing else.
let lastPos = null;

// Where the ink last reached, for Pressure to Size. Not the same thing as the last
// sample: what the fitter hands back is a point on the painted path, and there may
// be many of them between two samples, or none at all.
let lastDrawn = null;

const fitter = new CurveFitter();

function sampleFrom(e) {
    return { x: e.offsetX, y: e.offsetY, pressure: e.pressure };
}

function isCurved() {
    return strokeSelect.value === 'taper-curved';
}

// Draw from wherever the ink last reached to one more point along the path.
function drawTo(point) {
    if (lastDrawn) {
        if (strokeSelect.value === 'stepped') drawSteppedSegment(lastDrawn, point);
        else drawTaperSegment(lastDrawn, point);
    }
    lastDrawn = point;
}

// Paint whatever the fitter is still holding back, and forget the stroke.
function endStroke() {
    for (const point of fitter.flush(isCurved())) drawTo(point);
    isDrawing = false;
    lastPos = null;
    lastDrawn = null;
    fitter.reset();
}


// ── Pointer event handlers ────────────────────────────────────

canvas.addEventListener('pointerdown', (e) => {
    isDrawing = true;
    lastPos = sampleFrom(e);
    lastDrawn = null;
    fitter.reset();
    for (const point of fitter.next(sampleFrom(e), isCurved())) drawTo(point);
    updateInfo(e);
});

canvas.addEventListener('pointermove', (e) => {
    const mode = modeSelect.value;

    // Every position the pen reported since the last frame, when asked for and
    // when there is a stroke to put them in. Null means the ordinary thing: act
    // on the one position the event carries and discard the rest.
    let burst = mode === 'pressure-size' && isDrawing && usingAllPoints()
        ? e.getCoalescedEvents()
        : null;
    if (burst && burst.length === 0) burst = null;   // untrusted event

    noteSamples(e, burst ? burst.length : 1);
    updateInfo(e);

    if (mode === 'pointer-only') {
        // Show a visible cursor at the reported position; never draw.
        // The indicator stays visible even when the pen is pressing down.
        showCursorIndicator(e);
        return;
    }
    hideCursorIndicator();

    if (!isDrawing) return;

    const pos = sampleFrom(e);
    if (mode === 'pressure-size') {
        // Pressure (0–1) scales the brush size, and the Stroke control decides how
        // the ink between two samples is laid down.
        for (const sample of burst ? [...burst].map(sampleFrom) : [pos]) {
            for (const point of fitter.next(sample, isCurved())) drawTo(point);
        }
    } else {
        drawOvalStroke(lastPos, pos, brushForMode(mode, e));
    }

    lastPos = pos;
});

canvas.addEventListener('pointerup', endStroke);

canvas.addEventListener('pointerleave', () => {
    endStroke();
    hideCursorIndicator();
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
    syncStrokeControl();
});

// The Stroke control decides how the ink between two samples is drawn, and only
// Pressure to Size draws that kind of ink: the oval modes stamp ellipses, which have
// no line width to ramp and no path to fit. Disabled rather than hidden, so it does
// not look live when it would do nothing.
// Dimming the label alongside it is left to CSS, which styles the whole item from
// the disabled control.
function syncStrokeControl() {
    const drawsStrokes = modeSelect.value === 'pressure-size';
    strokeSelect.disabled = !drawsStrokes;

    // Nothing to use in a browser that will not hand the extra samples over, and
    // nowhere to put them in a mode that stamps ovals.
    allPointsCheck.disabled = !drawsStrokes || !HAS_COALESCED;
}

function usingAllPoints() {
    return HAS_COALESCED && allPointsCheck.checked;
}


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

// Delete or Backspace clears the canvas
document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearCanvas();
    }
});

syncStrokeControl();
resizeCanvas();
