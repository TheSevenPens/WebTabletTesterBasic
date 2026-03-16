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

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const CANVAS_BG = '#e6e6fa';
const MAX_BRUSH_SIZE = 50; // brush diameter in pixels at full pressure


// ── Canvas setup ─────────────────────────────────────────────

function resizeCanvas() {
    const toolbar = document.getElementById('toolbar');
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


// ── Info display ──────────────────────────────────────────────

function updateInfo(e) {
    const toDeg = radians => (radians * 180 / Math.PI).toFixed(1);
    document.getElementById('val-type').textContent     = e.pointerType || '---';
    document.getElementById('val-pressure').textContent = e.pressure.toFixed(3);
    document.getElementById('val-tiltX').textContent    = e.tiltX.toFixed(1) + '°';
    document.getElementById('val-tiltY').textContent    = e.tiltY.toFixed(1) + '°';
    document.getElementById('val-azimuth').textContent  = toDeg(e.azimuthAngle) + '°';
    document.getElementById('val-altitude').textContent = toDeg(e.altitudeAngle) + '°';
    document.getElementById('val-twist').textContent    = e.twist.toFixed(1) + '°';
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

    // Pressure (0–1) scales the brush size.
    // Mouse events report pressure as 0.5, so they get a mid-size brush.
    const size = Math.max(1, e.pressure * MAX_BRUSH_SIZE);

    drawSegment(lastPos, pos, size);
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
