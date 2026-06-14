/* climogram-view.js — Walter-Lieth style climograms
   Precipitation bars + temperature line for monthly data.
   Shows selected year overlaid on long-term average. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { territoryColor, fmt } from '../utils.js';

const ClimogramView = (() => {
    let _initialized = false;
    const margin = { top: 24, right: 52, bottom: 36, left: 52 };
    const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('selectedTerritories', render);
        State.subscribe('activeIndicator', render);
        State.subscribe('currentYear', render);
    }

    function _extractMonthly(code) {
        const monthly = DataLoader.getMonthlyData(code);
        if (!monthly) return null;
        const years = DataLoader.getMonthlyYears();
        const nYears = years.length;

        // Reshape flat arrays into [year][month]
        const tmeanArr = monthly.tmean || [];
        const precArr = monthly.prec || [];

        const tmeanByYear = [];
        const precByYear = [];
        for (let yi = 0; yi < nYears; yi++) {
            const tRow = [];
            const pRow = [];
            for (let m = 0; m < 12; m++) {
                const idx = yi * 12 + m;
                tRow.push(tmeanArr[idx] != null ? tmeanArr[idx] : null);
                pRow.push(precArr[idx] != null ? precArr[idx] : null);
            }
            tmeanByYear.push(tRow);
            precByYear.push(pRow);
        }

        // Compute long-term monthly averages
        const tmeanAvg = [];
        const precAvg = [];
        for (let m = 0; m < 12; m++) {
            let tSum = 0, tN = 0, pSum = 0, pN = 0;
            for (let yi = 0; yi < nYears; yi++) {
                if (tmeanByYear[yi][m] != null) { tSum += tmeanByYear[yi][m]; tN++; }
                if (precByYear[yi][m] != null) { pSum += precByYear[yi][m]; pN++; }
            }
            tmeanAvg.push(tN > 0 ? tSum / tN : null);
            precAvg.push(pN > 0 ? pSum / pN : null);
        }

        return { years, tmeanByYear, precByYear, tmeanAvg, precAvg };
    }

    function render() {
        if (State.get('activeView') !== 'climogram') return;

        const container = document.getElementById('climogram-container');
        if (!container) return;

        let selected = State.get('selectedTerritories');
        if (selected.length === 0) selected = ['AND'];

        const emptyEl = document.getElementById('climogram-empty');
        if (emptyEl) emptyEl.style.display = 'none';

        // For multiple territories, use faceted layout
        const isFacet = selected.length > 1;
        container.innerHTML = '';

        if (isFacet) {
            const grid = document.createElement('div');
            grid.className = 'climogram-grid';
            container.appendChild(grid);

            for (let si = 0; si < selected.length; si++) {
                const cell = document.createElement('div');
                cell.className = 'climogram-cell';
                const title = document.createElement('div');
                title.className = 'climogram-cell-title';
                const meta = DataLoader.getTerritoryMeta(selected[si]);
                const code = selected[si];
                title.innerHTML = `<span class="facet-dot" style="background:${territoryColor(si)}"></span>${meta ? meta.name : code}<button class="facet-remove" data-code="${code}" title="Quitar">&times;</button>`;
                cell.appendChild(title);
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'climogram-svg');
                svg.id = `climogram-svg-${si}`;
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
                    _drawClimogram(`#climogram-svg-${si}`, selected[si], si, true);
                }
            });
        } else {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'climogram-svg climogram-svg-full');
            svg.id = 'climogram-svg-main';
            container.appendChild(svg);

            requestAnimationFrame(() => {
                _drawClimogram('#climogram-svg-main', selected[0], 0, false);
            });
        }
    }

    function _drawClimogram(svgSelector, code, colorIdx, isSmall) {
        const svg = d3.select(svgSelector);
        const el = svg.node();
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const m = isSmall
            ? { top: 8, right: 36, bottom: 24, left: 36 }
            : margin;
        const iw = w - m.left - m.right;
        const ih = h - m.top - m.bottom;

        const data = _extractMonthly(code);
        if (!data) {
            svg.append('text').attr('x', w / 2).attr('y', h / 2)
                .attr('text-anchor', 'middle').attr('fill', '#9ca3af').attr('font-size', 12)
                .text('Sin datos mensuales');
            return;
        }

        const currentYear = State.get('currentYear');
        const yearIdx = data.years.indexOf(currentYear);

        // Get current year monthly data
        const curTmean = yearIdx >= 0 ? data.tmeanByYear[yearIdx] : data.tmeanAvg;
        const curPrec = yearIdx >= 0 ? data.precByYear[yearIdx] : data.precAvg;

        // Scales
        const xScale = d3.scaleBand().domain(d3.range(12)).range([0, iw]).padding(0.15);
        const maxPrec = Math.max(
            d3.max(data.precAvg.filter(v => v != null)) || 0,
            d3.max(curPrec.filter(v => v != null)) || 0
        ) * 1.15;
        const maxTemp = Math.max(
            d3.max(data.tmeanAvg.filter(v => v != null)) || 0,
            d3.max(curTmean.filter(v => v != null)) || 0
        ) * 1.15;
        const minTemp = Math.min(
            d3.min(data.tmeanAvg.filter(v => v != null)) || 0,
            d3.min(curTmean.filter(v => v != null)) || 0
        ) - 1;

        const yPrec = d3.scaleLinear().domain([0, maxPrec]).range([ih, 0]).nice();
        const yTemp = d3.scaleLinear().domain([minTemp, maxTemp]).range([ih, 0]).nice();

        const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

        // Grid
        g.append('g').attr('class', 'grid')
            .call(d3.axisLeft(yPrec).ticks(4).tickSize(-iw).tickFormat(''));

        // Average precipitation bars (light)
        g.selectAll('.prec-avg')
            .data(data.precAvg)
            .join('rect')
            .attr('class', 'prec-avg')
            .attr('x', (d, i) => xScale(i))
            .attr('y', d => d != null ? yPrec(d) : ih)
            .attr('width', xScale.bandwidth())
            .attr('height', d => d != null ? ih - yPrec(d) : 0)
            .attr('fill', '#1d91c0')
            .attr('opacity', 0.2);

        // Current year precipitation bars
        g.selectAll('.prec-cur')
            .data(curPrec)
            .join('rect')
            .attr('class', 'prec-cur')
            .attr('x', (d, i) => xScale(i) + xScale.bandwidth() * 0.15)
            .attr('y', d => d != null ? yPrec(d) : ih)
            .attr('width', xScale.bandwidth() * 0.7)
            .attr('height', d => d != null ? ih - yPrec(d) : 0)
            .attr('fill', '#1d91c0')
            .attr('opacity', 0.7);

        // Average temperature line (dashed)
        const lineAvg = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.i) + xScale.bandwidth() / 2)
            .y(d => yTemp(d.value));

        g.append('path')
            .datum(data.tmeanAvg.map((v, i) => ({ i, value: v })))
            .attr('d', lineAvg)
            .attr('fill', 'none')
            .attr('stroke', '#c44e10')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,3')
            .attr('opacity', 0.6);

        // Current year temperature line (solid)
        const lineCur = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.i) + xScale.bandwidth() / 2)
            .y(d => yTemp(d.value));

        g.append('path')
            .datum(curTmean.map((v, i) => ({ i, value: v })))
            .attr('d', lineCur)
            .attr('fill', 'none')
            .attr('stroke', '#c44e10')
            .attr('stroke-width', 2.5);

        // Temperature dots
        for (let i = 0; i < 12; i++) {
            if (curTmean[i] != null) {
                g.append('circle')
                    .attr('cx', xScale(i) + xScale.bandwidth() / 2)
                    .attr('cy', yTemp(curTmean[i]))
                    .attr('r', isSmall ? 2.5 : 3.5)
                    .attr('fill', '#c44e10')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1);
            }
        }

        // Axes
        const tickCount = isSmall ? 3 : 5;
        g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickFormat(i => MONTHS[i]));
        g.append('g').attr('class', 'axis')
            .call(d3.axisLeft(yPrec).ticks(tickCount).tickFormat(d => Math.round(d) + ''));
        g.append('g').attr('class', 'axis').attr('transform', `translate(${iw},0)`)
            .call(d3.axisRight(yTemp).ticks(tickCount).tickFormat(d => d.toFixed(0) + '°'));

        // Axis labels
        if (!isSmall) {
            g.append('text').attr('x', -m.left + 12).attr('y', -8)
                .attr('font-size', 9).attr('fill', '#1d91c0').attr('font-weight', 600)
                .text('Precip. (mm)');
            g.append('text').attr('x', iw + m.right - 12).attr('y', -8)
                .attr('text-anchor', 'end')
                .attr('font-size', 9).attr('fill', '#c44e10').attr('font-weight', 600)
                .text('Temp. (°C)');

            const meta = DataLoader.getTerritoryMeta(code);
            g.append('text').attr('x', iw / 2).attr('y', -8)
                .attr('text-anchor', 'middle')
                .attr('font-size', 11).attr('font-weight', 700).attr('fill', '#333')
                .text(`${meta ? meta.name : code} — ${currentYear}`);

            // Legend
            g.append('line').attr('x1', iw * 0.3).attr('x2', iw * 0.3 + 20).attr('y1', ih + 28).attr('y2', ih + 28)
                .attr('stroke', '#c44e10').attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3');
            g.append('text').attr('x', iw * 0.3 + 24).attr('y', ih + 31)
                .attr('font-size', 9).attr('fill', '#888').text('Media periodo');
            g.append('rect').attr('x', iw * 0.6).attr('y', ih + 23).attr('width', 12).attr('height', 8)
                .attr('fill', '#1d91c0').attr('opacity', 0.2);
            g.append('text').attr('x', iw * 0.6 + 16).attr('y', ih + 31)
                .attr('font-size', 9).attr('fill', '#888').text('Precip. media');
        }

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const monthIdx = Math.min(11, Math.max(0, Math.floor(mx / (iw / 12))));
                const meta = DataLoader.getTerritoryMeta(code);
                let html = `<div class="tooltip-title">${meta ? meta.name : code} — ${MONTHS[monthIdx]} ${currentYear}</div>`;
                html += `<div class="tooltip-row"><span class="tooltip-label" style="color:#c44e10">Temperatura</span><span class="tooltip-value">${curTmean[monthIdx] != null ? curTmean[monthIdx].toFixed(1) + ' °C' : '—'}</span></div>`;
                html += `<div class="tooltip-row"><span class="tooltip-label" style="color:#1d91c0">Precipitación</span><span class="tooltip-value">${curPrec[monthIdx] != null ? curPrec[monthIdx].toFixed(1) + ' mm' : '—'}</span></div>`;
                html += `<div class="tooltip-row"><span class="tooltip-label">Media temp.</span><span class="tooltip-value">${data.tmeanAvg[monthIdx] != null ? data.tmeanAvg[monthIdx].toFixed(1) + ' °C' : '—'}</span></div>`;
                html += `<div class="tooltip-row"><span class="tooltip-label">Media precip.</span><span class="tooltip-value">${data.precAvg[monthIdx] != null ? data.precAvg[monthIdx].toFixed(1) + ' mm' : '—'}</span></div>`;
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    return { init, render };
})();

export default ClimogramView;
