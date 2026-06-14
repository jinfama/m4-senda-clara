/* landing.js — Entry point: animated globe → zoom to Andalusia → launch app.
   Uses D3 orthographic projection on canvas. Loads data in parallel.
   Floating olive leaves and olive branches as ambient particles. */

const ANDALUSIA_CENTER = [-4.5, 37.5]; // [lon, lat]
const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json';
const WORLD_ATLAS_TIMEOUT_MS = 5000;

// Andalusia bounding polygon (rough outline for highlight)
const ANDALUSIA_BBOX = {
    type: 'Feature',
    geometry: {
        type: 'Polygon',
        coordinates: [[
            [-7.5, 36.0], [-7.5, 38.8], [-1.6, 38.8], [-1.6, 36.0], [-7.5, 36.0]
        ]]
    }
};

/* ═══════════════════════════════════════════════
   Globe state
   ═══════════════════════════════════════════════ */
let _canvas, _ctx, _width, _height;
let _projection, _path;
let _land = null;
let _rotation = [0, -15];
let _rotationSpeed = 0.18;
let _animFrame = null;
let _dataReady = false;
let _globeReady = false;
let _zooming = false;

/* ═══════════════════════════════════════════════
   Artistic particles — floating olive leaves
   ═══════════════════════════════════════════════ */
let _pCanvas, _pCtx;
let _particles = [];
let _pRaf = null;
let _mouse = { x: -9999, y: -9999, px: -9999, py: -9999, vx: 0, vy: 0, active: false };
let _pointerTrail = [];
const NUM_LEAVES = 16;
const MOUSE_R = 240;
const TRAIL_MAX = 12;

function _fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal })
        .finally(() => clearTimeout(timer))
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        });
}

function _initParticles() {
    _pCanvas = document.getElementById('landing-particles');
    if (!_pCanvas) return;
    _pCtx = _pCanvas.getContext('2d');
    _resizeParticles();

    for (let i = 0; i < NUM_LEAVES; i++) _particles.push(_createLeaf(true));

    const landing = document.getElementById('landing');
    landing.addEventListener('pointermove', _onPointerMove);
    landing.addEventListener('pointerleave', () => {
        _mouse.active = false;
        _mouse.x = -9999; _mouse.y = -9999;
    });

    _pLoop();
}

function _onPointerMove(e) {
    _mouse.px = _mouse.x;
    _mouse.py = _mouse.y;
    _mouse.x = e.clientX;
    _mouse.y = e.clientY;
    _mouse.vx = (_mouse.px < -9000) ? 0 : _mouse.x - _mouse.px;
    _mouse.vy = (_mouse.py < -9000) ? 0 : _mouse.y - _mouse.py;
    _mouse.active = true;

    const speed = Math.min(1, Math.hypot(_mouse.vx, _mouse.vy) / 42);
    _pointerTrail.push({
        x: _mouse.x,
        y: _mouse.y,
        r: 18 + speed * 18,
        a: 0.18 + speed * 0.12,
    });
    if (_pointerTrail.length > TRAIL_MAX) _pointerTrail.shift();
}

