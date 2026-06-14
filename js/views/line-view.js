/* line-view.js — Multi-series line chart with overlay + facet modes
   Progressive reveal: during timelapse, lines draw up to currentYear via clip-path.
   Empleo mode adds "Sectores" facet showing 3 sector lines per territory. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { territoryColor, fmt, fmtIndicator, fmtTooltipContext, isCategoricalIndicator, HAB4_CATEGORIES, smartXTicks } from '../utils.js';

const SECTOR_FIELDS_PCT = ['pct_agr', 'pct_ind', 'pct_ser'];
const SECTOR_FIELDS_N = ['n_agr', 'n_ind', 'n_ser'];
const SECTOR_LABELS = { pct_agr: 'Agricultura', pct_ind: 'Industria', pct_ser: 'Servicios',
                         n_agr: 'Agricultura', n_ind: 'Industria', n_ser: 'Servicios' };
const SECTOR_COLORS = { pct_agr: '#66a61e', pct_ind: '#7570b3', pct_ser: '#e7298a',
                         n_agr: '#66a61e', n_ind: '#7570b3', n_ser: '#e7298a' };

const RURAL_INDICATORS = new Set([
    'pct_rural_5k', 'pct_rural_10k', 'pct_rural_5k_nuc', 'pct_rural_10k_nuc',
    'pct_rural_5k_ex', 'pct_rural_10k_ex', 'pct_rural_5k_nuc_ex', 'pct_rural_10k_nuc_ex'
]);
const RURAL_COLORS = { rural: '#d95f02', urbano: '#1b9e77' };
const RURAL_LABELS = { rural: 'Rural', urbano: 'Urbano' };

const DISPERSION_INDICATORS = new Set([
    'pct_dispersion', 'pct_agrupada', 'pob_dispersa', 'pob_agrupada'
]);
const DISPERSION_COLORS = { dispersa: '#e6550d', agrupada: '#3182bd' };
const DISPERSION_LABELS = { dispersa: 'Dispersa', agrupada: 'Agrupada' };

const HAB_DATA_FIELDS = ['pct_ciudad', 'pct_agro', 'pct_nuc', 'pct_disp'];
const HAB_COLORS = {};
const HAB_LABELS = {};
for (const c of HAB4_CATEGORIES) {
    HAB_COLORS[HAB_DATA_FIELDS[c.code - 1]] = c.color;
    HAB_LABELS[HAB_DATA_FIELDS[c.code - 1]] = c.label;
}

const LineView = (() => {
    let _initialized = false;
    let _renderGen = 0; // generation counter to avoid stale requestAnimationFrame callbacks
    const margin = { top: 20, right: 100, bottom: 30, left: 60 };
    const facetMargin = { top: 8, right: 12, bottom: 24, left: 44 };

    function _addYLabel(g, text, ih, mLeft) {
        if (!text) return;
        g.append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -ih / 2)
            .attr('y', -mLeft + 14)
            .attr('text-anchor', 'middle')
            .attr('font-size', 11)
            .attr('fill', '#999')
            .text(text);
    }

    function _getUnitLabel() {
        const ind = State.get('activeIndicator');
        const def = DataLoader.getIndicatorDef(ind);
        const axisMode = State.get('axisMode');
        if (axisMode === 'index') return 'Índice (base 100)';
        if (axisMode === 'pct_total') return '% del total';
        return def ? def.unit : '';
    }

    function _isEmpleo() {
        return State.get('activeCategory') === 'empleo';
    }

    function _isCategorical() {
        return isCategoricalIndicator(State.get('activeIndicator'));
    }

    function _isRural() {
        return RURAL_INDICATORS.has(State.get('activeIndicator'));
    }

    function _isDispersion() {
        return DISPERSION_INDICATORS.has(State.get('activeIndicator'));
    }

    function _isHabitatAggregate() {
        if (!_isCategorical()) return false;
        const level = State.get('geoLevel');
        return level !== 'municipio';
    }

    function _getMode() {
        const mode = State.get('chartLayout');
        // Reset mode if 'sector' but no longer empleo
        if (mode === 'sector' && !_isEmpleo()) return 'overlay';
        return mode;
    }

    function init() {
        if (_initialized) return;
        _initialized = true;

        State.subscribe('selectedTerritories', render);
        State.subscribe('activeIndicator', render);
        State.subscribe('axisMode', render);
        State.subscribe('chartLayout', render);
        State.subscribe('scaleType', render);
        State.subscribe('showAverage', render);
        State.subscribe('yearRange', render);
        State.subscribe('geoLevel', render);
        State.subscribe('ruralVisibleLines', render);
        State.subscribe('ruralUnit', render);
        State.subscribe('ruralMethod', render);
        State.subscribe('excludeAgro', render);
        State.subscribe('habitatVisibleLines', render);
        State.subscribe('habitatUnit', render);
        State.subscribe('dispersionVisibleLines', render);
        State.subscribe('dispersionUnit', render);
        State.subscribe('facetYAxis', render);
        State.subscribe('currentYear', _onYearChange);
    }

    function render() {
        // Only render if line panel is visible (chart view with line type, or direct line view)
        const view = State.get('activeView');
        if (view === 'chart' && State.get('chartType') !== 'line') return;
        if (view !== 'chart' && view !== 'line') return;

        const mode = _getMode();
        if (_isCategorical()) {
            if (_isHabitatAggregate()) {
                if (mode === 'facet') _renderHabitatLinesFacet();
                else _renderHabitatLinesOverlay();
            } else {
                if (mode === 'facet') _renderStripsFacet();
                else _renderStripsOverlay();
            }
        } else if (_isRural()) {
            if (State.get('geoLevel') === 'municipio') {
                if (mode === 'facet') _renderRuralStripsFacet();
                else _renderRuralStripsOverlay();
            } else {
                if (mode === 'facet') _renderRuralFacet();
                else _renderRuralOverlay();
            }
        } else if (_isDispersion()) {
            if (mode === 'facet') _renderDispersionFacet();
            else _renderDispersionOverlay();
        } else if (mode === 'sector' && _isEmpleo()) {
            _renderSectorFacets();
        } else if (mode === 'facet') {
            _renderFacet();
        } else {
            _renderOverlay();
        }
    }

    /* ── Overlay mode with clip-path progressive reveal ── */
    function _renderOverlay() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = '';
        facetGrid.style.display = 'none';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const axisMode = State.get('axisMode');
        const emptyEl = document.getElementById('line-empty');

        if (selected.length === 0) {
            d3.select('#line-svg').selectAll('*').remove();
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        const svg = d3.select('#line-svg');
        svg.selectAll('*').remove();

        const rect = svg.node().getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;

        const series = _buildSeries(selected, indicator, axisMode);
        const scaleType = State.get('scaleType');

        // Clamp data to yearRange
        const [rangeStart, rangeEnd] = State.get('yearRange');
        for (const s of series) {
            s.data = s.data.filter(d => d.year >= rangeStart && d.year <= rangeEnd);
        }

        // Scales — auto-detect actual data extent within yearRange
        const allPoints = series.flatMap(s => s.data);
        if (allPoints.length === 0) {
            d3.select('#line-svg').selectAll('*').remove();
            emptyEl.style.display = 'flex';
            return;
        }
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const xMin = dataYears.length > 0 ? Math.max(rangeStart, d3.min(dataYears)) : rangeStart;
        const xMax = dataYears.length > 0 ? Math.min(rangeEnd, d3.max(dataYears)) : rangeEnd;
        const xScale = d3.scaleLinear()
            .domain([xMin, xMax])
            .range([0, iw]);
        const yScale = _buildYScale(allPoints, ih, scaleType);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // Clip-path for progressive reveal
        const clipId = 'line-clip-' + Date.now();
        const currentYear = State.get('currentYear');
        const clipX = xScale(currentYear);

        svg.append('defs').append('clipPath').attr('id', clipId)
            .append('rect')
            .attr('x', 0).attr('y', -10)
            .attr('width', clipX + 2)
            .attr('height', ih + 20);

        // Grid (not clipped)
        const isLog = scaleType === 'log';
        g.append('g').attr('class', 'grid')
            .call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));

        // Axes (not clipped)
        const xDomain = [xMin, xMax];
        const xTicks = smartXTicks(xDomain, iw);
        const xAxisG = g.append('g').attr('class', 'axis')
            .attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickFormat(d3.format('d')));
        _fixAxisClip(xAxisG);
        const yAxis = isLog
            ? d3.axisLeft(yScale).ticks(6).tickFormat(d => fmt(d, 0))
            : d3.axisLeft(yScale).ticks(6).tickFormat(d => fmt(d, axisMode === 'pct_total' ? 1 : 0));
        g.append('g').attr('class', 'axis').call(yAxis);
        _addYLabel(g, _getUnitLabel(), ih, margin.left);

        // Clipped group for lines
        const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);

        // Lines
        const line = d3.line()
            .defined(d => d.value != null && (!isLog || d.value > 0))
            .x(d => xScale(d.year))
            .y(d => yScale(d.value));

        for (const s of series) {
            gClip.append('path')
                .datum(s.data)
                .attr('class', 'data-line')
                .attr('d', line)
                .attr('stroke', s.color);
        }

        // Historical average lines (dashed)
        if (State.get('showAverage') && !isLog) {
            for (const s of series) {
                const vals = s.data.filter(d => d.value != null).map(d => d.value);
                if (vals.length === 0) continue;
                const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                const yAvg = yScale(avg);
                gClip.append('line')
                    .attr('x1', 0).attr('x2', iw)
                    .attr('y1', yAvg).attr('y2', yAvg)
                    .attr('stroke', s.color)
                    .attr('stroke-width', 1)
                    .attr('stroke-dasharray', '4,3')
                    .attr('stroke-opacity', 0.5);
                gClip.append('text')
                    .attr('x', iw + 4).attr('y', yAvg + 3)
                    .attr('font-size', 9)
                    .attr('fill', s.color)
                    .attr('fill-opacity', 0.6)
                    .text(`x̄ ${fmt(avg, 1)}`);
            }
        }

        // Endpoint emphasis (OWID-style: larger dots at range start and end)
        const gEndpoints = g.append('g');
        for (const s of series) {
            const startPt = s.data.find(d => d.value != null);
            const endPt = [...s.data].reverse().find(d => d.value != null);
            for (const pt of [startPt, endPt]) {
                if (pt && pt.value != null) {
                    gEndpoints.append('circle')
                        .attr('cx', xScale(pt.year))
                        .attr('cy', yScale(pt.value))
                        .attr('r', 3.5)
                        .attr('fill', '#fff')
                        .attr('stroke', s.color)
                        .attr('stroke-width', 2);
                }
            }
        }

        // End dots + labels at current year position
        const gDots = g.append('g');
        const gLabels = g.append('g');
        const labelPositions = [];
        for (const s of series) {
            const pt = s.data.find(d => d.year === currentYear) ||
                       s.data.filter(d => d.year <= currentYear).pop();
            if (pt && pt.value != null) {
                const cx = xScale(pt.year);
                const cy = yScale(pt.value);
                gDots.append('circle')
                    .attr('cx', cx)
                    .attr('cy', cy)
                    .attr('r', 4)
                    .attr('fill', s.color)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5);
                labelPositions.push({ name: s.name, color: s.color, cx, cy });
            }
        }

        // Avoid overlapping labels — nudge vertically
        labelPositions.sort((a, b) => a.cy - b.cy);
        for (let i = 1; i < labelPositions.length; i++) {
            const prev = labelPositions[i - 1];
            const cur = labelPositions[i];
            if (cur.cy - prev.cy < 14) {
                cur.cy = prev.cy + 14;
            }
        }
        for (const lp of labelPositions) {
            gLabels.append('text')
                .attr('x', lp.cx + 8)
                .attr('y', lp.cy + 4)
                .attr('font-size', 11)
                .attr('font-weight', 600)
                .attr('fill', lp.color)
                .text(lp.name);
        }

        // Year marker line
        const yearLine = g.append('line')
            .attr('class', 'year-marker')
            .attr('y1', 0).attr('y2', ih)
            .attr('x1', clipX).attr('x2', clipX);

        // Store refs for efficient updates
        svg.node().__xScale = xScale;
        svg.node().__yScale = yScale;
        svg.node().__yearLine = yearLine;
        svg.node().__clipId = clipId;
        svg.node().__ih = ih;
        svg.node().__series = series;
        svg.node().__gDots = gDots;
        svg.node().__gLabels = gLabels;

        // Hover
        g.append('rect')
            .attr('width', iw).attr('height', ih)
            .attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                const _ind = State.get('activeIndicator');
                const _meta = DataLoader.getMeta();
                const _catId = State.get('activeCategory');
                let html = fmtTooltipContext(_meta, _catId, _ind, year);
                for (const s of series) {
                    const pt = s.data.find(d => d.year === year);
                    if (pt) {
                        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${s.color}">${s.name}</span><span class="tooltip-value">${fmtIndicator(pt.value, _ind)}</span></div>`;
                    }
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    /* ── Facet mode (small multiples) ── */
    function _renderFacet() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');

        // Explicit column count matching area-view layout
        const cols = selected.length === 1 ? 1 : selected.length <= 4 ? 2 : 3;
        facetGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        const indicator = State.get('activeIndicator');
        const axisMode = State.get('axisMode');

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios para ver facetas</div>';
            return;
        }

        const series = _buildSeries(selected, indicator, axisMode);
        const scaleType = State.get('scaleType');
        const facetYAxis = State.get('facetYAxis');

        // Clamp data to yearRange
        const [rangeStart, rangeEnd] = State.get('yearRange');
        for (const s of series) {
            s.data = s.data.filter(d => d.year >= rangeStart && d.year <= rangeEnd);
        }

        const allPoints = series.flatMap(s => s.data);
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const fxMin = dataYears.length > 0 ? Math.max(rangeStart, d3.min(dataYears)) : rangeStart;
        const fxMax = dataYears.length > 0 ? Math.min(rangeEnd, d3.max(dataYears)) : rangeEnd;
        const xDomain = [fxMin, fxMax];

        let html = '';
        for (let i = 0; i < series.length; i++) {
            html += `<div class="facet-cell" data-idx="${i}">
                <div class="facet-title">
                    <div class="facet-dot" style="background:${series[i].color}"></div>
                    ${series[i].name}
                </div>
                <svg class="facet-svg" id="facet-svg-${i}"></svg>
            </div>`;
        }
        const gen1 = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen1 !== _renderGen) return;
            const m = facetMargin;
            const currentYear = State.get('currentYear');
            const isLog = scaleType === 'log';

            for (let i = 0; i < series.length; i++) {
                const svg = d3.select(`#facet-svg-${i}`);
                const rect = svg.node().getBoundingClientRect();
                const w = rect.width;
                const h = rect.height;
                if (!w || !h) continue;

                const iw = w - m.left - m.right;
                const ih = h - m.top - m.bottom;

                const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
                const yScale = facetYAxis === 'auto'
                    ? _buildYScale(series[i].data, ih, scaleType)
                    : _buildYScale(allPoints, ih, scaleType);

                const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

                // Clip to current year
                const clipId = `facet-clip-${i}-${Date.now()}`;
                const clipX = xScale(currentYear);
                svg.append('defs').append('clipPath').attr('id', clipId)
                    .append('rect').attr('x', 0).attr('y', -5)
                    .attr('width', clipX + 2).attr('height', ih + 10);

                g.append('g').attr('class', 'grid')
                    .call(d3.axisLeft(yScale).ticks(4).tickSize(-iw).tickFormat(''));
                const fXTicks = smartXTicks(xDomain, iw, 50);
                const fXAxisG = g.append('g').attr('class', 'axis')
                    .attr('transform', `translate(0,${ih})`)
                    .call(d3.axisBottom(xScale).tickValues(fXTicks).tickFormat(d3.format('d')));
                _fixAxisClip(fXAxisG);
                g.append('g').attr('class', 'axis')
                    .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => fmt(d, 0)));
                if (i === 0) _addYLabel(g, _getUnitLabel(), ih, m.left);

                const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);

                const line = d3.line()
                    .defined(d => d.value != null && (!isLog || d.value > 0))
                    .x(d => xScale(d.year))
                    .y(d => yScale(d.value));

                gClip.append('path')
                    .datum(series[i].data)
                    .attr('class', 'data-line')
                    .attr('d', line)
                    .attr('stroke', series[i].color)
                    .attr('stroke-width', 2);

                // Year marker
                g.append('line')
                    .attr('class', 'year-marker')
                    .attr('x1', clipX).attr('x2', clipX)
                    .attr('y1', 0).attr('y2', ih);

                // Value label
                const pt = series[i].data.find(d => d.year === currentYear) ||
                           series[i].data.filter(d => d.year <= currentYear).pop();
                if (pt && pt.value != null) {
                    g.append('circle')
                        .attr('cx', xScale(pt.year))
                        .attr('cy', yScale(pt.value))
                        .attr('r', 3.5)
                        .attr('fill', series[i].color);
                    g.append('text')
                        .attr('x', xScale(pt.year) + 6)
                        .attr('y', yScale(pt.value) - 6)
                        .attr('font-size', 10)
                        .attr('font-weight', 700)
                        .attr('fill', series[i].color)
                        .text(fmt(pt.value, axisMode === 'pct_total' ? 1 : 0));
                }

                // Hover
                g.append('rect')
                    .attr('width', iw).attr('height', ih)
                    .attr('fill', 'transparent')
                    .on('mousemove', function (e) {
                        const [mx] = d3.pointer(e, this);
                        const yr = Math.round(xScale.invert(mx));
                        const p = series[i].data.find(d => d.year === yr);
                        if (p) {
                            const _ind = State.get('activeIndicator');
                            Tooltip.show(
                                `<div class="tooltip-title">${series[i].name}</div>` +
                                fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), _ind, yr) +
                                `<div class="tooltip-row"><span class="tooltip-label">${yr}</span><span class="tooltip-value">${fmtIndicator(p.value, _ind)}</span></div>`,
                                e.clientX, e.clientY
                            );
                        }
                    })
                    .on('mouseout', () => Tooltip.hide());
            }
        });
    }

    /* ── Sector facet mode (empleo: 3 sector lines per territory) ── */
    function _renderSectorFacets() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios</div>';
            return;
        }

        const activeInd = State.get('activeIndicator');
        const isPct = activeInd.startsWith('pct_');
        const fields = isPct ? SECTOR_FIELDS_PCT : SECTOR_FIELDS_N;

        // Build territory data with 3 sector series each
        const territories = [];
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const sectors = [];
            for (const field of fields) {
                const data = DataLoader.getTimeSeries(code, field);
                sectors.push({ field, label: SECTOR_LABELS[field], color: SECTOR_COLORS[field], data });
            }
            territories.push({ code, name: meta ? meta.name : code, color: territoryColor(i), sectors });
        }

        // Clamp sector data to yearRange
        const [rangeStart, rangeEnd] = State.get('yearRange');
        for (const t of territories) {
            for (const s of t.sectors) {
                s.data = s.data.filter(d => d.year >= rangeStart && d.year <= rangeEnd);
            }
        }

        const allPoints = territories.flatMap(t => t.sectors.flatMap(s => s.data));
        if (allPoints.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Sin datos sectoriales</div>';
            return;
        }
        const secDataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const sxMin = secDataYears.length > 0 ? Math.max(rangeStart, d3.min(secDataYears)) : rangeStart;
        const sxMax = secDataYears.length > 0 ? Math.min(rangeEnd, d3.max(secDataYears)) : rangeEnd;
        const xDomain = [sxMin, sxMax];
        const facetYAxis = State.get('facetYAxis');
        const globalYMax = isPct ? 105 : d3.max(allPoints, d => d.value) * 1.05;

        let html = '';
        for (let i = 0; i < territories.length; i++) {
            html += `<div class="facet-cell" data-idx="${i}">
                <div class="facet-title">
                    <div class="facet-dot" style="background:${territories[i].color}"></div>
                    ${territories[i].name}
                </div>
                <svg class="facet-svg" id="sector-facet-${i}"></svg>
            </div>`;
        }
        const gen2 = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen2 !== _renderGen) return;
            const m = facetMargin;
            const currentYear = State.get('currentYear');

            for (let i = 0; i < territories.length; i++) {
                const svg = d3.select(`#sector-facet-${i}`);
                const rect = svg.node().getBoundingClientRect();
                const w = rect.width, h = rect.height;
                if (!w || !h) continue;

                const iw = w - m.left - m.right;
                const ih = h - m.top - m.bottom;
                const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
                const cellYMax = (facetYAxis === 'auto' && !isPct)
                    ? d3.max(territories[i].sectors.flatMap(s => s.data).filter(d => d.value != null), d => d.value) * 1.05
                    : globalYMax;
                const yScale = d3.scaleLinear().domain([0, cellYMax || 1]).range([ih, 0]).nice();
                const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

                // Clip to current year
                const clipId = `sclip-${i}-${Date.now()}`;
                const clipX = xScale(currentYear);
                svg.append('defs').append('clipPath').attr('id', clipId)
                    .append('rect').attr('x', 0).attr('y', -5)
                    .attr('width', clipX + 2).attr('height', ih + 10);

                // Grid + axes
                g.append('g').attr('class', 'grid')
                    .call(d3.axisLeft(yScale).ticks(4).tickSize(-iw).tickFormat(''));
                const sXTicks = smartXTicks(xDomain, iw, 50);
                const sXAxisG = g.append('g').attr('class', 'axis')
                    .attr('transform', `translate(0,${ih})`)
                    .call(d3.axisBottom(xScale).tickValues(sXTicks).tickFormat(d3.format('d')));
                _fixAxisClip(sXAxisG);
                g.append('g').attr('class', 'axis')
                    .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => isPct ? d + '%' : fmt(d, 0)));

                const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);
                const line = d3.line().defined(d => d.value != null)
                    .x(d => xScale(d.year)).y(d => yScale(d.value));

                // Draw 3 sector lines
                for (const sector of territories[i].sectors) {
                    gClip.append('path')
                        .datum(sector.data)
                        .attr('class', 'data-line')
                        .attr('d', line)
                        .attr('stroke', sector.color)
                        .attr('stroke-width', 2);
                }

                // Year marker
                g.append('line').attr('class', 'year-marker')
                    .attr('x1', clipX).attr('x2', clipX)
                    .attr('y1', 0).attr('y2', ih);

                // End dots at current year
                const labelPositions = [];
                for (const sector of territories[i].sectors) {
                    const pt = sector.data.find(d => d.year === currentYear) ||
                               sector.data.filter(d => d.year <= currentYear).pop();
                    if (pt && pt.value != null) {
                        const cy = yScale(pt.value);
                        g.append('circle')
                            .attr('cx', xScale(pt.year)).attr('cy', cy)
                            .attr('r', 3).attr('fill', sector.color);
                        labelPositions.push({ label: sector.label, color: sector.color, cy });
                    }
                }

                // Legend (inside each cell, top-right)
                if (i === 0) {
                    const lg = g.append('g').attr('transform', `translate(${iw - 85}, 2)`);
                    fields.forEach((f, j) => {
                        lg.append('line')
                            .attr('x1', 0).attr('x2', 14)
                            .attr('y1', j * 13).attr('y2', j * 13)
                            .attr('stroke', SECTOR_COLORS[f]).attr('stroke-width', 2);
                        lg.append('text')
                            .attr('x', 18).attr('y', j * 13 + 3.5)
                            .attr('font-size', 9).attr('font-weight', 600)
                            .attr('fill', SECTOR_COLORS[f])
                            .text(SECTOR_LABELS[f]);
                    });
                }

                // Hover
                g.append('rect').attr('width', iw).attr('height', ih)
                    .attr('fill', 'transparent')
                    .on('mousemove', function (e) {
                        const [mx] = d3.pointer(e, this);
                        const yr = Math.round(xScale.invert(mx));
                        let tipHtml = `<div class="tooltip-title">${territories[i].name}</div>`;
                        tipHtml += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), yr);
                        for (const sector of territories[i].sectors) {
                            const pt = sector.data.find(d => d.year === yr);
                            if (pt) {
                                tipHtml += `<div class="tooltip-row">
                                    <span class="tooltip-label" style="color:${sector.color}">${sector.label}</span>
                                    <span class="tooltip-value">${isPct ? pt.value.toFixed(1) + '%' : fmt(pt.value) + ' personas'}</span>
                                </div>`;
                            }
                        }
                        Tooltip.show(tipHtml, e.clientX, e.clientY);
                    })
                    .on('mouseout', () => Tooltip.hide());
            }
        });
    }

    /* ── Rural/Urbano dual-line overlay ── */
    function _renderRuralOverlay() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = '';
        facetGrid.style.display = 'none';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const emptyEl = document.getElementById('line-empty');
        const visibleLines = State.get('ruralVisibleLines');
        const unit = State.get('ruralUnit');
        const isAbs = unit === 'abs';

        if (selected.length === 0) {
            d3.select('#line-svg').selectAll('*').remove();
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        const svg = d3.select('#line-svg');
        svg.selectAll('*').remove();
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const currentYear = State.get('currentYear');

        // Build dual series per territory (filtered by visibility)
        const allLines = [];
        for (let si = 0; si < selected.length; si++) {
            const code = selected[si];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;
            const color = territoryColor(si);
            const raw = DataLoader.getTimeSeries(code, indicator)
                .filter(d => d.year >= rangeStart && d.year <= rangeEnd);

            let popMap = null;
            if (isAbs) {
                popMap = {};
                DataLoader.getTimeSeries(code, 'habitantes')
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd)
                    .forEach(d => { popMap[d.year] = d.value; });
            }

            if (visibleLines.includes('rural')) {
                const ruralData = raw.map(d => {
                    if (isAbs && d.value != null && popMap && popMap[d.year] != null)
                        return { year: d.year, value: d.value * popMap[d.year] / 100 };
                    return { year: d.year, value: d.value };
                });
                allLines.push({ name: `${name} — Rural`, color, data: ruralData, dash: null, territory: name, type: 'rural' });
            }
            if (visibleLines.includes('urbano')) {
                const urbanoData = raw.map(d => {
                    const pct = d.value != null ? 100 - d.value : null;
                    if (isAbs && pct != null && popMap && popMap[d.year] != null)
                        return { year: d.year, value: pct * popMap[d.year] / 100 };
                    return { year: d.year, value: pct };
                });
                allLines.push({ name: `${name} — Urbano`, color, data: urbanoData, dash: '6,3', territory: name, type: 'urbano' });
            }
        }

        const allPoints = allLines.flatMap(s => s.data);
        if (allPoints.length === 0) {
            emptyEl.style.display = 'flex';
            return;
        }
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const xMin = dataYears.length > 0 ? d3.min(dataYears) : rangeStart;
        const xMax = dataYears.length > 0 ? d3.max(dataYears) : rangeEnd;
        const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, iw]);

        const yMax = isAbs ? d3.max(allPoints.filter(d => d.value != null), d => d.value) * 1.05 : 105;
        const yScale = d3.scaleLinear().domain([0, yMax || 105]).range([ih, 0]);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // Clip-path
        const clipId = 'rural-clip-' + Date.now();
        const clipX = xScale(currentYear);
        svg.append('defs').append('clipPath').attr('id', clipId)
            .append('rect').attr('x', 0).attr('y', -10).attr('width', clipX + 2).attr('height', ih + 20);

        // Grid + axes
        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const xTicks = smartXTicks([xMin, xMax], iw);
        const xAxisG = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickFormat(d3.format('d')));
        _fixAxisClip(xAxisG);
        const yFmt = isAbs ? d => fmt(d, 0) : d => d + '%';
        g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(6).tickFormat(yFmt));
        _addYLabel(g, isAbs ? 'personas' : '%', ih, margin.left);

        const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);

        const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

        for (const s of allLines) {
            const path = gClip.append('path').datum(s.data).attr('class', 'data-line')
                .attr('d', line).attr('stroke', s.color).attr('stroke-width', 2);
            if (s.dash) path.attr('stroke-dasharray', s.dash);
        }

        // End labels — one per territory (not per line type)
        const gLabels = g.append('g');
        const labelPositions = [];
        const labelledTerritories = new Set();
        for (const s of allLines) {
            if (labelledTerritories.has(s.territory)) continue;
            const pt = s.data.find(d => d.year === currentYear) ||
                       s.data.filter(d => d.year <= currentYear).pop();
            if (pt && pt.value != null) {
                labelledTerritories.add(s.territory);
                labelPositions.push({ name: s.territory, color: s.color, cy: yScale(pt.value), cx: xScale(pt.year) });
            }
        }
        labelPositions.sort((a, b) => a.cy - b.cy);
        for (let i = 1; i < labelPositions.length; i++) {
            if (labelPositions[i].cy - labelPositions[i - 1].cy < 14)
                labelPositions[i].cy = labelPositions[i - 1].cy + 14;
        }
        for (const lp of labelPositions) {
            gLabels.append('text').attr('x', lp.cx + 8).attr('y', lp.cy + 4)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', lp.color).text(lp.name);
        }

        // Year marker
        g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih).attr('x1', clipX).attr('x2', clipX);

        // Legend: solid = Rural, dashed = Urbano (prominent, top-right)
        const legendItems = [];
        if (visibleLines.includes('rural')) legendItems.push({ key: 'rural', dash: null });
        if (visibleLines.includes('urbano')) legendItems.push({ key: 'urbano', dash: '6,3' });
        if (legendItems.length > 0) {
            const lgW = legendItems.length * 80;
            const lg = g.append('g').attr('transform', `translate(${iw - lgW}, -6)`);
            // Background rect for readability
            lg.append('rect').attr('x', -6).attr('y', -10).attr('width', lgW + 8).attr('height', 22)
                .attr('fill', '#fff').attr('fill-opacity', 0.85).attr('rx', 3);
            legendItems.forEach((item, idx) => {
                const x0 = idx * 80;
                lg.append('line').attr('x1', x0).attr('x2', x0 + 20).attr('y1', 0).attr('y2', 0)
                    .attr('stroke', RURAL_COLORS[item.key]).attr('stroke-width', 2.5)
                    .attr('stroke-dasharray', item.dash);
                lg.append('text').attr('x', x0 + 24).attr('y', 4).attr('font-size', 11).attr('font-weight', 700)
                    .attr('fill', RURAL_COLORS[item.key]).text(RURAL_LABELS[item.key]);
            });
        }

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                let html = fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                for (const s of allLines) {
                    const pt = s.data.find(d => d.year === year);
                    if (pt && pt.value != null) {
                        const valStr = isAbs ? fmt(pt.value, 0) + ' personas' : pt.value.toFixed(1) + '%';
                        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${s.color}">${s.name}</span><span class="tooltip-value">${valStr}</span></div>`;
                    }
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    /* ── Rural/Urbano dual-line facet ── */
    function _renderRuralFacet() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const visibleLines = State.get('ruralVisibleLines');
        const unit = State.get('ruralUnit');
        const isAbs = unit === 'abs';

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios</div>';
            return;
        }

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const territories = [];
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const raw = DataLoader.getTimeSeries(code, indicator).filter(d => d.year >= rangeStart && d.year <= rangeEnd);

            let popMap = null;
            if (isAbs) {
                popMap = {};
                DataLoader.getTimeSeries(code, 'habitantes')
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd)
                    .forEach(d => { popMap[d.year] = d.value; });
            }

            const rural = !visibleLines.includes('rural') ? [] : raw.map(d => {
                if (isAbs && d.value != null && popMap && popMap[d.year] != null)
                    return { year: d.year, value: d.value * popMap[d.year] / 100 };
                return { year: d.year, value: d.value };
            });
            const urbano = !visibleLines.includes('urbano') ? [] : raw.map(d => {
                const pct = d.value != null ? 100 - d.value : null;
                if (isAbs && pct != null && popMap && popMap[d.year] != null)
                    return { year: d.year, value: pct * popMap[d.year] / 100 };
                return { year: d.year, value: pct };
            });

            territories.push({
                code, name: meta ? meta.name : code, color: territoryColor(i),
                rural, urbano,
            });
        }

        const allPoints = territories.flatMap(t => [...t.rural, ...t.urbano]);
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const fxMin = dataYears.length > 0 ? d3.min(dataYears) : rangeStart;
        const fxMax = dataYears.length > 0 ? d3.max(dataYears) : rangeEnd;
        const xDomain = [fxMin, fxMax];
        const facetYAxis = State.get('facetYAxis');
        const globalYMax = isAbs ? d3.max(allPoints.filter(d => d.value != null), d => d.value) * 1.05 : 105;

        let html = '';
        for (let i = 0; i < territories.length; i++) {
            html += `<div class="facet-cell" data-idx="${i}">
                <div class="facet-title"><div class="facet-dot" style="background:${territories[i].color}"></div>${territories[i].name}</div>
                <svg class="facet-svg" id="rural-facet-${i}"></svg></div>`;
        }
        const gen = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen !== _renderGen) return; // stale render, skip
            const m = facetMargin;
            const currentYear = State.get('currentYear');

            for (let i = 0; i < territories.length; i++) {
                const svg = d3.select(`#rural-facet-${i}`);
                const rect = svg.node().getBoundingClientRect();
                const w = rect.width, h = rect.height;
                if (!w || !h) continue;

                const iw = w - m.left - m.right;
                const ih = h - m.top - m.bottom;
                const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
                const cellYMax = (facetYAxis === 'auto' && isAbs)
                    ? d3.max([...territories[i].rural, ...territories[i].urbano].filter(d => d.value != null), d => d.value) * 1.05
                    : globalYMax;
                const yScale = d3.scaleLinear().domain([0, cellYMax || 105]).range([ih, 0]);
                const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

                const clipId = `rclip-${i}-${Date.now()}`;
                const clipX = xScale(currentYear);
                svg.append('defs').append('clipPath').attr('id', clipId)
                    .append('rect').attr('x', 0).attr('y', -5).attr('width', clipX + 2).attr('height', ih + 10);

                g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(4).tickSize(-iw).tickFormat(''));
                const fXTicks = smartXTicks(xDomain, iw, 50);
                const fXAxisG = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                    .call(d3.axisBottom(xScale).tickValues(fXTicks).tickFormat(d3.format('d')));
                _fixAxisClip(fXAxisG);
                const yFmt = isAbs ? d => fmt(d, 0) : d => d + '%';
                g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(4).tickFormat(yFmt));

                const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);
                const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

                if (territories[i].rural.length > 0)
                    gClip.append('path').datum(territories[i].rural).attr('class', 'data-line').attr('d', line)
                        .attr('stroke', RURAL_COLORS.rural).attr('stroke-width', 2);
                if (territories[i].urbano.length > 0)
                    gClip.append('path').datum(territories[i].urbano).attr('class', 'data-line').attr('d', line)
                        .attr('stroke', RURAL_COLORS.urbano).attr('stroke-width', 2).attr('stroke-dasharray', '6,3');

                g.append('line').attr('class', 'year-marker').attr('x1', clipX).attr('x2', clipX).attr('y1', 0).attr('y2', ih);

                // Legend in first cell
                if (i === 0) {
                    const items = [];
                    if (visibleLines.includes('rural')) items.push({ key: 'rural', dash: null });
                    if (visibleLines.includes('urbano')) items.push({ key: 'urbano', dash: '6,3' });
                    if (items.length > 0) {
                        const lg = g.append('g').attr('transform', `translate(${iw - items.length * 65 - 10}, 2)`);
                        items.forEach((item, idx) => {
                            const x0 = idx * 65;
                            lg.append('line').attr('x1', x0).attr('x2', x0 + 16).attr('y1', 0).attr('y2', 0)
                                .attr('stroke', RURAL_COLORS[item.key]).attr('stroke-width', 2)
                                .attr('stroke-dasharray', item.dash);
                            lg.append('text').attr('x', x0 + 20).attr('y', 4).attr('font-size', 10).attr('font-weight', 600)
                                .attr('fill', RURAL_COLORS[item.key]).text(RURAL_LABELS[item.key]);
                        });
                    }
                }

                // Hover
                g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                    .on('mousemove', function (e) {
                        const [mx] = d3.pointer(e, this);
                        const yr = Math.round(xScale.invert(mx));
                        const rPt = territories[i].rural.find(d => d.year === yr);
                        const uPt = territories[i].urbano.find(d => d.year === yr);
                        let tip = `<div class="tooltip-title">${territories[i].name}</div>`;
                        tip += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), yr);
                        if (rPt && rPt.value != null) {
                            const v = isAbs ? fmt(rPt.value, 0) + ' personas' : rPt.value.toFixed(1) + '%';
                            tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${RURAL_COLORS.rural}">Rural</span><span class="tooltip-value">${v}</span></div>`;
                        }
                        if (uPt && uPt.value != null) {
                            const v = isAbs ? fmt(uPt.value, 0) + ' personas' : uPt.value.toFixed(1) + '%';
                            tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${RURAL_COLORS.urbano}">Urbano</span><span class="tooltip-value">${v}</span></div>`;
                        }
                        Tooltip.show(tip, e.clientX, e.clientY);
                    })
                    .on('mouseout', () => Tooltip.hide());
            }
        });
    }

    /* ── Dispersion dual-line overlay ── */
    function _renderDispersionOverlay() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = '';
        facetGrid.style.display = 'none';

        const selected = State.get('selectedTerritories');
        const emptyEl = document.getElementById('line-empty');
        const visibleLines = State.get('dispersionVisibleLines');
        const unit = State.get('dispersionUnit');
        const isAbs = unit === 'abs';

        if (selected.length === 0) {
            d3.select('#line-svg').selectAll('*').remove();
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        const svg = d3.select('#line-svg');
        svg.selectAll('*').remove();
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const currentYear = State.get('currentYear');

        const dispInd = isAbs ? 'pob_dispersa' : 'pct_dispersion';
        const agrInd = isAbs ? 'pob_agrupada' : 'pct_agrupada';

        const allLines = [];
        for (let si = 0; si < selected.length; si++) {
            const code = selected[si];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;
            const color = territoryColor(si);

            if (visibleLines.includes('dispersa')) {
                const data = DataLoader.getTimeSeries(code, dispInd)
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd);
                allLines.push({ name: `${name} — Dispersa`, color, data, dash: null, territory: name, type: 'dispersa' });
            }
            if (visibleLines.includes('agrupada')) {
                const data = DataLoader.getTimeSeries(code, agrInd)
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd);
                allLines.push({ name: `${name} — Agrupada`, color, data, dash: '6,3', territory: name, type: 'agrupada' });
            }
        }

        const allPoints = allLines.flatMap(s => s.data);
        if (allPoints.length === 0) { emptyEl.style.display = 'flex'; return; }
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const xMin = dataYears.length > 0 ? d3.min(dataYears) : rangeStart;
        const xMax = dataYears.length > 0 ? d3.max(dataYears) : rangeEnd;
        const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, iw]);

        const yMax = isAbs ? d3.max(allPoints.filter(d => d.value != null), d => d.value) * 1.05 : 105;
        const yScale = d3.scaleLinear().domain([0, yMax || 105]).range([ih, 0]);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const clipId = 'disp-clip-' + Date.now();
        const clipX = xScale(currentYear);
        svg.append('defs').append('clipPath').attr('id', clipId)
            .append('rect').attr('x', 0).attr('y', -10).attr('width', clipX + 2).attr('height', ih + 20);

        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const xTicks = smartXTicks([xMin, xMax], iw);
        const xAxisG = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickFormat(d3.format('d')));
        _fixAxisClip(xAxisG);
        const yFmt = isAbs ? d => fmt(d, 0) : d => d + '%';
        g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(6).tickFormat(yFmt));
        _addYLabel(g, isAbs ? 'personas' : '%', ih, margin.left);

        const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);
        const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

        for (const s of allLines) {
            const path = gClip.append('path').datum(s.data).attr('class', 'data-line')
                .attr('d', line).attr('stroke', s.color).attr('stroke-width', 2);
            if (s.dash) path.attr('stroke-dasharray', s.dash);
        }

        // End labels
        const gLabels = g.append('g');
        const labelPositions = [];
        const labelledTerritories = new Set();
        for (const s of allLines) {
            if (labelledTerritories.has(s.territory)) continue;
            const pt = s.data.find(d => d.year === currentYear) ||
                       s.data.filter(d => d.year <= currentYear).pop();
            if (pt && pt.value != null) {
                labelledTerritories.add(s.territory);
                labelPositions.push({ name: s.territory, color: s.color, cy: yScale(pt.value), cx: xScale(pt.year) });
            }
        }
        labelPositions.sort((a, b) => a.cy - b.cy);
        for (let i = 1; i < labelPositions.length; i++) {
            if (labelPositions[i].cy - labelPositions[i - 1].cy < 14)
                labelPositions[i].cy = labelPositions[i - 1].cy + 14;
        }
        for (const lp of labelPositions) {
            gLabels.append('text').attr('x', lp.cx + 8).attr('y', lp.cy + 4)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', lp.color).text(lp.name);
        }

        g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih).attr('x1', clipX).attr('x2', clipX);

        // Legend
        const legendItems = [];
        if (visibleLines.includes('dispersa')) legendItems.push({ key: 'dispersa', dash: null });
        if (visibleLines.includes('agrupada')) legendItems.push({ key: 'agrupada', dash: '6,3' });
        if (legendItems.length > 0) {
            const lgW = legendItems.length * 85;
            const lg = g.append('g').attr('transform', `translate(${iw - lgW}, -6)`);
            lg.append('rect').attr('x', -6).attr('y', -10).attr('width', lgW + 8).attr('height', 22)
                .attr('fill', '#fff').attr('fill-opacity', 0.85).attr('rx', 3);
            legendItems.forEach((item, idx) => {
                const x0 = idx * 85;
                lg.append('line').attr('x1', x0).attr('x2', x0 + 20).attr('y1', 0).attr('y2', 0)
                    .attr('stroke', DISPERSION_COLORS[item.key]).attr('stroke-width', 2.5)
                    .attr('stroke-dasharray', item.dash);
                lg.append('text').attr('x', x0 + 24).attr('y', 4).attr('font-size', 11).attr('font-weight', 700)
                    .attr('fill', DISPERSION_COLORS[item.key]).text(DISPERSION_LABELS[item.key]);
            });
        }

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                let html = fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                for (const s of allLines) {
                    const pt = s.data.find(d => d.year === year);
                    if (pt && pt.value != null) {
                        const valStr = isAbs ? fmt(pt.value, 0) + ' personas' : pt.value.toFixed(1) + '%';
                        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${s.color}">${s.name}</span><span class="tooltip-value">${valStr}</span></div>`;
                    }
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    /* ── Dispersion dual-line facet ── */
    function _renderDispersionFacet() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const visibleLines = State.get('dispersionVisibleLines');
        const unit = State.get('dispersionUnit');
        const isAbs = unit === 'abs';

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios</div>';
            return;
        }

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const dispInd = isAbs ? 'pob_dispersa' : 'pct_dispersion';
        const agrInd = isAbs ? 'pob_agrupada' : 'pct_agrupada';

        const territories = [];
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const dispersa = !visibleLines.includes('dispersa') ? [] :
                DataLoader.getTimeSeries(code, dispInd).filter(d => d.year >= rangeStart && d.year <= rangeEnd);
            const agrupada = !visibleLines.includes('agrupada') ? [] :
                DataLoader.getTimeSeries(code, agrInd).filter(d => d.year >= rangeStart && d.year <= rangeEnd);
            territories.push({ code, name: meta ? meta.name : code, color: territoryColor(i), dispersa, agrupada });
        }

        const allPoints = territories.flatMap(t => [...t.dispersa, ...t.agrupada]);
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const fxMin = dataYears.length > 0 ? d3.min(dataYears) : rangeStart;
        const fxMax = dataYears.length > 0 ? d3.max(dataYears) : rangeEnd;
        const xDomain = [fxMin, fxMax];
        const facetYAxis = State.get('facetYAxis');
        const globalYMax = isAbs ? d3.max(allPoints.filter(d => d.value != null), d => d.value) * 1.05 : 105;

        const cols = selected.length === 1 ? 1 : selected.length <= 4 ? 2 : 3;
        facetGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        let html = '';
        for (let i = 0; i < territories.length; i++) {
            html += `<div class="facet-cell" data-idx="${i}">
                <div class="facet-title"><div class="facet-dot" style="background:${territories[i].color}"></div>${territories[i].name}</div>
                <svg class="facet-svg" id="disp-facet-${i}"></svg></div>`;
        }
        const gen = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen !== _renderGen) return;
            const m = facetMargin;
            const currentYear = State.get('currentYear');

            for (let i = 0; i < territories.length; i++) {
                const svg = d3.select(`#disp-facet-${i}`);
                const rect = svg.node().getBoundingClientRect();
                const w = rect.width, h = rect.height;
                if (!w || !h) continue;

                const iw = w - m.left - m.right;
                const ih = h - m.top - m.bottom;
                const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
                const cellYMax = (facetYAxis === 'auto' && isAbs)
                    ? d3.max([...territories[i].dispersa, ...territories[i].agrupada].filter(d => d.value != null), d => d.value) * 1.05
                    : globalYMax;
                const yScale = d3.scaleLinear().domain([0, cellYMax || 105]).range([ih, 0]);
                const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

                const clipId = `dclip-${i}-${Date.now()}`;
                const clipX = xScale(currentYear);
                svg.append('defs').append('clipPath').attr('id', clipId)
                    .append('rect').attr('x', 0).attr('y', -5).attr('width', clipX + 2).attr('height', ih + 10);

                g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(4).tickSize(-iw).tickFormat(''));
                const fXTicks = smartXTicks(xDomain, iw, 50);
                const fXAxisG = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                    .call(d3.axisBottom(xScale).tickValues(fXTicks).tickFormat(d3.format('d')));
                _fixAxisClip(fXAxisG);
                const yFmt = isAbs ? d => fmt(d, 0) : d => d + '%';
                g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(4).tickFormat(yFmt));

                const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);
                const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

                if (territories[i].dispersa.length > 0)
                    gClip.append('path').datum(territories[i].dispersa).attr('class', 'data-line').attr('d', line)
                        .attr('stroke', DISPERSION_COLORS.dispersa).attr('stroke-width', 2);
                if (territories[i].agrupada.length > 0)
                    gClip.append('path').datum(territories[i].agrupada).attr('class', 'data-line').attr('d', line)
                        .attr('stroke', DISPERSION_COLORS.agrupada).attr('stroke-width', 2).attr('stroke-dasharray', '6,3');

                g.append('line').attr('class', 'year-marker').attr('x1', clipX).attr('x2', clipX).attr('y1', 0).attr('y2', ih);

                // Legend in first cell
                if (i === 0) {
                    const items = [];
                    if (visibleLines.includes('dispersa')) items.push({ key: 'dispersa', dash: null });
                    if (visibleLines.includes('agrupada')) items.push({ key: 'agrupada', dash: '6,3' });
                    if (items.length > 0) {
                        const lg = g.append('g').attr('transform', `translate(${iw - items.length * 70 - 10}, 2)`);
                        items.forEach((item, idx) => {
                            const x0 = idx * 70;
                            lg.append('line').attr('x1', x0).attr('x2', x0 + 16).attr('y1', 0).attr('y2', 0)
                                .attr('stroke', DISPERSION_COLORS[item.key]).attr('stroke-width', 2)
                                .attr('stroke-dasharray', item.dash);
                            lg.append('text').attr('x', x0 + 20).attr('y', 4).attr('font-size', 10).attr('font-weight', 600)
                                .attr('fill', DISPERSION_COLORS[item.key]).text(DISPERSION_LABELS[item.key]);
                        });
                    }
                }

                // Hover
                g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                    .on('mousemove', function (e) {
                        const [mx] = d3.pointer(e, this);
                        const yr = Math.round(xScale.invert(mx));
                        const dPt = territories[i].dispersa.find(d => d.year === yr);
                        const aPt = territories[i].agrupada.find(d => d.year === yr);
                        let tip = `<div class="tooltip-title">${territories[i].name}</div>`;
                        tip += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), yr);
                        if (dPt && dPt.value != null) {
                            const v = isAbs ? fmt(dPt.value, 0) + ' personas' : dPt.value.toFixed(1) + '%';
                            tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${DISPERSION_COLORS.dispersa}">Dispersa</span><span class="tooltip-value">${v}</span></div>`;
                        }
                        if (aPt && aPt.value != null) {
                            const v = isAbs ? fmt(aPt.value, 0) + ' personas' : aPt.value.toFixed(1) + '%';
                            tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${DISPERSION_COLORS.agrupada}">Agrupada</span><span class="tooltip-value">${v}</span></div>`;
                        }
                        Tooltip.show(tip, e.clientX, e.clientY);
                    })
                    .on('mouseout', () => Tooltip.hide());
            }
        });
    }

    /* ── Habitat percentage lines overlay (aggregate levels) ── */
    function _renderHabitatLinesOverlay() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = '';
        facetGrid.style.display = 'none';

        const selected = State.get('selectedTerritories');
        const emptyEl = document.getElementById('line-empty');
        const visibleLines = State.get('habitatVisibleLines');
        const unit = State.get('habitatUnit');
        const isAbs = unit === 'abs';
        const activeFields = HAB_DATA_FIELDS.filter(f => visibleLines.includes(f));

        if (selected.length === 0) {
            d3.select('#line-svg').selectAll('*').remove();
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        const svg = d3.select('#line-svg');
        svg.selectAll('*').remove();
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const currentYear = State.get('currentYear');

        // Build lines per territory (only visible fields)
        const allLines = [];
        for (let si = 0; si < selected.length; si++) {
            const code = selected[si];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;

            let popMap = null;
            if (isAbs) {
                popMap = {};
                DataLoader.getTimeSeries(code, 'habitantes')
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd)
                    .forEach(d => { popMap[d.year] = d.value; });
            }

            for (const field of activeFields) {
                const raw = DataLoader.getTimeSeries(code, field)
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd);
                const data = raw.map(d => {
                    if (isAbs && d.value != null && popMap && popMap[d.year] != null)
                        return { year: d.year, value: d.value * popMap[d.year] / 100 };
                    return { year: d.year, value: d.value };
                });
                const suffix = selected.length > 1 ? ` (${name})` : '';
                allLines.push({
                    name: HAB_LABELS[field] + suffix,
                    color: HAB_COLORS[field],
                    data,
                    territory: name,
                    field,
                    dash: selected.length > 1 && si > 0 ? '4,2' : null,
                });
            }
        }

        const allPoints = allLines.flatMap(s => s.data);
        if (allPoints.length === 0) {
            emptyEl.style.display = 'flex';
            return;
        }
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const xMin = dataYears.length > 0 ? d3.min(dataYears) : rangeStart;
        const xMax = dataYears.length > 0 ? d3.max(dataYears) : rangeEnd;
        const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, iw]);

        const yMax = isAbs ? d3.max(allPoints.filter(d => d.value != null), d => d.value) * 1.05 : 105;
        const yScale = d3.scaleLinear().domain([0, yMax || 105]).range([ih, 0]);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const clipId = 'hab-clip-' + Date.now();
        const clipX = xScale(currentYear);
        svg.append('defs').append('clipPath').attr('id', clipId)
            .append('rect').attr('x', 0).attr('y', -10).attr('width', clipX + 2).attr('height', ih + 20);

        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const xTicks = smartXTicks([xMin, xMax], iw);
        const xAxisG = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(xTicks).tickFormat(d3.format('d')));
        _fixAxisClip(xAxisG);
        const yFmt = isAbs ? d => fmt(d, 0) : d => d + '%';
        g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(6).tickFormat(yFmt));
        _addYLabel(g, isAbs ? 'personas' : '%', ih, margin.left);

        const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);
        const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

        for (const s of allLines) {
            const path = gClip.append('path').datum(s.data).attr('class', 'data-line')
                .attr('d', line).attr('stroke', s.color).attr('stroke-width', 2);
            if (s.dash) path.attr('stroke-dasharray', s.dash);
        }

        // End labels
        const gLabels = g.append('g');
        const labelPositions = [];
        for (const s of allLines) {
            const pt = s.data.find(d => d.year === currentYear) ||
                       s.data.filter(d => d.year <= currentYear).pop();
            if (pt && pt.value != null) {
                labelPositions.push({ name: s.name, color: s.color, cy: yScale(pt.value), cx: xScale(pt.year) });
            }
        }
        labelPositions.sort((a, b) => a.cy - b.cy);
        for (let i = 1; i < labelPositions.length; i++) {
            if (labelPositions[i].cy - labelPositions[i - 1].cy < 14)
                labelPositions[i].cy = labelPositions[i - 1].cy + 14;
        }
        for (const lp of labelPositions) {
            gLabels.append('text').attr('x', lp.cx + 8).attr('y', lp.cy + 4)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', lp.color).text(lp.name);
        }

        g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih).attr('x1', clipX).attr('x2', clipX);

        // Legend: only visible habitat types
        if (activeFields.length > 0) {
            const lg = g.append('g').attr('transform', `translate(${iw - activeFields.length * 70}, 2)`);
            activeFields.forEach((field, i) => {
                const x0 = i * 70;
                lg.append('line').attr('x1', x0).attr('x2', x0 + 14).attr('y1', 0).attr('y2', 0)
                    .attr('stroke', HAB_COLORS[field]).attr('stroke-width', 2);
                lg.append('text').attr('x', x0 + 18).attr('y', 4).attr('font-size', 9).attr('font-weight', 600)
                    .attr('fill', HAB_COLORS[field]).text(HAB_LABELS[field]);
            });
        }

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                let html = fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                for (const s of allLines) {
                    const pt = s.data.find(d => d.year === year);
                    if (pt && pt.value != null) {
                        const valStr = isAbs ? fmt(pt.value, 0) + ' personas' : pt.value.toFixed(1) + '%';
                        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${s.color}">${s.name}</span><span class="tooltip-value">${valStr}</span></div>`;
                    }
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    /* ── Habitat percentage lines facet (aggregate levels) ── */
    function _renderHabitatLinesFacet() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const visibleLines = State.get('habitatVisibleLines');
        const unit = State.get('habitatUnit');
        const isAbs = unit === 'abs';
        const activeFields = HAB_DATA_FIELDS.filter(f => visibleLines.includes(f));

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios</div>';
            return;
        }

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const territories = [];
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);

            let popMap = null;
            if (isAbs) {
                popMap = {};
                DataLoader.getTimeSeries(code, 'habitantes')
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd)
                    .forEach(d => { popMap[d.year] = d.value; });
            }

            const habSeries = {};
            for (const field of activeFields) {
                const raw = DataLoader.getTimeSeries(code, field)
                    .filter(d => d.year >= rangeStart && d.year <= rangeEnd);
                habSeries[field] = raw.map(d => {
                    if (isAbs && d.value != null && popMap && popMap[d.year] != null)
                        return { year: d.year, value: d.value * popMap[d.year] / 100 };
                    return { year: d.year, value: d.value };
                });
            }
            territories.push({ code, name: meta ? meta.name : code, color: territoryColor(i), habSeries });
        }

        const allPoints = territories.flatMap(t => activeFields.flatMap(f => t.habSeries[f] || []));
        const dataYears = allPoints.filter(d => d.value != null).map(d => d.year);
        const fxMin = dataYears.length > 0 ? d3.min(dataYears) : rangeStart;
        const fxMax = dataYears.length > 0 ? d3.max(dataYears) : rangeEnd;
        const xDomain = [fxMin, fxMax];
        const facetYAxis = State.get('facetYAxis');
        const globalYMax = isAbs ? d3.max(allPoints.filter(d => d.value != null), d => d.value) * 1.05 : 105;

        let html = '';
        for (let i = 0; i < territories.length; i++) {
            html += `<div class="facet-cell" data-idx="${i}">
                <div class="facet-title"><div class="facet-dot" style="background:${territories[i].color}"></div>${territories[i].name}</div>
                <svg class="facet-svg" id="hab-facet-${i}"></svg></div>`;
        }
        const gen3 = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen3 !== _renderGen) return;
            const m = facetMargin;
            const currentYear = State.get('currentYear');

            for (let i = 0; i < territories.length; i++) {
                const svg = d3.select(`#hab-facet-${i}`);
                const rect = svg.node().getBoundingClientRect();
                const w = rect.width, h = rect.height;
                if (!w || !h) continue;

                const iw = w - m.left - m.right;
                const ih = h - m.top - m.bottom;
                const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
                const cellYMax = (facetYAxis === 'auto' && isAbs)
                    ? d3.max(activeFields.flatMap(f => territories[i].habSeries[f] || []).filter(d => d.value != null), d => d.value) * 1.05
                    : globalYMax;
                const yScale = d3.scaleLinear().domain([0, cellYMax || 105]).range([ih, 0]);
                const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

                const clipId = `hclip-${i}-${Date.now()}`;
                const clipX = xScale(currentYear);
                svg.append('defs').append('clipPath').attr('id', clipId)
                    .append('rect').attr('x', 0).attr('y', -5).attr('width', clipX + 2).attr('height', ih + 10);

                g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(4).tickSize(-iw).tickFormat(''));
                const fXTicks = smartXTicks(xDomain, iw, 50);
                const fXAxisG = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                    .call(d3.axisBottom(xScale).tickValues(fXTicks).tickFormat(d3.format('d')));
                _fixAxisClip(fXAxisG);
                const yFmt = isAbs ? d => fmt(d, 0) : d => d + '%';
                g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(4).tickFormat(yFmt));

                const gClip = g.append('g').attr('clip-path', `url(#${clipId})`);
                const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

                for (const field of activeFields) {
                    if (territories[i].habSeries[field])
                        gClip.append('path').datum(territories[i].habSeries[field]).attr('class', 'data-line')
                            .attr('d', line).attr('stroke', HAB_COLORS[field]).attr('stroke-width', 2);
                }

                g.append('line').attr('class', 'year-marker').attr('x1', clipX).attr('x2', clipX).attr('y1', 0).attr('y2', ih);

                // Legend in first cell
                if (i === 0 && activeFields.length > 0) {
                    const lg = g.append('g').attr('transform', `translate(${iw - activeFields.length * 70}, 2)`);
                    activeFields.forEach((field, j) => {
                        const x0 = j * 70;
                        lg.append('line').attr('x1', x0).attr('x2', x0 + 14).attr('y1', 0).attr('y2', 0)
                            .attr('stroke', HAB_COLORS[field]).attr('stroke-width', 2);
                        lg.append('text').attr('x', x0 + 18).attr('y', 4).attr('font-size', 10).attr('font-weight', 600)
                            .attr('fill', HAB_COLORS[field]).text(HAB_LABELS[field]);
                    });
                }

                // Hover
                g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                    .on('mousemove', function (e) {
                        const [mx] = d3.pointer(e, this);
                        const yr = Math.round(xScale.invert(mx));
                        let tip = `<div class="tooltip-title">${territories[i].name}</div>`;
                        tip += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), yr);
                        for (const field of activeFields) {
                            const pt = (territories[i].habSeries[field] || []).find(d => d.year === yr);
                            if (pt && pt.value != null) {
                                const valStr = isAbs ? fmt(pt.value, 0) + ' personas' : pt.value.toFixed(1) + '%';
                                tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${HAB_COLORS[field]}">${HAB_LABELS[field]}</span><span class="tooltip-value">${valStr}</span></div>`;
                            }
                        }
                        Tooltip.show(tip, e.clientX, e.clientY);
                    })
                    .on('mouseout', () => Tooltip.hide());
            }
        });
    }

    /* ── Timeline strips for Rural/Urbano at municipio level ── */
    function _renderRuralStripsOverlay() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const currentYear = State.get('currentYear');

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más municipios para ver franjas rural/urbano</div>';
            return;
        }

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const years = DataLoader.getYears().filter(y => y >= rangeStart && y <= rangeEnd);
        if (years.length === 0) { facetGrid.innerHTML = ''; return; }
        const minYear = years[0];
        const maxYear = years[years.length - 1];

        const ruralColor = RURAL_COLORS.rural;
        const urbanoColor = RURAL_COLORS.urbano;
        const nullColor = '#e0e0e0';

        const gridRect = facetGrid.getBoundingClientRect();
        const legendH = 36;
        const axisH = 22;
        const availH = (gridRect.height || window.innerHeight * 0.6) - legendH - axisH;
        const rowH = Math.max(28, Math.min(60, Math.floor(availH / selected.length)));

        let html = '<div class="strip-container">';
        html += '<div class="strip-legend">';
        html += `<span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${ruralColor}"></span>Rural</span>`;
        html += `<span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${urbanoColor}"></span>Urbano</span>`;
        html += `<span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${nullColor}"></span>Sin datos</span>`;
        html += '</div>';

        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;
            html += `<div class="strip-row">`;
            html += `<div class="strip-label" title="${name}">${name}</div>`;
            html += `<svg class="strip-svg" id="rural-strip-svg-${i}" style="height:${rowH}px"></svg>`;
            html += `</div>`;
        }
        html += '</div>';
        const gen4 = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen4 !== _renderGen) return;
            for (let i = 0; i < selected.length; i++) {
                const code = selected[i];
                const svgEl = document.getElementById(`rural-strip-svg-${i}`);
                if (!svgEl) continue;
                const svg = d3.select(svgEl);
                const w = svgEl.clientWidth;
                const h = svgEl.clientHeight;
                if (!w || !h) continue;

                const padBottom = i === selected.length - 1 ? 18 : 0;
                const iw = w;
                const ih = h - padBottom;

                const xScale = d3.scaleLinear().domain([minYear, maxYear]).range([0, iw]);
                const rectW = Math.max(1, iw / (maxYear - minYear + 1));

                for (const year of years) {
                    const val = DataLoader.getValue(code, year, indicator);
                    let color = nullColor;
                    let label = 'Sin datos';
                    if (val != null) {
                        if (val >= 50) { color = ruralColor; label = `Rural (${val.toFixed(1)}%)`; }
                        else { color = urbanoColor; label = `Urbano (${(100 - val).toFixed(1)}%)`; }
                    }
                    svg.append('rect')
                        .attr('x', xScale(year) - rectW / 2)
                        .attr('y', 0)
                        .attr('width', rectW + 0.5)
                        .attr('height', ih)
                        .attr('fill', color)
                        .on('mouseover', function (e) {
                            const meta2 = DataLoader.getTerritoryMeta(code);
                            this.__tipHtml = `<div class="tooltip-title">${meta2 ? meta2.name : code}</div>` +
                                fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year) +
                                `<div class="tooltip-row"><span class="tooltip-label">${year}</span><span class="tooltip-value">${label}</span></div>`;
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mousemove', function (e) {
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mouseout', () => Tooltip.hide());
                }

                const markerX = xScale(currentYear);
                svg.append('line')
                    .attr('class', 'year-marker')
                    .attr('x1', markerX).attr('x2', markerX)
                    .attr('y1', 0).attr('y2', ih)
                    .attr('stroke-width', 2);

                if (i === selected.length - 1) {
                    const g = svg.append('g').attr('transform', `translate(0,${ih})`);
                    const stripTicks = smartXTicks([minYear, maxYear], iw, 50);
                    g.call(d3.axisBottom(xScale).tickValues(stripTicks).tickFormat(d3.format('d')));
                    g.selectAll('text').attr('font-size', 9);
                    _fixAxisClip(g);
                }
            }
        });
    }

    function _renderRuralStripsFacet() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const currentYear = State.get('currentYear');

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más municipios para ver franjas rural/urbano</div>';
            return;
        }

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const years = DataLoader.getYears().filter(y => y >= rangeStart && y <= rangeEnd);
        if (years.length === 0) { facetGrid.innerHTML = ''; return; }
        const minYear = years[0];
        const maxYear = years[years.length - 1];

        const ruralColor = RURAL_COLORS.rural;
        const urbanoColor = RURAL_COLORS.urbano;
        const nullColor = '#e0e0e0';

        let html = '';
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;
            html += `<div class="facet-cell strip-facet-cell" data-idx="${i}">
                <div class="facet-title">
                    <div class="facet-dot" style="background:${territoryColor(i)}"></div>
                    ${name}
                </div>
                <div class="strip-legend strip-legend-inline">
                    <span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${ruralColor}"></span>Rural</span>
                    <span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${urbanoColor}"></span>Urbano</span>
                    <span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${nullColor}"></span>Sin datos</span>
                </div>
                <svg class="facet-svg" id="rural-strip-facet-${i}"></svg>
            </div>`;
        }
        const gen5 = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen5 !== _renderGen) return;
            for (let i = 0; i < selected.length; i++) {
                const code = selected[i];
                const svgEl = document.getElementById(`rural-strip-facet-${i}`);
                if (!svgEl) continue;
                const svg = d3.select(svgEl);
                const w = svgEl.clientWidth;
                const h = svgEl.clientHeight;
                if (!w || !h) continue;

                const padBottom = 18;
                const iw = w;
                const ih = h - padBottom;

                const xScale = d3.scaleLinear().domain([minYear, maxYear]).range([0, iw]);
                const rectW = Math.max(1, iw / (maxYear - minYear + 1));

                for (const year of years) {
                    const val = DataLoader.getValue(code, year, indicator);
                    let color = nullColor;
                    let label = 'Sin datos';
                    if (val != null) {
                        if (val >= 50) { color = ruralColor; label = `Rural (${val.toFixed(1)}%)`; }
                        else { color = urbanoColor; label = `Urbano (${(100 - val).toFixed(1)}%)`; }
                    }
                    svg.append('rect')
                        .attr('x', xScale(year) - rectW / 2)
                        .attr('y', 0)
                        .attr('width', rectW + 0.5)
                        .attr('height', ih)
                        .attr('fill', color)
                        .on('mouseover', function (e) {
                            const meta2 = DataLoader.getTerritoryMeta(code);
                            this.__tipHtml = `<div class="tooltip-title">${meta2 ? meta2.name : code}</div>` +
                                fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year) +
                                `<div class="tooltip-row"><span class="tooltip-label">${year}</span><span class="tooltip-value">${label}</span></div>`;
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mousemove', function (e) {
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mouseout', () => Tooltip.hide());
                }

                const markerX = xScale(currentYear);
                svg.append('line')
                    .attr('class', 'year-marker')
                    .attr('x1', markerX).attr('x2', markerX)
                    .attr('y1', 0).attr('y2', ih)
                    .attr('stroke-width', 2);

                const g = svg.append('g').attr('transform', `translate(0,${ih})`);
                const stripTicks = smartXTicks([minYear, maxYear], iw, 50);
                g.call(d3.axisBottom(xScale).tickValues(stripTicks).tickFormat(d3.format('d')));
                g.selectAll('text').attr('font-size', 9);
                _fixAxisClip(g);
            }
        });
    }

    /* ── Timeline strips for categorical indicators (hab4) — Overlay mode ── */
    function _renderStripsOverlay() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const currentYear = State.get('currentYear');

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios para ver franjas temporales</div>';
            return;
        }

        // Build year range from data, clamped to yearRange
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const years = DataLoader.getYears().filter(y => y >= 1858 && y >= rangeStart && y <= rangeEnd);
        if (years.length === 0) { facetGrid.innerHTML = ''; return; }
        const minYear = years[0];
        const maxYear = years[years.length - 1];

        // Category color map
        const catColor = {};
        const catLabel = {};
        for (const c of HAB4_CATEGORIES) {
            catColor[c.code] = c.color;
            catLabel[c.code] = c.label;
        }
        const nullColor = '#e0e0e0';

        // Compute dynamic row height based on available space
        const gridRect = facetGrid.getBoundingClientRect();
        const legendH = 36;
        const axisH = 22;
        const availH = (gridRect.height || window.innerHeight * 0.6) - legendH - axisH;
        const rowH = Math.max(28, Math.min(60, Math.floor(availH / selected.length)));

        // Build HTML: legend + strip rows
        let html = '<div class="strip-container">';
        html += '<div class="strip-legend">';
        for (const c of HAB4_CATEGORIES) {
            html += `<span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${c.color}"></span>${c.label}</span>`;
        }
        html += `<span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${nullColor}"></span>Sin datos</span>`;
        html += '</div>';

        // One SVG row per territory
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;
            html += `<div class="strip-row">`;
            html += `<div class="strip-label" title="${name}">${name}</div>`;
            html += `<svg class="strip-svg" id="strip-svg-${i}" style="height:${rowH}px"></svg>`;
            html += `</div>`;
        }
        html += '</div>';
        const gen6 = ++_renderGen;
        facetGrid.innerHTML = html;

        // Render each strip SVG
        requestAnimationFrame(() => {
            if (gen6 !== _renderGen) return;
            for (let i = 0; i < selected.length; i++) {
                const code = selected[i];
                const svgEl = document.getElementById(`strip-svg-${i}`);
                if (!svgEl) continue;
                const svg = d3.select(svgEl);
                const w = svgEl.clientWidth;
                const h = svgEl.clientHeight;
                if (!w || !h) continue;

                const padBottom = i === selected.length - 1 ? 18 : 0;
                const iw = w;
                const ih = h - padBottom;

                const xScale = d3.scaleLinear().domain([minYear, maxYear]).range([0, iw]);
                const rectW = Math.max(1, iw / (maxYear - minYear + 1));

                for (const year of years) {
                    const val = DataLoader.getValue(code, year, indicator);
                    const color = (val != null && catColor[val]) ? catColor[val] : nullColor;
                    svg.append('rect')
                        .attr('x', xScale(year) - rectW / 2)
                        .attr('y', 0)
                        .attr('width', rectW + 0.5)
                        .attr('height', ih)
                        .attr('fill', color)
                        .on('mouseover', function (e) {
                            const label = val != null && catLabel[val] ? catLabel[val] : 'Sin datos';
                            const meta2 = DataLoader.getTerritoryMeta(code);
                            this.__tipHtml = `<div class="tooltip-title">${meta2 ? meta2.name : code}</div>` +
                                fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year) +
                                `<div class="tooltip-row"><span class="tooltip-label">${year}</span><span class="tooltip-value">${label}</span></div>`;
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mousemove', function (e) {
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mouseout', () => Tooltip.hide());
                }

                const markerX = xScale(currentYear);
                svg.append('line')
                    .attr('class', 'year-marker')
                    .attr('x1', markerX).attr('x2', markerX)
                    .attr('y1', 0).attr('y2', ih)
                    .attr('stroke-width', 2);

                if (i === selected.length - 1) {
                    const g = svg.append('g').attr('transform', `translate(0,${ih})`);
                    const stripTicks = smartXTicks([minYear, maxYear], iw, 50);
                    g.call(d3.axisBottom(xScale).tickValues(stripTicks).tickFormat(d3.format('d')));
                    g.selectAll('text').attr('font-size', 9);
                    _fixAxisClip(g);
                }
            }
        });
    }

    /* ── Timeline strips — Facet mode (individual cards per territory) ── */
    function _renderStripsFacet() {
        const chartContainer = document.getElementById('line-chart-container');
        const facetGrid = document.getElementById('facet-grid');
        chartContainer.style.display = 'none';
        facetGrid.style.display = '';

        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const currentYear = State.get('currentYear');

        if (selected.length === 0) {
            facetGrid.innerHTML = '<div class="chart-empty" style="display:flex;position:static;padding:60px">Selecciona uno o más territorios para ver franjas temporales</div>';
            return;
        }

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const years = DataLoader.getYears().filter(y => y >= 1858 && y >= rangeStart && y <= rangeEnd);
        if (years.length === 0) { facetGrid.innerHTML = ''; return; }
        const minYear = years[0];
        const maxYear = years[years.length - 1];

        const catColor = {};
        const catLabel = {};
        for (const c of HAB4_CATEGORIES) {
            catColor[c.code] = c.color;
            catLabel[c.code] = c.label;
        }
        const nullColor = '#e0e0e0';

        // Build facet cards
        let html = '';
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const meta = DataLoader.getTerritoryMeta(code);
            const name = meta ? meta.name : code;
            html += `<div class="facet-cell strip-facet-cell" data-idx="${i}">
                <div class="facet-title">
                    <div class="facet-dot" style="background:${territoryColor(i)}"></div>
                    ${name}
                </div>
                <div class="strip-legend strip-legend-inline">
                    ${HAB4_CATEGORIES.map(c => `<span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${c.color}"></span>${c.label}</span>`).join('')}
                    <span class="strip-legend-item"><span class="strip-legend-swatch" style="background:${nullColor}"></span>Sin datos</span>
                </div>
                <svg class="facet-svg" id="strip-facet-${i}"></svg>
            </div>`;
        }
        const gen7 = ++_renderGen;
        facetGrid.innerHTML = html;

        requestAnimationFrame(() => {
            if (gen7 !== _renderGen) return;
            for (let i = 0; i < selected.length; i++) {
                const code = selected[i];
                const svgEl = document.getElementById(`strip-facet-${i}`);
                if (!svgEl) continue;
                const svg = d3.select(svgEl);
                const w = svgEl.clientWidth;
                const h = svgEl.clientHeight;
                if (!w || !h) continue;

                const padBottom = 18;
                const iw = w;
                const ih = h - padBottom;

                const xScale = d3.scaleLinear().domain([minYear, maxYear]).range([0, iw]);
                const rectW = Math.max(1, iw / (maxYear - minYear + 1));

                for (const year of years) {
                    const val = DataLoader.getValue(code, year, indicator);
                    const color = (val != null && catColor[val]) ? catColor[val] : nullColor;
                    svg.append('rect')
                        .attr('x', xScale(year) - rectW / 2)
                        .attr('y', 0)
                        .attr('width', rectW + 0.5)
                        .attr('height', ih)
                        .attr('fill', color)
                        .on('mouseover', function (e) {
                            const label = val != null && catLabel[val] ? catLabel[val] : 'Sin datos';
                            const meta2 = DataLoader.getTerritoryMeta(code);
                            this.__tipHtml = `<div class="tooltip-title">${meta2 ? meta2.name : code}</div>` +
                                fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year) +
                                `<div class="tooltip-row"><span class="tooltip-label">${year}</span><span class="tooltip-value">${label}</span></div>`;
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mousemove', function (e) {
                            Tooltip.show(this.__tipHtml, e.clientX, e.clientY);
                        })
                        .on('mouseout', () => Tooltip.hide());
                }

                const markerX = xScale(currentYear);
                svg.append('line')
                    .attr('class', 'year-marker')
                    .attr('x1', markerX).attr('x2', markerX)
                    .attr('y1', 0).attr('y2', ih)
                    .attr('stroke-width', 2);

                // Each facet card gets its own X axis
                const g = svg.append('g').attr('transform', `translate(0,${ih})`);
                const stripTicks = smartXTicks([minYear, maxYear], iw, 50);
                g.call(d3.axisBottom(xScale).tickValues(stripTicks).tickFormat(d3.format('d')));
                g.selectAll('text').attr('font-size', 9);
            }
        });
    }

    /** Fix first/last X-axis tick labels so they don't clip outside the chart */
    function _fixAxisClip(axisG) {
        const ticks = axisG.selectAll('.tick text').nodes();
        if (ticks.length >= 2) {
            d3.select(ticks[0]).attr('text-anchor', 'start');
            d3.select(ticks[ticks.length - 1]).attr('text-anchor', 'end');
        }
    }

    /* ── Shared helpers ── */
    function _buildYScale(allPoints, ih, scaleType) {
        if (scaleType === 'log') {
            const positiveValues = allPoints.filter(d => d.value != null && d.value > 0).map(d => d.value);
            if (positiveValues.length === 0) return d3.scaleLinear().domain([0, 1]).range([ih, 0]);
            const yMin = d3.min(positiveValues);
            const yMax = d3.max(positiveValues) * 1.05;
            return d3.scaleLog().domain([yMin, yMax]).range([ih, 0]).clamp(true);
        }
        const yMaxVal = d3.max(allPoints, d => d.value);
        return d3.scaleLinear()
            .domain([0, (yMaxVal != null ? yMaxVal : 1) * 1.05])
            .range([ih, 0])
            .nice();
    }

    function _buildSeries(selected, indicator, axisMode) {
        const series = [];
        for (let i = 0; i < selected.length; i++) {
            const code = selected[i];
            const raw = DataLoader.getTimeSeries(code, indicator);
            const meta = DataLoader.getTerritoryMeta(code);
            const data = _transformAxis(raw, code, indicator, axisMode);
            series.push({ code, name: meta ? meta.name : code, color: territoryColor(i), data });
        }
        return series;
    }

    function _transformAxis(rawSeries, code, indicator, axisMode) {
        if (axisMode === 'absolute') return rawSeries;
        if (axisMode === 'index') {
            const base = rawSeries.length > 0 ? rawSeries[0].value : 1;
            return rawSeries.map(d => ({ year: d.year, value: base ? (d.value / base) * 100 : null }));
        }
        if (axisMode === 'pct_total') {
            const level = State.get('geoLevel');
            return rawSeries.map(d => {
                const total = DataLoader.getLevelTotal(d.year, indicator, level === 'region' ? 'provincia' : level);
                return { year: d.year, value: total ? (d.value / total) * 100 : null };
            });
        }
        return rawSeries;
    }

    function _onYearChange() {
        const view = State.get('activeView');
        if (view === 'chart' && State.get('chartType') !== 'line') return;
        if (view !== 'chart' && view !== 'line') return;

        if (_getMode() === 'facet' || _getMode() === 'sector' || _isCategorical() || _isRural() || _isDispersion() || _isHabitatAggregate()) {
            render();
            return;
        }
        // Efficient update: just move clip-path and marker, no full re-render
        const svgEl = d3.select('#line-svg').node();
        if (!svgEl || !svgEl.__xScale) return;

        const xScale = svgEl.__xScale;
        const yScale = svgEl.__yScale;
        const currentYear = State.get('currentYear');
        const x = xScale(currentYear);

        // Update clip rect width
        d3.select('#line-svg').select(`#${svgEl.__clipId} rect`)
            .attr('width', x + 2);

        // Update year marker
        svgEl.__yearLine.attr('x1', x).attr('x2', x);

        // Update end dots + labels
        const series = svgEl.__series;
        if (series && svgEl.__gDots) {
            svgEl.__gDots.selectAll('*').remove();
            const labelPositions = [];
            for (const s of series) {
                const pt = s.data.find(d => d.year === currentYear) ||
                           s.data.filter(d => d.year <= currentYear).pop();
                if (pt && pt.value != null) {
                    const cx = xScale(pt.year);
                    const cy = yScale(pt.value);
                    svgEl.__gDots.append('circle')
                        .attr('cx', cx)
                        .attr('cy', cy)
                        .attr('r', 4)
                        .attr('fill', s.color)
                        .attr('stroke', '#fff')
                        .attr('stroke-width', 1.5);
                    labelPositions.push({ name: s.name, color: s.color, cx, cy });
                }
            }
            // Update labels
            if (svgEl.__gLabels) {
                svgEl.__gLabels.selectAll('*').remove();
                labelPositions.sort((a, b) => a.cy - b.cy);
                for (let i = 1; i < labelPositions.length; i++) {
                    if (labelPositions[i].cy - labelPositions[i - 1].cy < 14) {
                        labelPositions[i].cy = labelPositions[i - 1].cy + 14;
                    }
                }
                for (const lp of labelPositions) {
                    svgEl.__gLabels.append('text')
                        .attr('x', lp.cx + 8)
                        .attr('y', lp.cy + 4)
                        .attr('font-size', 11)
                        .attr('font-weight', 600)
                        .attr('fill', lp.color)
                        .text(lp.name);
                }
            }
        }
    }

    return { init, render };
})();

export default LineView;
