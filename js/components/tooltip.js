/* tooltip.js — Shared hover tooltip */
const Tooltip = (() => {
    let _el;

    function init() {
        _el = document.getElementById('tooltip');
    }

    function show(html, x, y) {
        _el.innerHTML = html;
        _el.classList.add('visible');
        const r = _el.getBoundingClientRect();
        const px = Math.min(x + 12, window.innerWidth - r.width - 8);
        const py = y + r.height + 20 > window.innerHeight ? y - r.height - 8 : y + 12;
        _el.style.left = px + 'px';
        _el.style.top = py + 'px';
    }

    function hide() {
        _el.classList.remove('visible');
    }

    return { init, show, hide };
})();

export default Tooltip;