function _resizeParticles() {
    if (!_pCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    _pCanvas.width = _width * dpr;
    _pCanvas.height = _height * dpr;
    _pCanvas.style.width = _width + 'px';
    _pCanvas.style.height = _height + 'px';
    _pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _createLeaf(randomY) {
    const size = 18 + Math.random() * 22;
    return {
        x: Math.random() * (_width || 800),
        y: randomY ? Math.random() * (_height || 600) : -size * 2,
        size,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.0018,
        vx: (Math.random() - 0.5) * 0.08,
        vy: 0.045 + Math.random() * 0.065,
        opacity: 0.18 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2,
        sway: 0.2 + Math.random() * 0.3,
        glow: 0,
    };
}

function _pLoop() {
    _pUpdate();
    _pDraw();
    _pRaf = requestAnimationFrame(_pLoop);
}

function _pUpdate() {
    for (const p of _particles) {
        p.x += p.vx + Math.sin(p.phase) * p.sway * 0.3;
        p.y += p.vy;
        p.angle += p.spin;
        p.phase += 0.005;

        // Cursor attraction: leaves drift gently toward the pointer.
        const dx = p.x - _mouse.x;
        const dy = p.y - _mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (_mouse.active && dist < MOUSE_R && dist > 0) {
            const force = Math.pow(1 - dist / MOUSE_R, 1.8);
            p.x += (_mouse.x - p.x) * force * 0.012;
            p.y += (_mouse.y - p.y) * force * 0.012;
            p.x += _mouse.vx * force * 0.008;
            p.y += _mouse.vy * force * 0.008;
            p.spin += (_mouse.vx * 0.000035 - _mouse.vy * 0.000025) * force;
            p.spin = Math.max(-0.004, Math.min(0.004, p.spin));
            p.glow = Math.min(1, p.glow + force * 0.035);
        }
        p.glow *= 0.96;

        // Recycle off-screen
        if (p.y > _height + p.size * 3 || p.x < -p.size * 4 || p.x > _width + p.size * 4) {
            Object.assign(p, _createLeaf(false));
            p.x = Math.random() * _width;
        }
    }
}

function _pDraw() {
    _pCtx.clearRect(0, 0, _width, _height);
    _drawPointerTrail();

    for (const p of _particles) {
        _pCtx.save();
        _pCtx.globalAlpha = Math.min(0.48, p.opacity + p.glow * 0.16);
        _pCtx.translate(p.x, p.y);
        _pCtx.rotate(p.angle);
        _drawOliveLeaf(_pCtx, p.size * (1 + p.glow * 0.04));
        _pCtx.restore();
    }
}

function _drawPointerTrail() {
    for (const t of _pointerTrail) {
        t.a *= 0.84;
        t.r *= 1.012;
    }
    _pointerTrail = _pointerTrail.filter(t => t.a > 0.015);

    for (const t of _pointerTrail) {
        const grd = _pCtx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.r);
        grd.addColorStop(0, `rgba(154,190,126,${t.a * 0.11})`);
        grd.addColorStop(0.45, `rgba(72,143,116,${t.a * 0.06})`);
        grd.addColorStop(1, 'rgba(72,143,116,0)');
        _pCtx.fillStyle = grd;
        _pCtx.beginPath();
        _pCtx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
        _pCtx.fill();
    }
}

/** Draw a single olive leaf */
function _drawOliveLeaf(ctx, size) {
    const w = size * 0.35;
    const h = size;

    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.bezierCurveTo(w * 1.2, -h * 0.5, w * 1.2, h * 0.5, 0, h);
    ctx.bezierCurveTo(-w * 1.2, h * 0.5, -w * 1.2, -h * 0.5, 0, -h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(130,170,110,0.7)';
    ctx.fill();

    // Central vein
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.85);
    ctx.lineTo(0, h * 0.85);
    ctx.strokeStyle = 'rgba(100,140,80,0.5)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
}

function _destroyParticles() {
    if (_pRaf) cancelAnimationFrame(_pRaf);
    _particles = [];
    _pointerTrail = [];
}

/* ═══════════════════════════════════════════════
   Globe init & rendering
   ═══════════════════════════════════════════════ */

(function init() {
    _canvas = document.getElementById('landing-globe');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);

    _projection = d3.geoOrthographic()
        .translate([_width / 2, _height / 2])
        .scale(Math.min(_width, _height) * 0.25)
        .clipAngle(90);
    _path = d3.geoPath(_projection, _ctx);

    // Start particles immediately
    _initParticles();

    // Start rotation immediately (sphere + graticule only)
    _startRotation();

    // Load world data for the animation only. App data is loaded after entry by
    // app.js, otherwise the landing can block for a long time on large JSON files.
    const progressBar = document.querySelector('.landing-bar');
    let progress = 0;
    function tick(amount) {
        progress = Math.min(progress + amount, 100);
        if (progressBar) progressBar.style.width = progress + '%';
    }

    const worldPromise = _fetchJsonWithTimeout(WORLD_ATLAS_URL, WORLD_ATLAS_TIMEOUT_MS)
        .then(topo => {
            _land = topojson.feature(topo, topo.objects.land);
            _globeReady = true;
            tick(30);
        })
        .catch(err => {
            console.warn('World atlas load failed, continuing without land:', err);
            _globeReady = true;
            tick(30);
        });

    const dataPromise = Promise.resolve().then(() => {
        _dataReady = true;
        tick(70);
    });

    Promise.all([worldPromise, dataPromise]).then(() => {
        // Zoom to Andalusia, then show CTA
        _zoomToAndalusia().then(_showCTA);
    });

    // Hard fallback: never let the landing block access to the atlas.
    setTimeout(_showCTA, 3000);

    // CTA click + keyboard enter
    document.getElementById('landing-cta').addEventListener('click', _enterApp);
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && document.getElementById('landing-cta').style.display !== 'none') {
            _enterApp();
        }
    });
})();

