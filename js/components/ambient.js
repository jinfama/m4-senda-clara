/* ambient.js — Subtle floating olive-leaf particles behind the app.
   Canvas-based, extremely faint, with gentle mouse interaction. */

const Ambient = (() => {
    let _canvas, _ctx, _w, _h, _dpr;
    let _leaves = [];
    let _mouse = { x: -9999, y: -9999 };
    let _raf = null;
    const NUM_LEAVES = 28;
    const MOUSE_RADIUS = 150;

    function init() {
        _canvas = document.createElement('canvas');
        _canvas.className = 'ambient-canvas';
        const main = document.querySelector('.main');
        if (!main) return;
        main.prepend(_canvas);

        _ctx = _canvas.getContext('2d');
        _resize();
        _seedLeaves();
        window.addEventListener('resize', _resize);
        document.querySelector('.main').addEventListener('mousemove', _onMouse);
        document.querySelector('.main').addEventListener('mouseleave', () => {
            _mouse.x = -9999; _mouse.y = -9999;
        });
        _loop();
    }

    function _resize() {
        const main = document.querySelector('.main');
        if (!main || !_canvas) return;
        _w = main.clientWidth;
        _h = main.clientHeight;
        _dpr = window.devicePixelRatio || 1;
        _canvas.width = _w * _dpr;
        _canvas.height = _h * _dpr;
        _canvas.style.width = _w + 'px';
        _canvas.style.height = _h + 'px';
        _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    }

    function _onMouse(e) {
        const rect = _canvas.getBoundingClientRect();
        _mouse.x = e.clientX - rect.left;
        _mouse.y = e.clientY - rect.top;
    }

    function _seedLeaves() {
        _leaves = [];
        for (let i = 0; i < NUM_LEAVES; i++) {
            _leaves.push(_createLeaf(true));
        }
    }

    function _createLeaf(randomY) {
        const size = 10 + Math.random() * 18;
        return {
            x: Math.random() * (_w || 800),
            y: randomY ? Math.random() * (_h || 600) : -size * 2,
            size,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.008,
            vx: (Math.random() - 0.5) * 0.15,
            vy: 0.08 + Math.random() * 0.14,
            opacity: 0.08 + Math.random() * 0.10,
            phase: Math.random() * Math.PI * 2,
            sway: 0.2 + Math.random() * 0.3,
        };
    }

    function _loop() {
        _update();
        _draw();
        _raf = requestAnimationFrame(_loop);
    }

    function _update() {
        for (const l of _leaves) {
            // Gentle drift
            l.x += l.vx + Math.sin(l.phase) * l.sway * 0.3;
            l.y += l.vy;
            l.angle += l.spin;
            l.phase += 0.006;

            // Mouse repulsion
            const dx = l.x - _mouse.x;
            const dy = l.y - _mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < MOUSE_RADIUS && dist > 0) {
                const force = (1 - dist / MOUSE_RADIUS) * 0.4;
                l.x += (dx / dist) * force;
                l.y += (dy / dist) * force;
                l.spin += (dx > 0 ? 0.002 : -0.002);
            }

            // Recycle off-screen leaves
            if (l.y > _h + l.size * 2 || l.x < -l.size * 3 || l.x > _w + l.size * 3) {
                Object.assign(l, _createLeaf(false));
                l.x = Math.random() * _w;
            }
        }
    }

    function _draw() {
        _ctx.clearRect(0, 0, _w, _h);
        for (const l of _leaves) {
            _ctx.save();
            _ctx.translate(l.x, l.y);
            _ctx.rotate(l.angle);
            _ctx.globalAlpha = l.opacity;
            _drawLeafShape(_ctx, l.size);
            _ctx.restore();
        }
    }

    /* Draw an olive-leaf silhouette: an elongated pointed ellipse with a central vein */
    function _drawLeafShape(ctx, size) {
        const w = size * 0.38;
        const h = size;

        // Leaf body — pointed ellipse
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(w * 1.1, -h * 0.5, w * 1.1, h * 0.5, 0, h);
        ctx.bezierCurveTo(-w * 1.1, h * 0.5, -w * 1.1, -h * 0.5, 0, -h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(120, 150, 100, 1)';
        ctx.fill();

        // Central vein
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.85);
        ctx.lineTo(0, h * 0.85);
        ctx.strokeStyle = 'rgba(90, 120, 75, 0.6)';
        ctx.lineWidth = 0.4;
        ctx.stroke();
    }

    function destroy() {
        if (_raf) cancelAnimationFrame(_raf);
        if (_canvas && _canvas.parentNode) _canvas.remove();
        window.removeEventListener('resize', _resize);
    }

    return { init, destroy };
})();

export default Ambient;
