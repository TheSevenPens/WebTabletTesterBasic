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
};

// PointerEvent.buttons is a bitmask. Bit 5 (value 32) is the eraser end
// of a stylus per the Pointer Events spec.
const ERASER_BUTTON_BIT = 32;

const CANVAS_BG = '#e6e6fa';
const MAX_BRUSH_SIZE = 50; // brush diameter in pixels at full pressure
const OVAL_RADIUS_X = 22;  // long axis of the oval brush (rotation modes)
const OVAL_RADIUS_Y = 4;   // short axis of the oval brush (rotation modes)
const OVAL_STAMP_SPACING = 2; // px between stamps along a stroke


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

// Draw a line segment from `from` to `to` with the given size.
// Uses a midpoint quadratic curve for slightly smoother strokes.
function drawSegment(from, to, size) {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    ctx.lineWidth = size;
    ctx.strokeStyle = 'black';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(from.x, from.y, mid.x, mid.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
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


// ── Info display ──────────────────────────────────────────────

function updateInfo(e) {
    const toDeg = radians => (radians * 180 / Math.PI).toFixed(1);
    infoEls.type.textContent     = e.pointerType || '---';
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
}


// ── Pointer event state ───────────────────────────────────────

let isDrawing = false;
let lastPos = null;


// ── Pointer event handlers ────────────────────────────────────

canvas.addEventListener('pointerdown', (e) => {
    isDrawing = true;
    lastPos = { x: e.offsetX, y: e.offsetY };
    updateInfo(e);
});

canvas.addEventListener('pointermove', (e) => {
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

    const pos = { x: e.offsetX, y: e.offsetY };
    if (mode === 'pressure-size') {
        // Pressure (0–1) scales the brush size.
        // Mouse events report pressure as 0.5, so they get a mid-size brush.
        const size = Math.max(1, e.pressure * MAX_BRUSH_SIZE);
        drawSegment(lastPos, pos, size);
    } else {
        drawOvalStroke(lastPos, pos, brushForMode(mode, e));
    }

    lastPos = pos;
});

canvas.addEventListener('pointerup', () => {
    isDrawing = false;
    lastPos = null;
});

canvas.addEventListener('pointerleave', () => {
    isDrawing = false;
    lastPos = null;
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

resizeCanvas();
