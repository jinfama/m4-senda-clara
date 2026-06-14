/* area-view.js — Stacked area chart.
   Standard mode: stacks territories for one indicator.
   Empleo mode: stacks 3 sectors (agr/ind/ser) per territory as small multiples. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { territoryColor, fmt, fmtIndicator, fmtTooltipContext, isCategoricalIndicator, HAB4_CATEGORIES, smartXTicks } from '../utils.js';

const SECTOR_COLORS = { pct_agr: '#66a61e', pct_ind: '#7570b3', pct_ser: '#e7298a' };
const SECTOR_LABELS = { pct_agr: 'Agricultura', pct_ind: 'Industria', pct_ser: 'Servicios' };
const SECTOR_IDS = ['pct_agr', 'pct_ind', 'pct_ser'];
const N_SECTOR_IDS = ['n_agr', 'n_ind', 'n_ser'];
const N_SECTOR_LABELS = { n_agr: 'Agricultura', n_ind: 'Industria', n_ser: 'Servicios' };

const HAB_FIELD_IDS = ['pct_ciudad', 'pct_agrociudad', 'pct_nucleado', 'pct_disperso'];
const HAB_DATA_FIELDS = ['pct_ciudad', 'pct_agro', 'pct_nuc', 'pct_disp'];
const HAB_COLORS = {};
const HAB_LABELS = {};
for (const c of HAB4_CATEGORIES) {
    HAB_COLORS[HAB_DATA_FIELDS[c.code - 1]] = c.color;
    HAB_LABELS[HAB_DATA_FIELDS[c.code - 1]] = c.label;
}
const HAB_INDICATORS = new Set(['hab4', ...HAB_FIELD_IDS, ...HAB_DATA_FIELDS]);

const RURAL_INDICATORS = new Set([
    'pct_rural_5k', 'pct_rural_10k', 'pct_rural_5k_nuc', 'pct_rural_10k_nuc',
    'pct_rural_5k_ex', 'pct_rural_10k_ex', 'pct_rural_5k_nuc_ex', 'pct_rural_10k_nuc_ex'
]);
const RURAL_FIELDS = ['urbano', 'rural'];
const RURAL_COLORS = { rural: '#d95f02', urbano: '#1b9e77' };
const RURAL_LABELS = { rural: 'Rural', urbano: 'Urbano' };

const DISPERSION_INDICATORS = new Set([
    'pct_dispersion', 'pct_agrupada', 'pob_dispersa', 'pob_agrupada'
]);
const DISPERSION_FIELDS = ['agrupada', 'dispersa'];
const DISPERSION_COLORS = { dispersa: '#e6550d', agrupada: '#3182bd' };
const DISPERSION_LABELS = { dispersa: 'Dispersa', agrupada: 'Agrupada' };

const AreaView = (() => {
    let _initialized = false;
    const margin = { top: 20, right: 20, bottom: 30, left: 60 };
    const smMargin = { top: 8, right: 12, bottom: 24, left: 44 };

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
        if (axisMode === 'pct_composition') return '% composición';
        if (axisMode === 'pct_andalucia') return '% Andalucía';
        return def ? def.unit : '';
    }

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('selectedTerritories', render);
        State.subscribe('activeIndicator', render);
        State.subscribe('axisMode', render);
        State.subscribe('chartLayout', render);
        State.subscribe('yearRange', render);
        State.subscribe('ruralVisibleLines', render);
        State.subscribe('ruralUnit', render);
        State.subscribe('habitatVisibleLines', render);
        State.subscribe('dispersionVisibleLines', render);
        State.subscribe('dispersionUnit', render);
        State.subscribe('facetYAxis', render);
        State.subscribe('currentYear', _updateMarker);
    }

    function _isEmpleo() {
        return State.get('activeCategory') === 'empleo';
    }

    function _isHabitat() {
        const ind = State.get('activeIndicator');
        return HAB_INDICATORS.has(ind) || isCategoricalIndicator(ind);
    }

    function _isRural() {
        return RURAL_INDICATORS.has(State.get('activeIndicator'));
    }

    function _isDispersion() {
        return DISPERSION_INDICATORS.has(State.get('activeIndicator'));
    }

    function _fixAxisClip(axisG) {
        const ticks = axisG.selectAll('.tick text').nodes();
        if (ticks.length >= 2) {
            d3.select(ticks[0]).attr('text-anchor', 'start');
            d3.select(ticks[ticks.length - 1]).attr('text-anchor', 'end');
        }
    }

    function _getAreaMode() {
        return State.get('axisMode');
    }

    function render() {
        // Only render if area panel is visible
        const view = State.get('activeView');
        if (view === 'chart' && State.get('chartType') !== 'area') return;
        if (view !== 'chart' && view !== 'area') return;

        if (_isHabitat()) {
            _renderHabitatComposition();
        } else if (_isRural()) {
            _renderRuralComposition();
        } else if (_isDispersion()) {
            _renderDispersionComposition();
        } else if (_isEmpleo()) {
            _renderSectorComposition();
        } else {
            _renderTerritoryStack();
        }
    }

    /* ══════════════════════════════════════════════════════
       EMPLEO: Sector composition (stacked area or 3 lines)
       ══════════════════════════════════════════════════════ */

    function _renderSectorComposition() {
        const selected = State.get('selectedTerritories');
        const emptyEl = document.getElementById('area-empty');
        const svg = d3.select('#area-svg');
        svg.selectAll('*').remove();

        if (selected.length === 0) {
            emptyEl.textContent = 'Selecciona uno o más territorios para ver composición sectorial';
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        // Determine which sector set based on current indicator
        const curInd = State.get('activeIndicator');
        const useAbsolute = N_SECTOR_IDS.includes(curInd);
        const sectorIds = useAbsolute ? N_SECTOR_IDS : SECTOR_IDS;
        const sectorLabels = useAbsolute ? N_SECTOR_LABELS : SECTOR_LABELS;
        const sectorColors = useAbsolute
            ? { n_agr: '#66a61e', n_ind: '#7570b3', n_ser: '#e7298a' }
            : SECTOR_COLORS;

        if (selected.length === 1) {
            _renderSingleTerritory(svg, selected[0], sectorIds, sectorLabels, sectorColors, useAbsolute);
        } else {
            _renderSectorSmallMultiples(svg, selected, sectorIds, sectorLabels, sectorColors, useAbsolute);
        }
    }

    function _renderSingleTerritory(svg, code, sectorIds, sectorLabels, sectorColors, useAbsolute) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const meta = DataLoader.getTerritoryMeta(code);
        const currentYear = State.get('currentYear');

        // Build data per sector
        const sectorData = {};
        for (const sid of sectorIds) {
            sectorData[sid] = DataLoader.getTimeSeries(code, sid);
        }

        // Get common years
        const allYearsSet = new Set();
        for (const sid of sectorIds) {
            for (const d of sectorData[sid]) allYearsSet.add(d.year);
        }
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const allYears = [...allYearsSet].sort((a, b) => a - b).filter(y => y >= rangeStart && y <= rangeEnd);
        if (allYears.length === 0) return;

        // Build table for stacking
        const tableData = allYears.map(year => {
            const row = { year };
            for (const sid of sectorIds) {
                const pt = sectorData[sid].find(d => d.year === year);
                row[sid] = pt ? pt.value : 0;
            }
            return row;
        });

        const xScale = d3.scaleLinear().domain(d3.extent(allYears)).range([0, iw]);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        if ('stacked' === 'stacked') {
            const stack = d3.stack().keys(sectorIds);
            const stacked = stack(tableData);
            const yMax = useAbsolute ? d3.max(stacked[stacked.length - 1], d => d[1]) * 1.05 : 100;
            const yScale = d3.scaleLinear().domain([0, yMax]).range([ih, 0]);

            const xtks = smartXTicks(d3.extent(allYears), iw);
            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
            const xAx = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(xtks).tickFormat(d3.format('d')));
            _fixAxisClip(xAx);
            g.append('g').attr('class', 'axis')
                .call(d3.axisLeft(yScale).ticks(6).tickFormat(d => useAbsolute ? fmt(d) : d.toFixed(0) + '%'));
            if (idx === 0) _addYLabel(g, useAbsolute ? 'personas' : '%', ih, smMargin.left);

            const area = d3.area()
                .x(d => xScale(d.data.year))
                .y0(d => yScale(d[0]))
                .y1(d => yScale(d[1]));

            g.selectAll('.area-fill')
                .data(stacked)
                .join('path')
                .attr('class', 'area-fill')
                .attr('d', area)
                .attr('fill', (d, i) => sectorColors[sectorIds[i]]);

            // Year marker
            const yearLine = g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih);
            const cx = xScale(currentYear);
            yearLine.attr('x1', cx).attr('x2', cx);
            svg.node().__xScale = xScale;
            svg.node().__yearLine = yearLine;

            // Hover
            g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                .on('mousemove', function (e) {
                    const [mx] = d3.pointer(e, this);
                    const year = Math.round(xScale.invert(mx));
                    const row = tableData.find(d => d.year === year);
                    if (!row) return;
                    let html = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                    html += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                    for (const sid of sectorIds) {
                        const v = row[sid];
                        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${sectorColors[sid]}">${sectorLabels[sid]}</span><span class="tooltip-value">${useAbsolute ? fmt(v) + ' personas' : v.toFixed(1) + '%'}</span></div>`;
                    }
                    Tooltip.show(html, e.clientX, e.clientY);
                })
                .on('mouseout', () => Tooltip.hide());
        } else {
            // Lines mode: 3 separate lines
            const allVals = tableData.flatMap(row => sectorIds.map(sid => row[sid]));
            const yMax = useAbsolute ? d3.max(allVals) * 1.05 : 100;
            const yScale = d3.scaleLinear().domain([0, yMax]).range([ih, 0]).nice();

            const xtksL = smartXTicks(d3.extent(allYears), iw);
            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
            g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(xtksL).tickFormat(d3.format('d')));
            g.append('g').attr('class', 'axis')
                .call(d3.axisLeft(yScale).ticks(6).tickFormat(d => useAbsolute ? fmt(d) : d.toFixed(0) + '%'));

            const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));

            for (const sid of sectorIds) {
                const data = sectorData[sid];
                g.append('path').datum(data).attr('class', 'data-line')
                    .attr('d', line).attr('stroke', sectorColors[sid]).attr('stroke-width', 2).attr('fill', 'none');

                // End label
                const pt = data.find(d => d.year === currentYear) || data.filter(d => d.year <= currentYear).pop();
                if (pt) {
                    g.append('text')
                        .attr('x', xScale(pt.year) + 6)
                        .attr('y', yScale(pt.value) + 4)
                        .attr('font-size', 11).attr('font-weight', 600)
                        .attr('fill', sectorColors[sid])
                        .text(sectorLabels[sid]);
                }
            }

            // Year marker
            const yearLine = g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih);
            const cx = xScale(currentYear);
            yearLine.attr('x1', cx).attr('x2', cx);
            svg.node().__xScale = xScale;
            svg.node().__yearLine = yearLine;
        }

        // Legend
        const legend = g.append('g').attr('transform', `translate(${iw - 200}, 0)`);
        sectorIds.forEach((sid, i) => {
            legend.append('rect').attr('x', i * 70).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', sectorColors[sid]);
            legend.append('text').attr('x', i * 70 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(sectorLabels[sid]);
        });
    }

    function _renderSectorSmallMultiples(svg, selected, sectorIds, sectorLabels, sectorColors, useAbsolute) {
        const container = svg.node().parentElement;
        const rect = svg.node().getBoundingClientRect();

        // Use the SVG area to create a grid of small charts
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const cols = selected.length <= 2 ? selected.length : selected.length <= 4 ? 2 : 3;
        const rows = Math.ceil(selected.length / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        const m = smMargin;
        const currentYear = State.get('currentYear');

        // Determine shared Y scale
        let globalYMax = useAbsolute ? 0 : 100;
        const allSeries = {};
        for (const code of selected) {
            allSeries[code] = {};
            for (const sid of sectorIds) {
                allSeries[code][sid] = DataLoader.getTimeSeries(code, sid);
                if (useAbsolute) {
                    for (const d of allSeries[code][sid]) {
                        if (d.value > globalYMax) globalYMax = d.value;
                    }
                }
            }
        }
        if (useAbsolute) globalYMax *= 1.05;

        // Get common year extent
        const yearSets = new Set();
        for (const code of selected) {
            for (const sid of sectorIds) {
                for (const d of allSeries[code][sid]) yearSets.add(d.year);
            }
        }
        const [smRangeStart, smRangeEnd] = State.get('yearRange');
        const allYears = [...yearSets].sort((a, b) => a - b).filter(y => y >= smRangeStart && y <= smRangeEnd);
        if (allYears.length === 0) return;
        const xDomain = d3.extent(allYears);

        svg.node().__xScale = null;
        svg.node().__yearLine = null;

        for (let idx = 0; idx < selected.length; idx++) {
            const code = selected[idx];
            const meta = DataLoader.getTerritoryMeta(code);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const ox = col * cellW + m.left;
            const oy = row * cellH + m.top;
            const iw = cellW - m.left - m.right;
            const ih = cellH - m.top - m.bottom - 14; // 14px for title

            const g = svg.append('g').attr('transform', `translate(${ox},${oy + 14})`);

            // Title
            svg.append('text').attr('x', ox).attr('y', oy + 10)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', '#333')
                .text(meta ? meta.name : code);

            // Build table data for this territory
            const tableData = allYears.map(year => {
                const r = { year };
                for (const sid of sectorIds) {
                    const pt = allSeries[code][sid].find(d => d.year === year);
                    r[sid] = pt ? pt.value : 0;
                }
                return r;
            });

            const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
            const yScale = d3.scaleLinear().domain([0, globalYMax]).range([ih, 0]);

            // Axes
            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(3).tickSize(-iw).tickFormat(''));
            g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(smartXTicks(xDomain, iw, 50)).tickFormat(d3.format('d')));
            g.append('g').attr('class', 'axis')
                .call(d3.axisLeft(yScale).ticks(3).tickFormat(d => useAbsolute ? fmt(d) : d.toFixed(0) + '%'));

            if ('stacked' === 'stacked') {
                const stack = d3.stack().keys(sectorIds);
                const stacked = stack(tableData);
                const area = d3.area()
                    .x(d => xScale(d.data.year))
                    .y0(d => yScale(d[0]))
                    .y1(d => yScale(d[1]));
                g.selectAll('.area-fill').data(stacked).join('path')
                    .attr('class', 'area-fill').attr('d', area)
                    .attr('fill', (d, i) => sectorColors[sectorIds[i]]);
            } else {
                const line = d3.line().defined(d => d.value != null).x(d => xScale(d.year)).y(d => yScale(d.value));
                for (const sid of sectorIds) {
                    g.append('path').datum(allSeries[code][sid])
                        .attr('d', line).attr('stroke', sectorColors[sid])
                        .attr('stroke-width', 1.5).attr('fill', 'none');
                }
            }

            // Year marker
            const cx = xScale(currentYear);
            g.append('line').attr('class', 'year-marker').attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', ih);
        }

        // Shared legend at top
        const legend = svg.append('g').attr('transform', `translate(${w - 240}, 4)`);
        sectorIds.forEach((sid, i) => {
            legend.append('rect').attr('x', i * 80).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', sectorColors[sid]);
            legend.append('text').attr('x', i * 80 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(sectorLabels[sid]);
        });
    }

    /* ══════════════════════════════════════════════════════
       HABITAT: Composition stacked area (4 habitat types)
       ══════════════════════════════════════════════════════ */

    function _renderHabitatComposition() {
        const selected = State.get('selectedTerritories');
        const emptyEl = document.getElementById('area-empty');
        const svg = d3.select('#area-svg');
        svg.selectAll('*').remove();

        if (selected.length === 0) {
            emptyEl.textContent = 'Selecciona uno o más territorios para ver composición de hábitat';
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        if (selected.length === 1) {
            _renderHabitatSingle(svg, selected[0]);
        } else {
            _renderHabitatSmallMultiples(svg, selected);
        }
    }

    function _renderHabitatSingle(svg, code) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const meta = DataLoader.getTerritoryMeta(code);
        const currentYear = State.get('currentYear');

        // Build data per habitat type
        const habData = {};
        for (const field of HAB_DATA_FIELDS) {
            habData[field] = DataLoader.getTimeSeries(code, field);
        }

        // Common years
        const allYearsSet = new Set();
        for (const field of HAB_DATA_FIELDS) {
            for (const d of habData[field]) allYearsSet.add(d.year);
        }
        const [habRangeStart, habRangeEnd] = State.get('yearRange');
        const allYears = [...allYearsSet].sort((a, b) => a - b).filter(y => y >= habRangeStart && y <= habRangeEnd);
        if (allYears.length === 0) return;

        // Build table for stacking
        const tableData = allYears.map(year => {
            const row = { year };
            for (const field of HAB_DATA_FIELDS) {
                const pt = habData[field].find(d => d.year === year);
                row[field] = pt ? (pt.value || 0) : 0;
            }
            return row;
        });

        const xScale = d3.scaleLinear().domain(d3.extent(allYears)).range([0, iw]);
        const yScale = d3.scaleLinear().domain([0, 100]).range([ih, 0]);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const habXTicks = smartXTicks(d3.extent(allYears), iw);
        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const habXAx = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(habXTicks).tickFormat(d3.format('d')));
        _fixAxisClip(habXAx);
        g.append('g').attr('class', 'axis')
            .call(d3.axisLeft(yScale).ticks(6).tickFormat(d => d.toFixed(0) + '%'));
        _addYLabel(g, '%', ih, margin.left);

        const activeHabFields = HAB_DATA_FIELDS.filter(f => State.get('habitatVisibleLines').includes(f));
        const stack = d3.stack().keys(activeHabFields);
        const stacked = stack(tableData);

        const area = d3.area()
            .x(d => xScale(d.data.year))
            .y0(d => yScale(d[0]))
            .y1(d => yScale(d[1]));

        g.selectAll('.area-fill').data(stacked).join('path')
            .attr('class', 'area-fill').attr('d', area)
            .attr('fill', (d, i) => HAB_COLORS[activeHabFields[i]]);

        // Year marker
        const yearLine = g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih);
        const cx = xScale(currentYear);
        yearLine.attr('x1', cx).attr('x2', cx);
        svg.node().__xScale = xScale;
        svg.node().__yearLine = yearLine;

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                const row = tableData.find(d => d.year === year);
                if (!row) return;
                let html = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                html += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                for (const field of activeHabFields) {
                    html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${HAB_COLORS[field]}">${HAB_LABELS[field]}</span><span class="tooltip-value">${row[field].toFixed(1)}%</span></div>`;
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());

        // Legend
        const legend = g.append('g').attr('transform', `translate(${iw - activeHabFields.length * 70}, 0)`);
        activeHabFields.forEach((field, i) => {
            legend.append('rect').attr('x', i * 70).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', HAB_COLORS[field]);
            legend.append('text').attr('x', i * 70 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(HAB_LABELS[field]);
        });
    }

    function _renderHabitatSmallMultiples(svg, selected) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const cols = selected.length <= 2 ? selected.length : selected.length <= 4 ? 2 : 3;
        const rows = Math.ceil(selected.length / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        const m = smMargin;
        const currentYear = State.get('currentYear');

        const activeHabFields = HAB_DATA_FIELDS.filter(f => State.get('habitatVisibleLines').includes(f));

        // Collect all year extent
        const yearSets = new Set();
        const allSeries = {};
        for (const code of selected) {
            allSeries[code] = {};
            for (const field of HAB_DATA_FIELDS) {
                allSeries[code][field] = DataLoader.getTimeSeries(code, field);
                for (const d of allSeries[code][field]) yearSets.add(d.year);
            }
        }
        const [habSmRs, habSmRe] = State.get('yearRange');
        const allYears = [...yearSets].sort((a, b) => a - b).filter(y => y >= habSmRs && y <= habSmRe);
        if (allYears.length === 0) return;
        const xDomain = d3.extent(allYears);

        svg.node().__xScale = null;
        svg.node().__yearLine = null;

        for (let idx = 0; idx < selected.length; idx++) {
            const code = selected[idx];
            const meta = DataLoader.getTerritoryMeta(code);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const ox = col * cellW + m.left;
            const oy = row * cellH + m.top;
            const iw = cellW - m.left - m.right;
            const ih = cellH - m.top - m.bottom - 14;

            const g = svg.append('g').attr('transform', `translate(${ox},${oy + 14})`);

            // Title
            svg.append('text').attr('x', ox).attr('y', oy + 10)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', '#333')
                .text(meta ? meta.name : code);

            // Table data
            const tableData = allYears.map(year => {
                const r = { year };
                for (const field of HAB_DATA_FIELDS) {
                    const pt = allSeries[code][field].find(d => d.year === year);
                    r[field] = pt ? (pt.value || 0) : 0;
                }
                return r;
            });

            const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
            const yScale = d3.scaleLinear().domain([0, 100]).range([ih, 0]);

            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(3).tickSize(-iw).tickFormat(''));
            g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(smartXTicks(xDomain, iw, 50)).tickFormat(d3.format('d')));
            g.append('g').attr('class', 'axis')
                .call(d3.axisLeft(yScale).ticks(3).tickFormat(d => d.toFixed(0) + '%'));

            const stack = d3.stack().keys(activeHabFields);
            const stacked = stack(tableData);
            const area = d3.area()
                .x(d => xScale(d.data.year))
                .y0(d => yScale(d[0]))
                .y1(d => yScale(d[1]));
            g.selectAll('.area-fill').data(stacked).join('path')
                .attr('class', 'area-fill').attr('d', area)
                .attr('fill', (d, i) => HAB_COLORS[activeHabFields[i]]);

            // Year marker
            const cx = xScale(currentYear);
            g.append('line').attr('class', 'year-marker').attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', ih);

            // Hover per cell
            g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                .on('mousemove', function (e) {
                    const [mx] = d3.pointer(e, this);
                    const yr = Math.round(xScale.invert(mx));
                    const row = tableData.find(d => d.year === yr);
                    if (!row) return;
                    let tip = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                    tip += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), yr);
                    for (const f of activeHabFields) {
                        tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${HAB_COLORS[f]}">${HAB_LABELS[f]}</span><span class="tooltip-value">${row[f].toFixed(1)}%</span></div>`;
                    }
                    Tooltip.show(tip, e.clientX, e.clientY);
                })
                .on('mouseout', () => Tooltip.hide());
        }

        // Shared legend at top
        const legend = svg.append('g').attr('transform', `translate(${w - activeHabFields.length * 75 - 20}, 4)`);
        activeHabFields.forEach((field, i) => {
            legend.append('rect').attr('x', i * 75).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', HAB_COLORS[field]);
            legend.append('text').attr('x', i * 75 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(HAB_LABELS[field]);
        });
    }

    /* ══════════════════════════════════════════════════════
       DISPERSION: 2-band composition (dispersa + agrupada)
       ══════════════════════════════════════════════════════ */

    function _renderDispersionComposition() {
        const selected = State.get('selectedTerritories');
        const emptyEl = document.getElementById('area-empty');
        const svg = d3.select('#area-svg');
        svg.selectAll('*').remove();

        if (selected.length === 0) {
            emptyEl.textContent = 'Selecciona uno o más territorios para ver composición dispersa/agrupada';
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        if (selected.length === 1) {
            _renderDispersionSingle(svg, selected[0]);
        } else {
            _renderDispersionSmallMultiples(svg, selected);
        }
    }

    function _renderDispersionSingle(svg, code) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const meta = DataLoader.getTerritoryMeta(code);
        const currentYear = State.get('currentYear');
        const isAbs = State.get('dispersionUnit') === 'abs';

        const dispInd = isAbs ? 'pob_dispersa' : 'pct_dispersion';
        const agrInd = isAbs ? 'pob_agrupada' : 'pct_agrupada';

        const [rangeStart, rangeEnd] = State.get('yearRange');
        const dispersaRaw = DataLoader.getTimeSeries(code, dispInd).filter(d => d.year >= rangeStart && d.year <= rangeEnd);
        const agrupadaRaw = DataLoader.getTimeSeries(code, agrInd).filter(d => d.year >= rangeStart && d.year <= rangeEnd);
        if (dispersaRaw.length === 0 && agrupadaRaw.length === 0) return;

        // Merge into unified year rows
        const yearMap = {};
        for (const d of dispersaRaw) yearMap[d.year] = { year: d.year, dispersa: d.value, agrupada: null };
        for (const d of agrupadaRaw) {
            if (!yearMap[d.year]) yearMap[d.year] = { year: d.year, dispersa: null, agrupada: null };
            yearMap[d.year].agrupada = d.value;
        }
        const tableData = Object.values(yearMap).sort((a, b) => a.year - b.year);
        const allYears = tableData.map(d => d.year);

        const activeFields = DISPERSION_FIELDS.filter(f => State.get('dispersionVisibleLines').includes(f));
        const yMax = isAbs
            ? d3.max(tableData, d => Math.max(...activeFields.map(f => d[f] || 0))) * 1.05
            : 105;

        const xScale = d3.scaleLinear().domain(d3.extent(allYears)).range([0, iw]);
        const yScale = d3.scaleLinear().domain([0, yMax || 105]).range([ih, 0]);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const xtks = smartXTicks(d3.extent(allYears), iw);
        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const rXAx = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(xtks).tickFormat(d3.format('d')));
        _fixAxisClip(rXAx);
        const yFmt = isAbs ? d => fmt(d, 0) : d => d.toFixed(0) + '%';
        g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(6).tickFormat(yFmt));
        _addYLabel(g, isAbs ? 'personas' : '%', ih, margin.left);

        const area = d3.area()
            .defined(d => d.value != null)
            .x(d => xScale(d.year))
            .y0(ih)
            .y1(d => yScale(d.value));

        const line = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.year))
            .y(d => yScale(d.value));

        for (const f of activeFields) {
            const seriesData = tableData.map(d => ({ year: d.year, value: d[f] }));
            g.append('path').datum(seriesData).attr('d', area)
                .attr('fill', DISPERSION_COLORS[f]).attr('fill-opacity', 0.3);
            g.append('path').datum(seriesData).attr('d', line)
                .attr('fill', 'none').attr('stroke', DISPERSION_COLORS[f]).attr('stroke-width', 2);
        }

        // Year marker
        const yearLine = g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih);
        const cx = xScale(currentYear);
        yearLine.attr('x1', cx).attr('x2', cx);
        svg.node().__xScale = xScale;
        svg.node().__yearLine = yearLine;

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                const row = tableData.find(d => d.year === year);
                if (!row) return;
                let html = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                html += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                for (const f of activeFields) {
                    const valStr = isAbs ? fmt(row[f], 0) + ' personas' : (row[f] != null ? row[f].toFixed(1) + '%' : '–');
                    html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${DISPERSION_COLORS[f]}">${DISPERSION_LABELS[f]}</span><span class="tooltip-value">${valStr}</span></div>`;
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());

        // Legend
        const legend = g.append('g').attr('transform', `translate(${iw - activeFields.length * 75}, 0)`);
        activeFields.forEach((f, i) => {
            legend.append('rect').attr('x', i * 75).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', DISPERSION_COLORS[f]);
            legend.append('text').attr('x', i * 75 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(DISPERSION_LABELS[f]);
        });
    }

    function _renderDispersionSmallMultiples(svg, selected) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const isAbs = State.get('dispersionUnit') === 'abs';
        const cols = selected.length <= 2 ? selected.length : selected.length <= 4 ? 2 : 3;
        const rows = Math.ceil(selected.length / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        const m = smMargin;
        const currentYear = State.get('currentYear');
        const activeFields = DISPERSION_FIELDS.filter(f => State.get('dispersionVisibleLines').includes(f));

        const dispInd = isAbs ? 'pob_dispersa' : 'pct_dispersion';
        const agrInd = isAbs ? 'pob_agrupada' : 'pct_agrupada';
        const [rs, re] = State.get('yearRange');

        // Collect all data
        let globalYMax = isAbs ? 0 : 105;
        const allTableData = {};
        for (const code of selected) {
            const dispersaRaw = DataLoader.getTimeSeries(code, dispInd).filter(d => d.year >= rs && d.year <= re);
            const agrupadaRaw = DataLoader.getTimeSeries(code, agrInd).filter(d => d.year >= rs && d.year <= re);
            const yearMap = {};
            for (const d of dispersaRaw) yearMap[d.year] = { year: d.year, dispersa: d.value, agrupada: null };
            for (const d of agrupadaRaw) {
                if (!yearMap[d.year]) yearMap[d.year] = { year: d.year, dispersa: null, agrupada: null };
                yearMap[d.year].agrupada = d.value;
            }
            allTableData[code] = Object.values(yearMap).sort((a, b) => a.year - b.year);
            if (isAbs) {
                for (const d of allTableData[code]) {
                    for (const f of activeFields) {
                        if (d[f] != null && d[f] > globalYMax) globalYMax = d[f];
                    }
                }
            }
        }
        if (isAbs) globalYMax *= 1.05;

        // Compute x domain from all years
        const allYears = new Set();
        for (const code of selected) {
            for (const d of allTableData[code]) allYears.add(d.year);
        }
        const sortedYears = [...allYears].sort((a, b) => a - b);
        if (sortedYears.length === 0) return;
        const xDomain = d3.extent(sortedYears);

        svg.node().__xScale = null;
        svg.node().__yearLine = null;

        const yFmt = isAbs ? d => fmt(d, 0) : d => d.toFixed(0) + '%';

        for (let idx = 0; idx < selected.length; idx++) {
            const code = selected[idx];
            const meta = DataLoader.getTerritoryMeta(code);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const ox = col * cellW + m.left;
            const oy = row * cellH + m.top;
            const iw = cellW - m.left - m.right;
            const ih = cellH - m.top - m.bottom - 14;

            const g = svg.append('g').attr('transform', `translate(${ox},${oy + 14})`);

            // Title
            g.append('text').attr('x', 0).attr('y', -4)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', '#333')
                .text(meta ? meta.name : code);

            const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
            const yScale = d3.scaleLinear().domain([0, globalYMax || 105]).range([ih, 0]);

            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(4).tickSize(-iw).tickFormat(''));
            const xtks = smartXTicks(xDomain, iw, 50);
            const xAx = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(xtks).tickFormat(d3.format('d')));
            _fixAxisClip(xAx);
            g.append('g').attr('class', 'axis').call(d3.axisLeft(yScale).ticks(4).tickFormat(yFmt));

            const area = d3.area().defined(d => d.value != null)
                .x(d => xScale(d.year)).y0(ih).y1(d => yScale(d.value));
            const line = d3.line().defined(d => d.value != null)
                .x(d => xScale(d.year)).y(d => yScale(d.value));

            const tableData = allTableData[code];
            for (const f of activeFields) {
                const seriesData = tableData.map(d => ({ year: d.year, value: d[f] }));
                g.append('path').datum(seriesData).attr('d', area)
                    .attr('fill', DISPERSION_COLORS[f]).attr('fill-opacity', 0.25);
                g.append('path').datum(seriesData).attr('d', line)
                    .attr('fill', 'none').attr('stroke', DISPERSION_COLORS[f]).attr('stroke-width', 1.5);
            }

            // Year marker
            const cx = xScale(currentYear);
            g.append('line').attr('class', 'year-marker').attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', ih);

            // Legend in first cell
            if (idx === 0) {
                const legend = g.append('g').attr('transform', `translate(${iw - activeFields.length * 70}, 0)`);
                activeFields.forEach((f, li) => {
                    legend.append('rect').attr('x', li * 70).attr('y', 0).attr('width', 10).attr('height', 10)
                        .attr('fill', DISPERSION_COLORS[f]);
                    legend.append('text').attr('x', li * 70 + 14).attr('y', 9)
                        .attr('font-size', 10).attr('fill', '#666').text(DISPERSION_LABELS[f]);
                });
            }

            // Hover
            g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                .on('mousemove', function (e) {
                    const [mx] = d3.pointer(e, this);
                    const year = Math.round(xScale.invert(mx));
                    const row = tableData.find(d => d.year === year);
                    if (!row) return;
                    let html = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                    html += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                    for (const f of activeFields) {
                        const valStr = isAbs ? fmt(row[f], 0) + ' personas' : (row[f] != null ? row[f].toFixed(1) + '%' : '–');
                        html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${DISPERSION_COLORS[f]}">${DISPERSION_LABELS[f]}</span><span class="tooltip-value">${valStr}</span></div>`;
                    }
                    Tooltip.show(html, e.clientX, e.clientY);
                })
                .on('mouseout', () => Tooltip.hide());
        }
    }

    /* ══════════════════════════════════════════════════════
       RURAL/URBANO: 2-band composition (rural + urban = 100%)
       ══════════════════════════════════════════════════════ */

    function _renderRuralComposition() {
        const selected = State.get('selectedTerritories');
        const emptyEl = document.getElementById('area-empty');
        const svg = d3.select('#area-svg');
        svg.selectAll('*').remove();

        if (selected.length === 0) {
            emptyEl.textContent = 'Selecciona uno o más territorios para ver composición rural/urbano';
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        if (selected.length === 1) {
            _renderRuralSingle(svg, selected[0]);
        } else {
            _renderRuralSmallMultiples(svg, selected);
        }
    }

    function _renderRuralSingle(svg, code) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;
        const meta = DataLoader.getTerritoryMeta(code);
        const currentYear = State.get('currentYear');
        const indicator = State.get('activeIndicator');
        const isAbs = State.get('ruralUnit') === 'abs';

        const ruralSeries = DataLoader.getTimeSeries(code, indicator);
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const filtered = ruralSeries.filter(d => d.year >= rangeStart && d.year <= rangeEnd);
        if (filtered.length === 0) return;

        let popMap = null;
        if (isAbs) {
            popMap = {};
            DataLoader.getTimeSeries(code, 'habitantes')
                .filter(d => d.year >= rangeStart && d.year <= rangeEnd)
                .forEach(d => { popMap[d.year] = d.value; });
        }

        const allYears = filtered.map(d => d.year);
        const tableData = filtered.map(d => {
            const ruralPct = d.value || 0;
            const urbanoPct = Math.max(0, 100 - ruralPct);
            if (isAbs && popMap && popMap[d.year] != null) {
                const pop = popMap[d.year];
                return { year: d.year, rural: ruralPct * pop / 100, urbano: urbanoPct * pop / 100 };
            }
            return { year: d.year, rural: ruralPct, urbano: urbanoPct };
        });

        const activeRuralFields = RURAL_FIELDS.filter(f => State.get('ruralVisibleLines').includes(f));
        const yMax = isAbs
            ? d3.max(tableData, d => Math.max(...activeRuralFields.map(f => d[f]))) * 1.05
            : 105;

        const xScale = d3.scaleLinear().domain(d3.extent(allYears)).range([0, iw]);
        const yScale = d3.scaleLinear().domain([0, yMax || 105]).range([ih, 0]);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const xtks = smartXTicks(d3.extent(allYears), iw);
        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const rXAx = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(xtks).tickFormat(d3.format('d')));
        _fixAxisClip(rXAx);
        const yFmt = isAbs ? d => fmt(d, 0) : d => d.toFixed(0) + '%';
        g.append('g').attr('class', 'axis')
            .call(d3.axisLeft(yScale).ticks(6).tickFormat(yFmt));
        _addYLabel(g, isAbs ? 'personas' : '%', ih, margin.left);

        // Non-stacked individual areas (each from 0 to its value, with fill opacity)
        const area = d3.area()
            .defined(d => d.value != null)
            .x(d => xScale(d.year))
            .y0(ih)
            .y1(d => yScale(d.value));

        const line = d3.line()
            .defined(d => d.value != null)
            .x(d => xScale(d.year))
            .y(d => yScale(d.value));

        for (const f of activeRuralFields) {
            const seriesData = tableData.map(d => ({ year: d.year, value: d[f] }));
            g.append('path').datum(seriesData).attr('d', area)
                .attr('fill', RURAL_COLORS[f]).attr('fill-opacity', 0.3);
            g.append('path').datum(seriesData).attr('d', line)
                .attr('fill', 'none').attr('stroke', RURAL_COLORS[f]).attr('stroke-width', 2);
        }

        // Year marker
        const yearLine = g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih);
        const cx = xScale(currentYear);
        yearLine.attr('x1', cx).attr('x2', cx);
        svg.node().__xScale = xScale;
        svg.node().__yearLine = yearLine;

        // Hover
        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                const row = tableData.find(d => d.year === year);
                if (!row) return;
                let html = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                html += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), year);
                for (const f of activeRuralFields) {
                    const valStr = isAbs ? fmt(row[f], 0) + ' personas' : row[f].toFixed(1) + '%';
                    html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${RURAL_COLORS[f]}">${RURAL_LABELS[f]}</span><span class="tooltip-value">${valStr}</span></div>`;
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());

        // Legend
        const legend = g.append('g').attr('transform', `translate(${iw - activeRuralFields.length * 70}, 0)`);
        activeRuralFields.forEach((f, i) => {
            legend.append('rect').attr('x', i * 70).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', RURAL_COLORS[f]);
            legend.append('text').attr('x', i * 70 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(RURAL_LABELS[f]);
        });
    }

    function _renderRuralSmallMultiples(svg, selected) {
        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const indicator = State.get('activeIndicator');
        const isAbs = State.get('ruralUnit') === 'abs';
        const cols = selected.length <= 2 ? selected.length : selected.length <= 4 ? 2 : 3;
        const rows = Math.ceil(selected.length / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        const m = smMargin;
        const currentYear = State.get('currentYear');
        const activeRuralFields = RURAL_FIELDS.filter(f => State.get('ruralVisibleLines').includes(f));

        const yearSets = new Set();
        const allSeries = {};
        const allPopSeries = {};
        for (const code of selected) {
            allSeries[code] = DataLoader.getTimeSeries(code, indicator);
            for (const d of allSeries[code]) yearSets.add(d.year);
            if (isAbs) {
                allPopSeries[code] = {};
                DataLoader.getTimeSeries(code, 'habitantes').forEach(d => { allPopSeries[code][d.year] = d.value; });
            }
        }
        const [rs, re] = State.get('yearRange');
        const allYears = [...yearSets].sort((a, b) => a - b).filter(y => y >= rs && y <= re);
        if (allYears.length === 0) return;
        const xDomain = d3.extent(allYears);

        // Compute global Y max for shared scale
        let globalYMax = isAbs ? 0 : 105;
        const allTableData = {};
        for (const code of selected) {
            allTableData[code] = allYears.map(year => {
                const pt = allSeries[code].find(d => d.year === year);
                const ruralPct = pt ? (pt.value || 0) : 0;
                const urbanoPct = Math.max(0, 100 - ruralPct);
                if (isAbs && allPopSeries[code] && allPopSeries[code][year] != null) {
                    const pop = allPopSeries[code][year];
                    return { year, rural: ruralPct * pop / 100, urbano: urbanoPct * pop / 100 };
                }
                return { year, rural: ruralPct, urbano: urbanoPct };
            });
            if (isAbs) {
                for (const d of allTableData[code]) {
                    for (const f of activeRuralFields) {
                        if (d[f] > globalYMax) globalYMax = d[f];
                    }
                }
            }
        }
        if (isAbs) globalYMax *= 1.05;

        svg.node().__xScale = null;
        svg.node().__yearLine = null;

        const yFmt = isAbs ? d => fmt(d, 0) : d => d.toFixed(0) + '%';

        for (let idx = 0; idx < selected.length; idx++) {
            const code = selected[idx];
            const meta = DataLoader.getTerritoryMeta(code);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const ox = col * cellW + m.left;
            const oy = row * cellH + m.top;
            const iw = cellW - m.left - m.right;
            const ih = cellH - m.top - m.bottom - 14;

            const g = svg.append('g').attr('transform', `translate(${ox},${oy + 14})`);

            svg.append('text').attr('x', ox).attr('y', oy + 10)
                .attr('font-size', 11).attr('font-weight', 600).attr('fill', '#333')
                .text(meta ? meta.name : code);

            const tableData = allTableData[code];

            const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
            const yScale = d3.scaleLinear().domain([0, globalYMax || 105]).range([ih, 0]);

            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(3).tickSize(-iw).tickFormat(''));
            g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(smartXTicks(xDomain, iw, 50)).tickFormat(d3.format('d')));
            g.append('g').attr('class', 'axis')
                .call(d3.axisLeft(yScale).ticks(3).tickFormat(yFmt));

            const areaFn = d3.area()
                .defined(d => d.value != null)
                .x(d => xScale(d.year))
                .y0(ih)
                .y1(d => yScale(d.value));
            const lineFn = d3.line()
                .defined(d => d.value != null)
                .x(d => xScale(d.year))
                .y(d => yScale(d.value));
            for (const f of activeRuralFields) {
                const sd = tableData.map(d => ({ year: d.year, value: d[f] }));
                g.append('path').datum(sd).attr('d', areaFn)
                    .attr('fill', RURAL_COLORS[f]).attr('fill-opacity', 0.3);
                g.append('path').datum(sd).attr('d', lineFn)
                    .attr('fill', 'none').attr('stroke', RURAL_COLORS[f]).attr('stroke-width', 1.5);
            }

            const cx = xScale(currentYear);
            g.append('line').attr('class', 'year-marker')
                .attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', ih);

            // Hover per cell
            g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                .on('mousemove', function (e) {
                    const [mx] = d3.pointer(e, this);
                    const yr = Math.round(xScale.invert(mx));
                    const row = tableData.find(d => d.year === yr);
                    if (!row) return;
                    let tip = `<div class="tooltip-title">${meta ? meta.name : code}</div>`;
                    tip += fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), State.get('activeIndicator'), yr);
                    for (const f of activeRuralFields) {
                        const valStr = isAbs ? fmt(row[f], 0) + ' personas' : row[f].toFixed(1) + '%';
                        tip += `<div class="tooltip-row"><span class="tooltip-label" style="color:${RURAL_COLORS[f]}">${RURAL_LABELS[f]}</span><span class="tooltip-value">${valStr}</span></div>`;
                    }
                    Tooltip.show(tip, e.clientX, e.clientY);
                })
                .on('mouseout', () => Tooltip.hide());
        }

        // Shared legend at top
        const legend = svg.append('g').attr('transform', `translate(${w - activeRuralFields.length * 70 - 20}, 4)`);
        activeRuralFields.forEach((f, i) => {
            legend.append('rect').attr('x', i * 70).attr('y', 0).attr('width', 10).attr('height', 10)
                .attr('fill', RURAL_COLORS[f]);
            legend.append('text').attr('x', i * 70 + 14).attr('y', 9)
                .attr('font-size', 10).attr('fill', '#666').text(RURAL_LABELS[f]);
        });
    }

    /* ══════════════════════════════════════════════════════
       STANDARD: Territory stacked area (non-empleo)
       ══════════════════════════════════════════════════════ */

    function _renderTerritoryStack() {
        const selected = State.get('selectedTerritories');
        const indicator = State.get('activeIndicator');
        const emptyEl = document.getElementById('area-empty');
        const layout = State.get('chartLayout');

        if (layout === 'facet') {
            if (selected.length === 0) {
                d3.select('#area-svg').selectAll('*').remove();
                emptyEl.textContent = 'Selecciona uno o más territorios';
                emptyEl.style.display = 'flex';
                return;
            }
            emptyEl.style.display = 'none';
            _renderFacetArea(selected, indicator);
            return;
        }

        if (selected.length < 2) {
            d3.select('#area-svg').selectAll('*').remove();
            emptyEl.textContent = 'Selecciona dos o más territorios para ver composición';
            emptyEl.style.display = 'flex';
            return;
        }
        emptyEl.style.display = 'none';

        const svg = d3.select('#area-svg');
        svg.selectAll('*').remove();

        const rect = svg.node().getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;

        const [stackRs, stackRe] = State.get('yearRange');
        const years = DataLoader.getYears().filter(y => y >= stackRs && y <= stackRe);
        if (years.length === 0) return;
        const areaMode = _getAreaMode();
        const isPctComp = areaMode === 'pct_composition';
        const isPctAnd = areaMode === 'pct_andalucia';
        const isPercent = isPctComp || isPctAnd;

        const tableData = years.map(year => {
            const row = { year };
            let selTotal = 0;
            for (const code of selected) {
                const v = DataLoader.getValue(code, year, indicator);
                row[code] = v || 0;
                selTotal += (v || 0);
            }
            if (isPctComp && selTotal > 0) {
                for (const code of selected) row[code] = (row[code] / selTotal) * 100;
            } else if (isPctAnd) {
                const level = State.get('geoLevel');
                const displayLevel = level === 'region' ? 'provincia' : level;
                const andTotal = DataLoader.getLevelTotal(year, indicator, displayLevel);
                if (andTotal > 0) {
                    for (const code of selected) row[code] = (row[code] / andTotal) * 100;
                }
            }
            return row;
        }).filter(row => selected.some(c => row[c] > 0));

        const stack = d3.stack().keys(selected);
        const stacked = stack(tableData);

        const xScale = d3.scaleLinear().domain(d3.extent(tableData, d => d.year)).range([0, iw]);
        const yMax = d3.max(stacked[stacked.length - 1], d => d[1]);
        const yScale = d3.scaleLinear().domain([0, isPctComp ? 100 : yMax * 1.05]).range([ih, 0]);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const stackXTicks = smartXTicks(d3.extent(tableData, d => d.year), iw);
        g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-iw).tickFormat(''));
        const stXAx = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
            .call(d3.axisBottom(xScale).tickValues(stackXTicks).tickFormat(d3.format('d')));
        _fixAxisClip(stXAx);
        g.append('g').attr('class', 'axis')
            .call(d3.axisLeft(yScale).ticks(6).tickFormat(d => isPercent ? d.toFixed(0) + '%' : fmt(d)));
        _addYLabel(g, _getUnitLabel(), ih, margin.left);

        const area = d3.area()
            .x(d => xScale(d.data.year))
            .y0(d => yScale(d[0]))
            .y1(d => yScale(d[1]));

        g.selectAll('.area-fill').data(stacked).join('path')
            .attr('class', 'area-fill').attr('d', area)
            .attr('fill', (d, i) => territoryColor(i));

        const yearLine = g.append('line').attr('class', 'year-marker').attr('y1', 0).attr('y2', ih);
        _positionMarker(yearLine, xScale);
        svg.node().__xScale = xScale;
        svg.node().__yearLine = yearLine;

        g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
            .on('mousemove', function (e) {
                const [mx] = d3.pointer(e, this);
                const year = Math.round(xScale.invert(mx));
                const row = tableData.find(d => d.year === year);
                if (!row) return;
                const _ind = State.get('activeIndicator');
                let html = fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), _ind, year);
                for (let i = 0; i < selected.length; i++) {
                    const code = selected[i];
                    const meta = DataLoader.getTerritoryMeta(code);
                    const v = row[code];
                    html += `<div class="tooltip-row"><span class="tooltip-label" style="color:${territoryColor(i)}">${meta ? meta.name : code}</span><span class="tooltip-value">${isPercent ? v.toFixed(1) + '%' : fmtIndicator(v, _ind)}</span></div>`;
                }
                Tooltip.show(html, e.clientX, e.clientY);
            })
            .on('mouseout', () => Tooltip.hide());
    }

    /* ══════════════════════════════════════════════════════
       FACET: Individual area chart per territory
       ══════════════════════════════════════════════════════ */

    function _renderFacetArea(selected, indicator) {
        const svg = d3.select('#area-svg');
        svg.selectAll('*').remove();

        const rect = svg.node().getBoundingClientRect();
        const w = rect.width, h = rect.height;
        if (!w || !h) return;

        const currentYear = State.get('currentYear');
        const def = DataLoader.getIndicatorDef(indicator);
        const unit = def ? def.unit : '';

        // Collect all series and compute shared scales
        const allSeries = {};
        let globalYMin = Infinity, globalYMax = -Infinity;
        const yearSets = new Set();

        for (const code of selected) {
            const series = DataLoader.getTimeSeries(code, indicator);
            allSeries[code] = series;
            for (const d of series) {
                yearSets.add(d.year);
                if (d.value < globalYMin) globalYMin = d.value;
                if (d.value > globalYMax) globalYMax = d.value;
            }
        }
        if (globalYMax === -Infinity) return;
        globalYMax *= 1.05;
        if (globalYMin > 0) globalYMin = 0;

        const [facRs, facRe] = State.get('yearRange');
        const allYears = [...yearSets].sort((a, b) => a - b).filter(y => y >= facRs && y <= facRe);
        if (allYears.length === 0) return;
        const xDomain = d3.extent(allYears);

        // Grid layout
        const cols = selected.length === 1 ? 1 : selected.length <= 4 ? 2 : 3;
        const rows = Math.ceil(selected.length / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        const m = smMargin;

        svg.node().__xScale = null;
        svg.node().__yearLine = null;

        for (let idx = 0; idx < selected.length; idx++) {
            const code = selected[idx];
            const meta = DataLoader.getTerritoryMeta(code);
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const ox = col * cellW + m.left;
            const oy = row * cellH + m.top;
            const iw = cellW - m.left - m.right;
            const ih = cellH - m.top - m.bottom - 14;

            const g = svg.append('g').attr('transform', `translate(${ox},${oy + 14})`);

            // Title
            svg.append('text').attr('x', ox).attr('y', oy + 10)
                .attr('font-size', 11).attr('font-weight', 600)
                .attr('fill', territoryColor(idx))
                .text(meta ? meta.name : code);

            const xScale = d3.scaleLinear().domain(xDomain).range([0, iw]);
            let cellYMin = globalYMin, cellYMax = globalYMax;
            if (State.get('facetYAxis') === 'auto') {
                const vals = allSeries[code].filter(d => d.value != null).map(d => d.value);
                if (vals.length > 0) {
                    cellYMin = Math.min(0, d3.min(vals));
                    cellYMax = d3.max(vals) * 1.05;
                }
            }
            const yScale = d3.scaleLinear().domain([cellYMin, cellYMax]).range([ih, 0]);

            // Axes
            g.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).ticks(3).tickSize(-iw).tickFormat(''));
            g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
                .call(d3.axisBottom(xScale).tickValues(smartXTicks(xDomain, iw, 50)).tickFormat(d3.format('d')));
            g.append('g').attr('class', 'axis')
                .call(d3.axisLeft(yScale).ticks(3).tickFormat(d => fmt(d)));

            // Area fill
            const series = allSeries[code];
            const area = d3.area()
                .defined(d => d.value != null)
                .x(d => xScale(d.year))
                .y0(yScale(0))
                .y1(d => yScale(d.value));

            g.append('path').datum(series)
                .attr('d', area)
                .attr('fill', territoryColor(idx))
                .attr('opacity', 0.35);

            // Line on top
            const line = d3.line()
                .defined(d => d.value != null)
                .x(d => xScale(d.year))
                .y(d => yScale(d.value));

            g.append('path').datum(series)
                .attr('d', line)
                .attr('stroke', territoryColor(idx))
                .attr('stroke-width', 1.5)
                .attr('fill', 'none');

            // Year marker
            const cx = xScale(currentYear);
            g.append('line').attr('class', 'year-marker')
                .attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', ih);

            // Hover
            g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
                .on('mousemove', function (e) {
                    const [mx] = d3.pointer(e, this);
                    const year = Math.round(xScale.invert(mx));
                    const pt = series.find(d => d.year === year);
                    if (!pt) return;
                    Tooltip.show(
                        `<div class="tooltip-title">${meta ? meta.name : code}</div>` +
                        fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), indicator, year) +
                        `<div class="tooltip-row"><span class="tooltip-value">${fmtIndicator(pt.value, indicator)}</span></div>`,
                        e.clientX, e.clientY
                    );
                })
                .on('mouseout', () => Tooltip.hide());
        }
    }

    function _updateMarker() {
        const svg = d3.select('#area-svg').node();
        if (!svg || !svg.__xScale || !svg.__yearLine) return;
        _positionMarker(svg.__yearLine, svg.__xScale);
    }

    function _positionMarker(line, xScale) {
        const x = xScale(State.get('currentYear'));
        line.attr('x1', x).attr('x2', x);
    }

    return { init, render };
})();

export default AreaView;