function _resize() {
    _width = window.innerWidth;
    _height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    _canvas.width = _width * dpr;
    _canvas.height = _height * dpr;
    _canvas.style.width = _width + 'px';
    _canvas.style.height = _height + 'px';
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (_projection) {
        _projection.translate([_width / 2, _height / 2])
            .scale(Math.min(_width, _height) * 0.25);
    }
    _resizeParticles();
}

function _startRotation() {
    function frame() {
        if (_zooming) return; // pause during zoom transition
        _rotation[0] += _rotationSpeed;
        _projection.rotate(_rotation);
        _drawGlobe();
        _animFrame = requestAnimationFrame(frame);
    }
    _animFrame = requestAnimationFrame(frame);
}

function _drawGlobe() {
    _ctx.clearRect(0, 0, _width, _height);

    // Sphere (ocean)
    _ctx.beginPath();
    _path({ type: 'Sphere' });
    _ctx.fillStyle = 'rgba(255,255,255,0.03)';
    _ctx.fill();
    _ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    _ctx.lineWidth = 0.5;
    _ctx.stroke();

    // Graticule
    const graticule = d3.geoGraticule10();
    _ctx.beginPath();
    _path(graticule);
    _ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    _ctx.lineWidth = 0.3;
    _ctx.stroke();

    // Land masses
    if (_land) {
        _ctx.beginPath();
        _path(_land);
        _ctx.fillStyle = 'rgba(255,255,255,0.1)';
        _ctx.fill();
        _ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        _ctx.lineWidth = 0.5;
        _ctx.stroke();
    }

    // Andalusia highlight as a soft flag: green-white-green with a glow.
    if (_land) {
        _drawAndalusiaFlagHighlight();
    }
}

