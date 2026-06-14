/* stripes-view.js — Ed Hawkins-style warming stripes
   Shows temperature (or precipitation) anomaly as colored vertical bars.
   One row per selected territory; defaults to Andalucia if none selected. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { buildAnomalyScale, buildPrecAnomalyScale, fmtIndicator, fmtTooltipContext, territoryColor } from '../utils.js';

const StripesView = (() => {
    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('selectedTerritories', render);
        State.subscribe('activeIndicator', render);
        State.subscribe('currentYear', _updateMarkers);
        State.subscribe('yearRange', render);
    }

    function render() {
        if (State.get('activeView') !== 'stripes') return;

        const container = document.getElementById('stripes-wrapper');
        if (!container) return;
        container.innerHTML = '';

        const indicator = State.get('activeIndicator');
        let selected = State.get('selectedTerritories');
        if (selected.length === 0) selected = ['AND'];

        const allYears = DataLoader.getYears();
        if (allYears.length === 0) return;
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const years = allYears.filter(y => y >= rangeStart && y <= rangeEnd);
        if (years.length === 0) return;
        const isPrec = indicator === 'prec';

        for (let si = 0; si < selected.length; si++) {
            const code = selected[si];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;

            // Get time series
            const values = years.map(y => DataLoader.getValue(code, y, indicator));
            const valid = values.filter(v => v != null);
            if (valid.length === 0) continue;
            const mean = valid.reduce((s, v) => s + v, 0) / valid.length;

            // Compute anomalies
            const anomalies = values.map(v => v != null ? v - mean : null);
            const validAnom = anomalies.filter(v => v != null);
            const minA = Math.min(...validAnom);
            const maxA = Math.max(...validAnom);
            const colorFn = isPrec ? buildPrecAnomalyScale(minA, maxA) : buildAnomalyScale(minA, maxA);

            // Build row
            const row = document.createElement('div');
            row.className = 'stripes-row';

            const label = document.createElement('div');
            label.className = 'stripes-label';
            label.style.color = selected.length > 1 ? territoryColor(si) : 'var(--c-text-2)';
            label.textContent = name;
            row.appendChild(label);

            // SVG stripe bar
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('class', 'stripes-svg');
            svg.setAttribute('preserveAspectRatio', 'none');
            row.appendChild(svg);

            container.appendChild(row);

            // Render after layout
            requestAnimationFrame(() => {
                const w = svg.clientWidth;
                const h = svg.clientHeight;
                if (!w || !h) return;

                const barW = w / years.length;
                svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

                for (let i = 0; i < years.length; i++) {
                    const rect = document.createElementNS(svgNS, 'rect');
                    rect.setAttribute('x', i * barW);
                    rect.setAttribute('y', 0);
                    rect.setAttribute('width', barW + 0.5);
                    rect.setAttribute('height', h);
                    rect.setAttribute('fill', colorFn(anomalies[i]));
                    svg.appendChild(rect);
                }

                // Year marker
                const currentYear = State.get('currentYear');
                const yIdx = years.indexOf(currentYear);
                if (yIdx >= 0) {
                    const marker = document.createElementNS(svgNS, 'line');
                    marker.setAttribute('class', 'stripes-marker');
                    marker.setAttribute('x1', (yIdx + 0.5) * barW);
                    marker.setAttribute('x2', (yIdx + 0.5) * barW);
                    marker.setAttribute('y1', 0);
                    marker.setAttribute('y2', h);
                    marker.setAttribute('stroke', '#fff');
                    marker.setAttribute('stroke-width', 2);
                    marker.setAttribute('opacity', 0.8);
                    svg.appendChild(marker);
                }

                // Year labels at edges
                const startLabel = document.createElementNS(svgNS, 'text');
                startLabel.setAttribute('x', 4);
                startLabel.setAttribute('y', h - 4);
                startLabel.setAttribute('fill', '#fff');
                startLabel.setAttribute('font-size', 10);
                startLabel.setAttribute('font-weight', 700);
                startLabel.textContent = years[0];
                svg.appendChild(startLabel);

                const endLabel = document.createElementNS(svgNS, 'text');
                endLabel.setAttribute('x', w - 4);
                endLabel.setAttribute('y', h - 4);
                endLabel.setAttribute('text-anchor', 'end');
                endLabel.setAttribute('fill', '#fff');
                endLabel.setAttribute('font-size', 10);
                endLabel.setAttribute('font-weight', 700);
                endLabel.textContent = years[years.length - 1];
                svg.appendChild(endLabel);

                // Hover overlay
                const overlay = document.createElementNS(svgNS, 'rect');
                overlay.setAttribute('width', w);
                overlay.setAttribute('height', h);
                overlay.setAttribute('fill', 'transparent');
                overlay.style.cursor = 'crosshair';
                svg.appendChild(overlay);

                svg.addEventListener('mousemove', function (e) {
                    const rect = svg.getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const yearIdx = Math.min(years.length - 1, Math.max(0, Math.floor(mx / barW)));
                    const year = years[yearIdx];
                    const val = values[yearIdx];
                    const anom = anomalies[yearIdx];
                    let html = `<div class="tooltip-title">${name}</div>`;
                    html += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), indicator, year);
                    html += `<div class="tooltip-row"><span class="tooltip-label">Valor</span><span class="tooltip-value">${fmtIndicator(val, indicator)}</span></div>`;
                    html += `<div class="tooltip-row"><span class="tooltip-label">Anomalía</span><span class="tooltip-value" style="color:${anom > 0 ? '#d7301f' : '#2171b5'}">${anom > 0 ? '+' : ''}${anom != null ? anom.toFixed(1) : '—'}</span></div>`;
                    html += `<div class="tooltip-row"><span class="tooltip-label">Media ref.</span><span class="tooltip-value">${fmtIndicator(mean, indicator)}</span></div>`;
                    Tooltip.show(html, e.clientX, e.clientY);
                });
                svg.addEventListener('mouseout', () => Tooltip.hide());

                // Store refs
                svg.__years = years;
                svg.__barW = barW;
                svg.__h = h;
            });
        }

        // Legend
        const legend = document.createElement('div');
        legend.className = 'stripes-legend';
        legend.innerHTML = isPrec
            ? '<span style="color:#8c510a">- seco</span> <span class="stripes-legend-bar prec"></span> <span style="color:#01665e">+ húmedo</span>'
            : '<span style="color:#08306b">- frío</span> <span class="stripes-legend-bar temp"></span> <span style="color:#7f0000">+ cálido</span>';
        legend.innerHTML += '<span class="stripes-legend-note">Anomalía respecto a la media del periodo</span>';
        container.appendChild(legend);
    }

    function _updateMarkers() {
        const wrapper = document.getElementById('stripes-wrapper');
        if (!wrapper) return;
        const svgs = wrapper.querySelectorAll('.stripes-svg');
        const currentYear = State.get('currentYear');
        for (const svg of svgs) {
            if (!svg.__years) continue;
            const marker = svg.querySelector('.stripes-marker');
            if (!marker) continue;
            const yIdx = svg.__years.indexOf(currentYear);
            if (yIdx >= 0) {
                const x = (yIdx + 0.5) * svg.__barW;
                marker.setAttribute('x1', x);
                marker.setAttribute('x2', x);
            }
        }
    }

    return { init, render };
})();

export default StripesView;
