/* spaghetti-view.js — Annual cycle spaghetti chart (CNN-style)
   Each year as a semi-transparent line over Jan-Dec.
   Current year highlighted in bold color. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { territoryColor } from '../utils.js';

const SpaghettiView = (() => {
    let _initialized = false;
    const margin = { top: 28, right: 20, bottom: 36, left: 52 };
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('selectedTerritories', render);
        State.subscribe('activeIndicator', render);
        State.subscribe('currentYear', render);
    }

    function _extractMonthly(code, variable) {
        const monthly = DataLoader.getMonthlyData(code);
        if (!monthly) return null;
        const years = DataLoader.getMonthlyYears();
        const arr = monthly[variable] || [];
        const nYears = years.length;

        const byYear = [];
        for (let yi = 0; yi < nYears; yi++) {
            const row = [];
            let hasData = false;
            for (let m = 0; m < 12; m++) {
                const v = arr[yi * 12 + m];
                row.push(v != null ? v : null);
                if (v != null) hasData = true;
            }
            byYear.push(hasData ? row : null);
        }

        // Compute long-term monthly average
        const avg = [];
        for (let m = 0; m < 12; m++) {
            let sum = 0, n = 0;
            for (let yi = 0; yi < nYears; yi++) {
                if (byYear[yi] && byYear[yi][m] != null) { sum += byYear[yi][m]; n++; }
            }
            avg.push(n > 0 ? sum / n : null);
        }

        return { years, byYear, avg };
    }

    function render() {
        if (State.get('activeView') !== 'spaghetti') return;

        const container = document.getElementById('spaghetti-container');
        if (!container) return;
        container.innerHTML = '';

        let selected = State.get('selectedTerritories');
        if (selected.length === 0) selected = ['AND'];

        const indicator = State.get('activeIndicator');
        const variable = (indicator === 'prec') ? 'prec' : 'tmean';
        const isPrec = variable === 'prec';
        const unit = isPrec ? 'mm' : '°C';

        const emptyEl = document.getElementById('spaghetti-empty');
        if (emptyEl) emptyEl.style.display = 'none';

        // For multiple territories, use faceted layout
        const isFacet = selected.length > 1;

        if (isFacet) {
            const grid = document.createElement('div');
            grid.className = 'spaghetti-grid';
            container.appendChild(grid);

            for (let si = 0; si < selected.length; si++) {
                const cell = document.createElement('div');
                cell.className = 'spaghetti-cell';
                const title = document.createElement('div');
                title.className = 'spaghetti-cell-title';
                const meta = DataLoader.getTerritoryMeta(selected[si]);
                const code = selected[si];
                title.innerHTML = `<span class="facet-dot" style="background:${territoryColor(si)}"></span>${meta ? meta.name : code}<button class="facet-remove" data-code="${code}" title="Quitar">&times;</button>`;
                cell.appendChild(title);
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'spaghetti-svg');
                svg.id = `spaghetti-svg-${si}`;
                cell.appendChild(svg);
                grid.appendChild(cell);
            }

            // Bind remove buttons
            grid.querySelectorAll('.facet-remove').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    State.removeTerritory(btn.dataset.code);
                });
            });

            requestAnimationFrame(() => {
                for (let si = 0; si < selected.length; si++) {
                    _drawSpaghetti(`#spaghetti-svg-${si}`, selected[si], si, variable, unit, true);
                }
            });
        } else {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'spaghetti-svg spaghetti-svg-full');
            svg.id = 'spaghetti-svg-main';
            container.appendChild(svg);

            requestAnimationFrame(() => {
                _drawSpaghetti('#spaghetti-svg-main', selected[0], 0, variable, unit, false);
            });
        }
    }

    function _drawSpaghetti(svgSelector, code, colorIdx, variable, unit, isSmall) {
        const svg = d3.select(svgSelector);
        const el = svg.node();
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const m = isSmall
            ? { top: 8, right: 12, bottom: 24, left: 40 }
            : margin;
        const iw = w - m.left - m.right;
        const ih = h - m.top - m.bottom;

        const data = _extractMonthly(code, variable);
        if (!data) {
            svg.append('text').attr('x', w / 2).attr('y', h / 2)
                .attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12)
                .text('Sin datos mensuales');
            return;
        }

        const currentYear = State.get('currentYear');
        const currentYearIdx = data.years.indexOf(currentYear);

        // Compute y-range across all years
        let allMin = Infinity, allMax = -Infinity;
        for (const row of data.byYear) {
            if (!row) continue;
            for (const v of row) {
                if (v != null) {
                    if (v < allMin) allMin = v;
                    if (v > allMax) allMax = v;
                }
            }
        }
        if (!isFinite(allMin)) { allMin = 0; allMax = 30; }

        const xScale = d3.scaleLinear().domain([0, 11]).range([0, iw]);
        const yScale = d3.scaleLinear().domain([allMin - 1, allMax + 1]).range([ih, 0]).nice();

        const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

        // Grid
        g.append('g').attr('class', 'grid')
            .call(d3.axisLeft(yScale).ticks(isSmall ? 4 : 6).tickSize(-iw).tickFormat(''));

        // Axes
        g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).ticks(12).tickFormat(i => MONTHS[Math.round(i)] || ''));
        g.append('g').attr('class', 'axis')
            .call(d3.axisLeft(yScale).ticks(isSmall ? 4 : 6).tickFormat(d => d.toFixed(0)));

        // All years as semi-transparent lines
        const lineFn = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.month))
            .y(d => yScale(d.value));

        // Smoothed line generator (for current year)
        const smoothLineFn = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.month))
            .y(d => yScale(d.value))
            .curve(d3.curveCardinal.tension(0.3));

        // Determine decade coloring
        const decadeColor = d3.scaleSequential()
            .domain([data.years[0], data.years[data.years.length - 1]])
            .interpolator(d3.interpolateRgbBasis([
                '#6baed6', '#9ecae1', '#c6dbef', '#e0e0e0',
                '#fdd49e', '#fc8d59', '#d7301f',
            ]));

        for (let yi = 0; yi < data.years.length; yi++) {
            if (yi === currentYearIdx) continue; // Draw current year last
            const row = data.byYear[yi];
            if (!row) continue;
            const lineData = row.map((v, m) => ({ month: m, value: v }));
            g.append('path')
                .datum(lineData)
                .attr('d', lineFn)
                .attr('fill', 'none')
                .attr('stroke', decadeColor(data.years[yi]))
                .attr('stroke-width', 0.8)
                .attr('opacity', 0.35);
        }

        // Long-term average (dashed, thin)
        const avgData = data.avg.map((v, m) => ({ month: m, value: v }));
        const smoothAvgLineFn = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.month))
            .y(d => yScale(d.value))
            .curve(d3.curveCardinal.tension(0.3));
        g.append('path')
            .datum(avgData)
            .attr('d', smoothAvgLineFn)
            .attr('fill', 'none')
            .attr('stroke', '#333')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '6,4');

        // Current year: ribbon (red above avg, blue below) + smoothed bold line
        if (currentYearIdx >= 0 && data.byYear[currentYearIdx]) {
            const curData = data.byYear[currentYearIdx].map((v, m) => ({ month: m, value: v }));

            // Render smoothed curves as invisible paths to sample them
            const curPath = g.append('path')
                .datum(curData)
                .attr('d', smoothLineFn)
                .attr('fill', 'none')
                .attr('stroke', 'none');
            const avgPath = g.append('path')
                .datum(avgData)
                .attr('d', smoothAvgLineFn)
                .attr('fill', 'none')
                .attr('stroke', 'none');

            const curNode = curPath.node();
            const avgNode = avgPath.node();
            const curLen = curNode.getTotalLength();
            const avgLen = avgNode.getTotalLength();

            // Sample both smoothed curves at many x positions
            // Helper: binary search for y at a given x along a path
            function sampleY(pathNode, totalLen, targetX) {
                let lo = 0, hi = totalLen;
                for (let iter = 0; iter < 25; iter++) {
                    const mid = (lo + hi) / 2;
                    const pt = pathNode.getPointAtLength(mid);
                    if (pt.x < targetX) lo = mid;
                    else hi = mid;
                }
                return pathNode.getPointAtLength((lo + hi) / 2).y;
            }

            const x0 = xScale(0);
            const x1 = xScale(11);
            const nSamples = 120;
            const dense = [];
            for (let s = 0; s <= nSamples; s++) {
                const x = x0 + (x1 - x0) * s / nSamples;
                dense.push({
                    x,
                    yCur: sampleY(curNode, curLen, x),
                    yAvg: sampleY(avgNode, avgLen, x),
                });
            }

            // Remove invisible paths
            curPath.remove();
            avgPath.remove();

            if (dense.length >= 2) {
                // Red ribbon: current ABOVE average (yCur < yAvg in screen coords)
                g.append('path')
                    .datum(dense)
                    .attr('d', d3.area()
                        .x(d => d.x)
                        .y0(d => d.yAvg)
                        .y1(d => Math.min(d.yCur, d.yAvg)))
                    .attr('fill', '#d7301f')
                    .attr('opacity', 0.25);

                // Blue ribbon: current BELOW average (yCur > yAvg in screen coords)
                g.append('path')
                    .datum(dense)
                    .attr('d', d3.area()
                        .x(d => d.x)
                        .y0(d => Math.max(d.yCur, d.yAvg))
                        .y1(d => d.yAvg))
                    .attr('fill', '#2171b5')
                    .attr('opacity', 0.25);
            }

            // Smoothed current year line (bold, dark warm color)
            g.append('path')
                .datum(curData)
                .attr('d', smoothLineFn)
                .attr('fill', 'none')
                .attr('stroke', '#b5202a')
                .attr('stroke-width', 3);

            // Dots at each month
            for (const pt of curData) {
                if (pt.value != null) {
                    g.append('circle')
                        .attr('cx', xScale(pt.month))
                        .attr('cy', yScale(pt.value))
                        .attr('r', isSmall ? 2 : 3)
                        .attr('fill', '#b5202a')
                        .attr('stroke', '#fff')
                        .attr('stroke-width', 1);
                }
            }

            // Year label
            const lastPt = curData.filter(d => d.value != null).pop();
            if (lastPt) {
                g.append('text')
                    .attr('x', xScale(lastPt.month) + 6)
                    .attr('y', yScale(lastPt.value) - 4)
                    .attr('font-size', isSmall ? 9 : 11)
                    .attr('font-weight', 700)
                    .attr('fill', '#b5202a')
                    .text(currentYear);
            }
        }

        // Title and labels
        if (!isSmall) {
            const meta = DataLoader.getTerritoryMeta(code);
            g.append('text').attr('x', iw / 2).attr('y', -10)
                .attr('text-anchor', 'middle')
                .attr('font-size', 11).attr('font-weight', 700).attr('fill', '#333')
                .text(`${meta ? meta.name : code} — Ciclo anual (${unit})`);

            // Legend
            const legY = ih + 22;
            // Average line legend
            g.append('line').attr('x1', 0).attr('x2', 24).attr('y1', legY + 6).attr('y2', legY + 6)
                .attr('stroke', '#333').attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4');
            g.append('text').attr('x', 28).attr('y', legY + 9)
                .attr('font-size', 9).attr('fill', '#888').text('Media del periodo');

            // Ribbon legend
            g.append('rect').attr('x', 140).attr('y', legY + 1).attr('width', 12).attr('height', 10)
                .attr('fill', '#d7301f').attr('opacity', 0.3).attr('rx', 1);
            g.append('text').attr('x', 156).attr('y', legY + 9)
                .attr('font-size', 9).attr('fill', '#888').text('Sobre media');
            g.append('rect').attr('x', 220).attr('y', legY + 1).attr('width', 12).attr('height', 10)
                .attr('fill', '#2171b5').attr('opacity', 0.3).attr('rx', 1);
            g.append('text').attr('x', 236).attr('y', legY + 9)
                .attr('font-size', 9).attr('fill', '#888').text('Bajo media');

            // Color legend bar for decades
            const legendW = 100;
            const legendX = iw - legendW;
            const lgGrad = svg.append('defs').append('linearGradient')
                .attr('id', 'spaghetti-grad').attr('x1', '0%').attr('x2', '100%');
            lgGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6baed6');
            lgGrad.append('stop').attr('offset', '50%').attr('stop-color', '#e0e0e0');
            lgGrad.append('stop').attr('offset', '100%').attr('stop-color', '#d7301f');
            g.append('rect').attr('x', legendX).attr('y', legY)
                .attr('width', legendW).attr('height', 6).attr('rx', 2)
                .attr('fill', 'url(#spaghetti-grad)');
            g.append('text').attr('x', legendX).attr('y', legY - 4)
                .attr('font-size', 8).attr('fill', '#888').text(data.years[0]);
            g.append('text').attr('x', legendX + legendW).attr('y', legY - 4)
                .attr('text-anchor', 'end')
                .attr('font-size', 8).attr('fill', '#888').text(data.years[data.years.length - 1]);
        }

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const monthIdx = Math.min(11, Math.max(0, Math.round(xScale.invert(mx))));
                const meta = DataLoader.getTerritoryMeta(code);
                let html = `<div class="tooltip-title">${meta ? meta.name : code} — ${MONTHS[monthIdx]}</div>`;

                // Current year value
                if (currentYearIdx >= 0 && data.byYear[currentYearIdx]) {
                    const v = data.byYear[currentYearIdx][monthIdx];
                    const avg = data.avg[monthIdx];
                    const diff = (v != null && avg != null) ? v - avg : null;
                    const diffStr = diff != null ? ` (${diff >= 0 ? '+' : ''}${diff.toFixed(1)})` : '';
                    html += `<div class="tooltip-row"><span class="tooltip-label" style="font-weight:700">${currentYear}</span><span class="tooltip-value">${v != null ? v.toFixed(1) + ' ' + unit + diffStr : '—'}</span></div>`;
                }
                // Average
                html += `<div class="tooltip-row"><span class="tooltip-label">Media</span><span class="tooltip-value">${data.avg[monthIdx] != null ? data.avg[monthIdx].toFixed(1) + ' ' + unit : '—'}</span></div>`;

                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    return { init, render };
})();

export default SpaghettiView;
