/* ridge-view.js — Ridge plot (joy plot) of temperature anomaly distributions over decades.
   Inspired by the "2025 continues the shift" chart. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';

const RidgeView = (() => {
    let _initialized = false;
    const margin = { top: 40, right: 30, bottom: 40, left: 60 };

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('selectedTerritories', render);
        State.subscribe('activeIndicator', render);
    }

    function render() {
        if (State.get('activeView') !== 'ridge') return;

        const container = document.getElementById('ridge-container');
        if (!container) return;
        container.innerHTML = '';

        const indicator = State.get('activeIndicator');
        if (!['tmean', 'tmin', 'tmax'].includes(indicator)) {
            container.innerHTML = '<div class="chart-empty" style="display:block">La vista ridge solo está disponible para indicadores de temperatura</div>';
            return;
        }

        let selected = State.get('selectedTerritories');
        if (selected.length === 0) selected = ['AND'];
        const code = selected[0]; // Use first territory

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ridge-svg');
        svg.id = 'ridge-svg-main';
        container.appendChild(svg);

        requestAnimationFrame(() => _drawRidge('#ridge-svg-main', code, indicator));
    }

    function _drawRidge(svgSelector, code, indicator) {
        const svg = d3.select(svgSelector);
        const el = svg.node();
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;

        // Get annual time series — returns [{year, value}, ...]
        const ts = DataLoader.getTimeSeries(code, indicator);
        const years = DataLoader.getYears();
        if (!ts || ts.length === 0 || !years || years.length === 0) {
            svg.append('text').attr('x', w / 2).attr('y', h / 2)
                .attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12)
                .text('Sin datos para esta vista');
            return;
        }

        // Compute long-term average (reference period: all available data)
        let refSum = 0, refN = 0;
        for (const pt of ts) {
            if (pt.value != null) { refSum += pt.value; refN++; }
        }
        const refMean = refN > 0 ? refSum / refN : 0;

        // Group anomalies by decade
        const decadeGroups = {};
        for (const pt of ts) {
            if (pt.value == null) continue;
            const anomaly = pt.value - refMean;
            const decade = Math.floor(pt.year / 10) * 10;
            if (!decadeGroups[decade]) decadeGroups[decade] = [];
            decadeGroups[decade].push(anomaly);
        }

        const decades = Object.keys(decadeGroups).map(Number).sort((a, b) => a - b);
        if (decades.length < 3) {
            svg.append('text').attr('x', w / 2).attr('y', h / 2)
                .attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12)
                .text('Insuficientes datos para ridge plot');
            return;
        }

        // Compute KDE for each decade
        const allAnomalies = [];
        for (const vals of Object.values(decadeGroups)) {
            for (const v of vals) allAnomalies.push(v);
        }
        const xMin = d3.min(allAnomalies) - 0.5;
        const xMax = d3.max(allAnomalies) + 0.5;
        const bandwidth = 0.3; // KDE bandwidth in °C
        const nBins = 100;
        const xTicks = d3.range(nBins).map(i => xMin + (xMax - xMin) * i / (nBins - 1));

        function kde(values) {
            return xTicks.map(x => {
                let sum = 0;
                for (const v of values) {
                    const u = (x - v) / bandwidth;
                    sum += Math.exp(-0.5 * u * u) / (bandwidth * Math.sqrt(2 * Math.PI));
                }
                return { x, y: sum / values.length };
            });
        }

        const decadeKDEs = decades.map(d => ({
            decade: d,
            values: decadeGroups[d],
            kde: kde(decadeGroups[d]),
            mean: d3.mean(decadeGroups[d]),
        }));

        // Scales
        const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, iw]);
        const yBand = d3.scaleBand().domain(decades).range([0, ih]).padding(0.05);
        const ridgeHeight = yBand.bandwidth() * 2.5; // Allow overlap
        const maxDensity = d3.max(decadeKDEs, dk => d3.max(dk.kde, p => p.y));
        const yDensity = d3.scaleLinear().domain([0, maxDensity]).range([0, ridgeHeight]);

        // Color scale: cool decades blue, warm decades red
        const colorScale = d3.scaleLinear()
            .domain([d3.min(decadeKDEs, d => d.mean), 0, d3.max(decadeKDEs, d => d.mean)])
            .range(['#2171b5', '#e0e0e0', '#d7301f'])
            .clamp(true);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // Zero line
        g.append('line')
            .attr('x1', xScale(0)).attr('x2', xScale(0))
            .attr('y1', 0).attr('y2', ih)
            .attr('stroke', '#333').attr('stroke-width', 1).attr('opacity', 0.5);

        // Draw ridges from bottom (oldest) to top (newest) — but reverse so newer overlap older
        for (let i = decadeKDEs.length - 1; i >= 0; i--) {
            const dk = decadeKDEs[i];
            const baseY = yBand(dk.decade) + yBand.bandwidth();

            const areaPath = d3.area()
                .x(d => xScale(d.x))
                .y0(baseY)
                .y1(d => baseY - yDensity(d.y))
                .curve(d3.curveBasis);

            const linePath = d3.line()
                .x(d => xScale(d.x))
                .y(d => baseY - yDensity(d.y))
                .curve(d3.curveBasis);

            const fillColor = colorScale(dk.mean);

            // White background to cover lines behind
            g.append('path')
                .datum(dk.kde)
                .attr('d', areaPath)
                .attr('fill', '#fff');

            // Colored fill
            g.append('path')
                .datum(dk.kde)
                .attr('d', areaPath)
                .attr('fill', fillColor)
                .attr('opacity', 0.7);

            // Outline
            g.append('path')
                .datum(dk.kde)
                .attr('d', linePath)
                .attr('fill', 'none')
                .attr('stroke', d3.color(fillColor).darker(0.5))
                .attr('stroke-width', 1.2);

            // Decade label
            g.append('text')
                .attr('x', -8)
                .attr('y', baseY - 2)
                .attr('text-anchor', 'end')
                .attr('font-size', 10)
                .attr('fill', '#555')
                .text(dk.decade + 's');
        }

        // X axis
        g.append('g')
            .attr('class', 'axis')
            .attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).ticks(8).tickFormat(d => (d >= 0 ? '+' : '') + d.toFixed(1) + '°C'));

        // Labels
        g.append('text')
            .attr('x', xScale(xMin + (xMax - xMin) * 0.15))
            .attr('y', -18)
            .attr('text-anchor', 'middle')
            .attr('font-size', 9)
            .attr('fill', '#2171b5')
            .attr('font-weight', 600)
            .text('\u2190 Bajo la media');

        g.append('text')
            .attr('x', xScale(xMin + (xMax - xMin) * 0.85))
            .attr('y', -18)
            .attr('text-anchor', 'middle')
            .attr('font-size', 9)
            .attr('fill', '#d7301f')
            .attr('font-weight', 600)
            .text('Sobre la media \u2192');

        // Title
        const meta = DataLoader.getTerritoryMeta(code);
        const indDef = DataLoader.getIndicatorDef(indicator);
        const indLabel = indDef ? indDef.label : indicator;
        g.append('text')
            .attr('x', iw / 2)
            .attr('y', -26)
            .attr('text-anchor', 'middle')
            .attr('font-size', 12)
            .attr('font-weight', 700)
            .attr('fill', '#333')
            .text(`${meta ? meta.name : code} — Anomalías de ${indLabel} por década`);

        // Reference note
        g.append('text')
            .attr('x', iw / 2)
            .attr('y', ih + 32)
            .attr('text-anchor', 'middle')
            .attr('font-size', 9)
            .attr('fill', '#999')
            .text(`Referencia: media del periodo ${ts[0].year}-${ts[ts.length - 1].year} (${refMean.toFixed(1)} °C)`);

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx, my] = d3.pointer(e, this);
                // Find closest decade
                let closestDecade = null;
                let minDist = Infinity;
                for (const dk of decadeKDEs) {
                    const baseY = yBand(dk.decade) + yBand.bandwidth();
                    const dist = Math.abs(my - baseY);
                    if (dist < minDist) { minDist = dist; closestDecade = dk; }
                }
                if (closestDecade) {
                    const n = closestDecade.values.length;
                    const mean = closestDecade.mean;
                    let html = `<div class="tooltip-title">${closestDecade.decade}s</div>`;
                    html += `<div class="tooltip-row"><span class="tooltip-label">N. años</span><span class="tooltip-value">${n}</span></div>`;
                    html += `<div class="tooltip-row"><span class="tooltip-label">Anomalía media</span><span class="tooltip-value">${mean >= 0 ? '+' : ''}${mean.toFixed(2)} °C</span></div>`;
                    Tooltip.show(html, e.clientX, e.clientY);
                }
            })
            .on('mouseout', () => Tooltip.hide());
    }

    return { init, render };
})();

export default RidgeView;
