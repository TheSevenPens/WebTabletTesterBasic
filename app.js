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
const ctx = canvas.getContext('2d');

const infoEls = {
    type:     document.getElementById('val-type'),
    pressure: document.getElementById('val-pressure'),
    tiltX:    document.getElementById('val-tiltX'),
    tiltY:    document.getElementById('val-tiltY'),
    azimuth:  document.getElementById('val-azimuth'),
    altitude: document.getElementById('val-altitude'),
    twist:    document.getElementById('val-twist'),
};

const CANVAS_BG = '#e6e6fa';
const MAX_BRUSH_SIZE = 50; // brush diameter in pixels at full pressure
const OVAL_RADIUS_X = 22;  // long axis of the oval brush (rotation modes)
const OVAL_RADIUS_Y = 4;   // short axis of the oval brush (rotation modes)
const OVAL_STAMP_SPACING = 2; // px between stamps along a stroke


// ── Canvas setup ─────────────────────────────────────────────

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbar.offsetHeight;
    clearCanvas();
}

function clearCanvas() {
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    if (!isDrawing) return;

    const pos = { x: e.offsetX, y: e.offsetY };
    const mode = modeSelect.value;

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
});


// ── Init ──────────────────────────────────────────────────────

window.addEventListener('resize', resizeCanvas);

// Delete or Backspace clears the canvas
document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearCanvas();
    }
});

resizeCanvas();