function _drawAndalusiaFlagHighlight() {
    const polygon = ANDALUSIA_BBOX.geometry.coordinates[0]
        .map(coord => _projection(coord))
        .filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (polygon.length < 4) return;

    const xs = polygon.map(p => p[0]);
    const ys = polygon.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return;

    _ctx.save();
    _ctx.beginPath();
    _path(ANDALUSIA_BBOX);
    _ctx.clip();

    const green = 'rgba(0, 138, 69, 0.46)';
    const white = 'rgba(255, 255, 255, 0.48)';
    _ctx.fillStyle = green;
    _ctx.fillRect(minX, minY, w, h / 3);
    _ctx.fillStyle = white;
    _ctx.fillRect(minX, minY + h / 3, w, h / 3);
    _ctx.fillStyle = green;
    _ctx.fillRect(minX, minY + h * 2 / 3, w, h / 3);

    _ctx.strokeStyle = 'rgba(226, 255, 238, 0.34)';
    _ctx.lineWidth = 1;
    _ctx.beginPath();
    _ctx.moveTo(minX, minY + h / 3);
    _ctx.lineTo(maxX, minY + h / 3);
    _ctx.moveTo(minX, minY + h * 2 / 3);
    _ctx.lineTo(maxX, minY + h * 2 / 3);
    _ctx.stroke();

    const glow = _ctx.createRadialGradient(
        minX + w * 0.52, minY + h * 0.48, 0,
        minX + w * 0.52, minY + h * 0.48, Math.max(w, h) * 0.72
    );
    glow.addColorStop(0, 'rgba(255,255,255,0.20)');
    glow.addColorStop(0.65, 'rgba(0,122,61,0.14)');
    glow.addColorStop(1, 'rgba(0,122,61,0)');
    _ctx.fillStyle = glow;
    _ctx.fillRect(minX, minY, w, h);
    _ctx.restore();

    _ctx.save();
    _ctx.beginPath();
    _path(ANDALUSIA_BBOX);
    _ctx.shadowColor = 'rgba(138, 255, 188, 0.90)';
    _ctx.shadowBlur = 24;
    _ctx.strokeStyle = 'rgba(103, 255, 171, 0.34)';
    _ctx.lineWidth = 5;
    _ctx.stroke();
    _ctx.shadowBlur = 16;
    _ctx.strokeStyle = 'rgba(205, 255, 224, 0.94)';
    _ctx.lineWidth = 2.1;
    _ctx.stroke();
    _ctx.shadowBlur = 0;
    _ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    _ctx.lineWidth = 0.8;
    _ctx.stroke();
    _ctx.strokeStyle = 'rgba(0, 122, 61, 0.72)';
    _ctx.lineWidth = 0.45;
    _ctx.stroke();
    _ctx.restore();
}

function _zoomToAndalusia() {
    return new Promise(resolve => {
        _zooming = true;
        if (_animFrame) cancelAnimationFrame(_animFrame);

        const startRotation = [..._rotation];
        const endRotation = [-ANDALUSIA_CENTER[0], -ANDALUSIA_CENTER[1]];
        const startScale = _projection.scale();
        const endScale = Math.min(_width, _height) * 2.2;
        const duration = 3500;
        const startTime = performance.now();

        const interpRotate = d3.interpolate(startRotation, endRotation);
        const interpScale = d3.interpolate(startScale, endScale);

        function animate(now) {
            const t = Math.min(1, (now - startTime) / duration);
            // Ease: cubic in-out
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            const r = interpRotate(ease);
            const s = interpScale(ease);
            _projection.rotate(r).scale(s);
            _rotation = r;
            _drawGlobe();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                _zooming = false;
                resolve();
            }
        }
        requestAnimationFrame(animate);
    });
}

function _showCTA() {
    const cta = document.getElementById('landing-cta');
    const progress = document.getElementById('landing-progress');
    if (progress) progress.style.display = 'none';
    if (cta) {
        cta.style.display = '';
        // Force reflow to trigger CSS animation
        cta.offsetHeight;
    }
}

function _enterApp() {
    const landing = document.getElementById('landing');
    if (landing) landing.classList.add('hidden');

    // Clean up
    if (_animFrame) cancelAnimationFrame(_animFrame);
    _destroyParticles();
    window.removeEventListener('resize', _resize);

    // Dynamically import and run the app
    import('./app.js').then(() => {
        // app.js IIFE runs on import; after a short delay, remove landing DOM
        setTimeout(() => {
            if (landing) landing.remove();
        }, 800);
    }).catch(err => {
        console.error('Failed to load app:', err);
        if (landing) {
            landing.classList.remove('hidden');
            landing.style.opacity = '1';
            landing.innerHTML = `<div style="color:#fff;text-align:center;padding:40px">
                <h2>Error al cargar la aplicación</h2>
                <p>${err.message}</p>
            </div>`;
        }
    });
}
