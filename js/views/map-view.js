/* map-view.js — Choropleth + bubble map with D3 + GeoJSON, dual-map comparison.
   Features: choropleth/bubble toggle, dual map via timeline handle 2, shared legend. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { buildColorScale, fmt, fmtIndicator, MAP_SCALES, isCategoricalIndicator, HAB4_CATEGORIES } from '../utils.js';

const MapView = (() => {
    // Map 1 (main)
    let _svg, _g, _gProv, _gBubbles, _projection, _path;
    // Map 2 (comparison)
    let _svg2, _g2, _gProv2, _gBubbles2, _projection2, _path2;
    let _isDual = false;

    let _features = null;
    let _initialized = false;
    let _colorFn = null;
    let _allValues = null; // cached all-years values for stable legend
    const _allValuesCache = new Map();
    let _legendKey = null; // guard: only rebuild legend when indicator/geoLevel change
    let _bubbleExtent = null; // cached min/max across all years for stable bubble sizing
    let _bubbleLegendKey = null; // guard for bubble legend

    // Centroids for bubble mode (code -> [cx, cy])
    let _centroids1 = null;
    let _centroids2 = null;

    function init() {
        if (_initialized) return;
        _initialized = true;

        _svg = d3.select('#map-svg');
        _g = _svg.append('g');
        _gProv = _svg.append('g');
        _gBubbles = _svg.append('g').attr('class', 'bubble-layer');

        _svg2 = d3.select('#map-svg-2');
        _g2 = _svg2.append('g');
        _gProv2 = _svg2.append('g');
        _gBubbles2 = _svg2.append('g').attr('class', 'bubble-layer');

        _projection = d3.geoMercator();
        _path = d3.geoPath().projection(_projection);
        _projection2 = d3.geoMercator();
        _path2 = d3.geoPath().projection(_projection2);

        State.subscribe('currentYear', render);
        State.subscribe('activeIndicator', () => { _rebuildScale(); render(); });
        State.subscribe('geoLevel', _loadFeatures);
        State.subscribe('selectedTerritories', _updateSelection);
        State.subscribe('map2Year', _onMap2YearChange);
        State.subscribe('mapMode', render);
        State.subscribe('ruralVisibleLines', render);

        const container = document.getElementById('map-container');
        new ResizeObserver(() => {
            if (_features) { _fitProjection(1); if (_isDual) _fitProjection(2); render(); }
        }).observe(container);

        document.getElementById('map2-close').addEventListener('click', () => {
            State.set('map2Year', null);
        });

        _loadFeatures();
    }

    /** React to map2Year state changes */
    function _onMap2YearChange(year) {
        if (year != null && !_isDual) {
            _isDual = true;
            _updateDualLayout();
        } else if (year == null && _isDual) {
            _isDual = false;
            _updateDualLayout();
        } else if (_isDual) {
            _renderMap2();
        }
    }

    function _updateDualLayout() {
        const pane2 = document.getElementById('map-container-2');
        pane2.style.display = _isDual ? '' : 'none';

        // Legend switching: shared legend in dual mode, per-pane in single
        const legend1 = document.getElementById('map-legend');
        const legend2 = document.getElementById('map-legend-2');
        const legendShared = document.getElementById('map-legend-shared');
        const bLegend1 = document.getElementById('map-bubble-legend');
        const bLegend2 = document.getElementById('map-bubble-legend-2');
        const bLegendShared = document.getElementById('map-bubble-legend-shared');

        if (_isDual) {
            legend1.style.display = 'none';
            legend2.style.display = 'none';
            if (bLegend1) bLegend1.style.display = 'none';
            if (bLegend2) bLegend2.style.display = 'none';
        } else {
            if (legendShared) legendShared.style.display = 'none';
            if (bLegendShared) bLegendShared.style.display = 'none';
        }

        // Force legend rebuild into correct target
        _legendKey = null;
        _bubbleLegendKey = null;

        setTimeout(() => {
            _fitProjection(1);
            if (_isDual) {
                _loadMap2Features();
                _fitProjection(2);
                _renderMap2();
            }
            render();
        }, 50);
    }

    function _getPaneYear(mapNum) {
        const year = State.get('currentYear');
        const map2Year = State.get('map2Year');
        if (!_isDual || map2Year == null) return mapNum === 2 ? map2Year : year;
        return mapNum === 1 ? Math.min(year, map2Year) : Math.max(year, map2Year);
    }

    function _fitProjection(mapNum) {
        const containerId = mapNum === 2 ? 'map-container-2' : 'map-container';
        const container = document.getElementById(containerId);
        const proj = mapNum === 2 ? _projection2 : _projection;
        const pathFn = mapNum === 2 ? _path2 : _path;
        const gMain = mapNum === 2 ? _g2 : _g;
        const gProv = mapNum === 2 ? _gProv2 : _gProv;

        const w = container.clientWidth;
        const h = container.clientHeight;
        if (!w || !h || !_features) return;

        proj.fitSize([w * 0.92, h * 0.92], _features);
        const [tx, ty] = proj.translate();
        proj.translate([tx + w * 0.04, ty + h * 0.04]);

        gMain.selectAll('path').attr('d', pathFn);
        gProv.selectAll('path').attr('d', pathFn);

        // Recompute centroids for bubble mode
        _computeCentroids(mapNum);
    }

    function _computeCentroids(mapNum) {
        const pathFn = mapNum === 2 ? _path2 : _path;
        const result = {};
        if (_features) {
            for (const f of _features.features) {
                const c = pathFn.centroid(f);
                if (c && !isNaN(c[0]) && !isNaN(c[1])) {
                    result[f.properties.code] = c;
                }
            }
        }
        if (mapNum === 2) _centroids2 = result;
        else _centroids1 = result;
    }

    function _loadFeatures() {
        const level = State.get('geoLevel');
        const displayLevel = level === 'region' ? 'provincia' : level;
        _features = DataLoader.getGeoFeatures(displayLevel);
        if (!_features) return;

        _buildMapPaths(_g, _gProv, _path, displayLevel, 1);
        if (_isDual) _loadMap2Features();

        _fitProjection(1);
        if (_isDual) _fitProjection(2);
        _rebuildScale();
        render();
    }

    function _loadMap2Features() {
        if (!_features) return;
        const level = State.get('geoLevel');
        const displayLevel = level === 'region' ? 'provincia' : level;
        _buildMapPaths(_g2, _gProv2, _path2, displayLevel, 2);
    }

    function _buildMapPaths(gMain, gProv, pathFn, displayLevel, mapNum) {
        gMain.selectAll('*').remove();
        gProv.selectAll('*').remove();

        gMain.selectAll('path')
            .data(_features.features)
            .join('path')
            .attr('class', 'territory')
            .attr('d', pathFn)
            .attr('data-code', d => d.properties.code)
            .attr('stroke', '#fff')
            .attr('stroke-width', displayLevel === 'municipio' ? 0.4 : 0.8)
            .style('cursor', 'pointer')
            .on('mouseover', (e, d) => _onHover(e, d, mapNum))
            .on('mousemove', (e, d) => _onHover(e, d, mapNum))
            .on('mouseout', () => Tooltip.hide())
            .on('click', (e, d) => State.toggleTerritory(d.properties.code));

        if (displayLevel === 'municipio' || displayLevel === 'comarca') {
            const provGeo = DataLoader.getGeoFeatures('provincia');
            if (provGeo) {
                gProv.selectAll('path')
                    .data(provGeo.features)
                    .join('path')
                    .attr('d', pathFn)
                    .attr('fill', 'none')
                    .attr('stroke', 'rgba(26,26,46,0.35)')
                    .attr('stroke-width', 1.5)
                    .attr('pointer-events', 'none');
            }
        }
    }

    /* ── Helper: collect values for a given year/indicator ── */
    function _computeValues(year, indicator) {
        const isPct = indicator.startsWith('pct_');
        const isClimate = ['tmean', 'tmin', 'tmax', 'prec'].includes(indicator);
        const allowAll = isPct || isClimate;
        const values = [];
        if (_features) {
            for (const f of _features.features) {
                const v = DataLoader.getValue(f.properties.code, year, indicator);
                if (v != null && (allowAll || v > 0)) values.push(v);
            }
        }
        return values;
    }

    /** Compute values across ALL years for a stable color scale/legend */
    function _computeAllValues(indicator) {
        const level = State.get('geoLevel');
        const displayLevel = level === 'region' ? 'provincia' : level;
        const cacheKey = `${indicator}|${displayLevel}`;
        if (_allValuesCache.has(cacheKey)) return _allValuesCache.get(cacheKey);

        const years = DataLoader.getYears();
        const isPct = indicator.startsWith('pct_');
        const isClimate = ['tmean', 'tmin', 'tmax', 'prec'].includes(indicator);
        const allowAll = isPct || isClimate;
        const values = [];
        if (_features) {
            for (const f of _features.features) {
                const code = f.properties.code;
                for (const y of years) {
                    const v = DataLoader.getValue(code, y, indicator);
                    if (v != null && (allowAll || v > 0)) values.push(v);
                }
            }
        }
        _allValuesCache.set(cacheKey, values);
        return values;
    }

    /** Rebuild color scale and legend (called on indicator/geoLevel change) */
    function _rebuildScale() {
        const indicator = State.get('activeIndicator');
        _allValues = _computeValues(State.get('currentYear'), indicator);
        _colorFn = buildColorScale(indicator, _allValues);
        // Stable bubble extent from all years
        const BUBBLE_IND = new Set(['habitantes', 'densidad', 'pob_agrupada', 'pob_dispersa']);
        if (BUBBLE_IND.has(indicator)) {
            const pos = _computeAllValues(indicator).filter(v => v > 0);
            _bubbleExtent = pos.length > 0 ? d3.extent(pos) : null;
        } else {
            _bubbleExtent = null;
        }
        _legendKey = null; // force legend rebuild
        _bubbleLegendKey = null;
        _buildLegend(1);
        _buildLegend(2);
    }

    /* ── Main render ── */
    function render() {
        const year = State.get('currentYear');
        const indicator = State.get('activeIndicator');
        const map2Year = State.get('map2Year');
        const mode = State.get('mapMode');
        const isCat = isCategoricalIndicator(indicator);

        // Bubble mode only for population-type indicators
        const BUBBLE_INDICATORS = new Set(['habitantes', 'densidad', 'pob_agrupada', 'pob_dispersa']);
        const canBubble = !isCat && BUBBLE_INDICATORS.has(indicator);
        if (!canBubble && mode === 'bubble') {
            State.set('mapMode', 'choropleth');
        }
        const effectiveMode = canBubble ? mode : 'choropleth';

        // Clamp map2Year to available years
        if (map2Year != null) {
            const years = DataLoader.getYears();
            if (years.length > 0) {
                if (map2Year < years[0]) State.set('map2Year', years[0]);
                if (map2Year > years[years.length - 1]) State.set('map2Year', years[years.length - 1]);
            }
        }

        // Use cached color scale (rebuilt on indicator/geoLevel change for stability)
        if (!_colorFn) {
            _allValues = _computeValues(State.get('currentYear'), indicator);
            _colorFn = buildColorScale(indicator, _allValues);
        }

        const paneYear = _getPaneYear(1);
        document.getElementById('map-year').textContent = paneYear;

        if (effectiveMode === 'bubble') {
            // Bubble mode: gray background + circles
            _g.selectAll('path.territory').attr('fill', '#f2f2f2');
            _gBubbles.style('display', null);
            const result = _renderBubbles(1);
            _buildBubbleLegend(1, result);
            if (!_isDual) {
                document.getElementById('map-legend').style.display = 'none';
                const bleg = document.getElementById('map-bubble-legend');
                if (bleg) bleg.style.display = '';
            }
        } else {
            // Choropleth mode
            const isRuralInd = indicator.startsWith('pct_rural_');
            const ruralVis = isRuralInd ? State.get('ruralVisibleLines') : null;
            _g.selectAll('path.territory')
                .attr('fill', d => {
                    const val = DataLoader.getValue(d.properties.code, paneYear, indicator);
                    if (isRuralInd && val != null && ruralVis) {
                        const isRural = val >= 50;
                        if (isRural && !ruralVis.includes('rural')) return '#e8e6e1';
                        if (!isRural && !ruralVis.includes('urbano')) return '#e8e6e1';
                    }
                    return _colorFn(val);
                });
            _gBubbles.selectAll('*').remove();
            if (!_isDual) {
                document.getElementById('map-legend').style.display = '';
                const bleg = document.getElementById('map-bubble-legend');
                if (bleg) bleg.style.display = 'none';
            }
        }

        _updateSelection();

        if (_isDual) _renderMap2();
    }

    function _renderMap2() {
        const indicator = State.get('activeIndicator');
        const year2 = _getPaneYear(2);
        if (year2 == null) return;
        const mode = State.get('mapMode');
        const isCat = isCategoricalIndicator(indicator);
        const BUBBLE_INDICATORS = new Set(['habitantes', 'densidad', 'pob_agrupada', 'pob_dispersa']);
        const canBubble = !isCat && BUBBLE_INDICATORS.has(indicator);
        const effectiveMode = canBubble ? mode : 'choropleth';

        document.getElementById('map-year-2').textContent = year2;

        if (effectiveMode === 'bubble') {
            _g2.selectAll('path.territory').attr('fill', '#f2f2f2');
            _gBubbles2.style('display', null);
            const result = _renderBubbles(2);
            _buildBubbleLegend(2, result);
        } else {
            // Use shared _colorFn
            const isRuralInd2 = indicator.startsWith('pct_rural_');
            const ruralVis2 = isRuralInd2 ? State.get('ruralVisibleLines') : null;
            _g2.selectAll('path.territory')
                .attr('fill', d => {
                    const val = DataLoader.getValue(d.properties.code, year2, indicator);
                    if (isRuralInd2 && val != null && ruralVis2) {
                        const isRural = val >= 50;
                        if (isRural && !ruralVis2.includes('rural')) return '#e8e6e1';
                        if (!isRural && !ruralVis2.includes('urbano')) return '#e8e6e1';
                    }
                    return _colorFn(val);
                });
            _gBubbles2.selectAll('*').remove();
        }

        // Selection on map 2
        const selected = State.get('selectedTerritories');
        _g2.selectAll('path.territory')
            .attr('stroke', d => selected.includes(d.properties.code) ? '#1a1a2e' : '#fff')
            .attr('stroke-width', d => {
                if (selected.includes(d.properties.code)) return 2.5;
                const level = State.get('geoLevel');
                return (level === 'municipio' || level === 'region') ? 0.4 : 0.8;
            });

        if (effectiveMode === 'bubble') {
            _gBubbles2.selectAll('circle.bubble-circle')
                .attr('stroke-width', d => selected.includes(d.code) ? 3 : 1.5)
                .attr('stroke', d => selected.includes(d.code) ? '#1a1a2e' : (_colorFn ? _colorFn(d.value) : '#666'));
        }
    }

    function _updateSelection() {
        const selected = State.get('selectedTerritories');
        const mode = State.get('mapMode');
        const indicator = State.get('activeIndicator');
        const isCat = isCategoricalIndicator(indicator);
        const BUBBLE_INDICATORS = new Set(['habitantes', 'densidad', 'pob_agrupada', 'pob_dispersa']);
        const canBubble = !isCat && BUBBLE_INDICATORS.has(indicator);
        const effectiveMode = canBubble ? mode : 'choropleth';

        _g.selectAll('path.territory')
            .attr('stroke', d => selected.includes(d.properties.code) ? '#1a1a2e' : '#fff')
            .attr('stroke-width', d => {
                if (selected.includes(d.properties.code)) return 2.5;
                const level = State.get('geoLevel');
                return (level === 'municipio' || level === 'region') ? 0.4 : 0.8;
            });

        if (effectiveMode === 'bubble') {
            _gBubbles.selectAll('circle.bubble-circle')
                .attr('stroke-width', d => selected.includes(d.code) ? 3 : 1.5)
                .attr('stroke', d => selected.includes(d.code) ? '#1a1a2e' : (_colorFn ? _colorFn(d.value) : '#666'));
        }
    }

    function _onHover(e, d, mapNum) {
        const code = d.properties ? d.properties.code : d.code;
        const name = d.properties ? d.properties.name : (DataLoader.getTerritoryMeta(code) || {}).name || code;
        const year = _getPaneYear(mapNum) || State.get('currentYear');
        const indicator = State.get('activeIndicator');
        const val = DataLoader.getValue(code, year, indicator);
        const t = DataLoader.getTerritoryMeta(code);

        const def = DataLoader.getIndicatorDef(indicator);
        const indLabel = def ? def.label : indicator;
        // fmtIndicator already includes unit (%, °C, mm) — don't double-append
        const formatted = fmtIndicator(val, indicator);
        let html = `<div class="tooltip-title">${name}</div>`;
        if (t && t.provincia) html += `<div class="tooltip-row"><span class="tooltip-label">Provincia</span><span class="tooltip-value">${t.provincia}</span></div>`;
        html += `<div class="tooltip-row"><span class="tooltip-label">${indLabel} (${year})</span><span class="tooltip-value">${formatted}</span></div>`;

        // Rural indicators at municipio level: show extra context
        const isRural = indicator.startsWith('pct_rural_');
        if (isRural && State.get('geoLevel') === 'municipio') {
            // Classification
            if (val != null) {
                const cls = val >= 50 ? 'Rural' : 'Urbano';
                const clsColor = val >= 50 ? '#d95f02' : '#1b9e77';
                html += `<div class="tooltip-row"><span class="tooltip-label">Clasificación</span><span class="tooltip-value" style="color:${clsColor};font-weight:600">${cls}</span></div>`;
            }
            // Population
            const pop = DataLoader.getValue(code, year, 'habitantes');
            if (pop != null) html += `<div class="tooltip-row"><span class="tooltip-label">Habitantes</span><span class="tooltip-value">${fmt(pop, 0)}</span></div>`;
            // Núcleo population (if indicator uses núcleo threshold)
            if (indicator.includes('_nuc')) {
                const nucPop = DataLoader.getValue(code, year, 'pob_agrupada');
                if (nucPop != null) html += `<div class="tooltip-row"><span class="tooltip-label">Hab. núcleo principal</span><span class="tooltip-value">${fmt(nucPop, 0)}</span></div>`;
            }
            // Agricultural workers %
            const pctAgr = DataLoader.getValue(code, year, 'pct_agr');
            if (pctAgr != null) html += `<div class="tooltip-row"><span class="tooltip-label">% ocupados agrarios</span><span class="tooltip-value">${pctAgr.toFixed(1)}%</span></div>`;
        }

        if (t && t.area_km2) html += `<div class="tooltip-row"><span class="tooltip-label">Superficie</span><span class="tooltip-value">${fmt(t.area_km2, 1)} km²</span></div>`;

        Tooltip.show(html, e.clientX, e.clientY);
    }

    /* ── Bubble map rendering ── */
    function _renderBubbles(mapNum) {
        const indicator = State.get('activeIndicator');
        const year = _getPaneYear(mapNum) || State.get('currentYear');
        const gBub = mapNum === 2 ? _gBubbles2 : _gBubbles;
        const centroids = mapNum === 2 ? _centroids2 : _centroids1;

        if (!_features || !centroids) { gBub.selectAll('*').remove(); return null; }

        const isPct = indicator.startsWith('pct_');
        const isClimate = ['tmean', 'tmin', 'tmax', 'prec'].includes(indicator);
        const allowAll = isPct || isClimate;

        const dataArr = _features.features.map(f => {
            const code = f.properties.code;
            const v = DataLoader.getValue(code, year, indicator);
            const pos = centroids[code];
            return { feature: f, code, value: v, cx: pos ? pos[0] : null, cy: pos ? pos[1] : null };
        }).filter(d => d.cx != null && d.cy != null);

        const validValues = dataArr.map(d => d.value).filter(v => v != null && (allowAll || v > 0));
        if (validValues.length === 0) { gBub.selectAll('*').remove(); return null; }

        const extent = _bubbleExtent || d3.extent(validValues.filter(v => v > 0));
        if (!extent[0]) { gBub.selectAll('*').remove(); return null; }

        const radiusScale = d3.scaleSqrt()
            .domain([extent[0], extent[1]])
            .range([2, 25])
            .clamp(true);

        // Sort: larger circles behind
        dataArr.sort((a, b) => (Math.abs(b.value) || 0) - (Math.abs(a.value) || 0));

        gBub.selectAll('circle.bubble-circle').remove();

        for (const d of dataArr) {
            const v = d.value;
            if (v == null || (!allowAll && v <= 0)) continue;
            const r = radiusScale(Math.abs(v));
            if (r < 0.5) continue;

            gBub.append('circle')
                .attr('class', 'bubble-circle')
                .datum(d)
                .attr('cx', d.cx)
                .attr('cy', d.cy)
                .attr('r', r)
                .attr('fill', 'transparent')
                .attr('stroke', _colorFn ? _colorFn(v) : '#666')
                .attr('stroke-width', 1.5)
                .on('mouseover', (e) => _onHover(e, d, mapNum))
                .on('mousemove', (e) => _onHover(e, d, mapNum))
                .on('mouseout', () => Tooltip.hide())
                .on('click', () => State.toggleTerritory(d.code));
        }

        return { radiusScale, validValues };
    }

    function _buildBubbleLegend(mapNum, result) {
        // In dual mode, use shared bubble legend
        let legendId;
        if (_isDual) {
            legendId = 'map-bubble-legend-shared';
            const bl1 = document.getElementById('map-bubble-legend');
            const bl2 = document.getElementById('map-bubble-legend-2');
            if (bl1) bl1.style.display = 'none';
            if (bl2) bl2.style.display = 'none';
        } else {
            legendId = mapNum === 2 ? 'map-bubble-legend-2' : 'map-bubble-legend';
            const bls = document.getElementById('map-bubble-legend-shared');
            if (bls) bls.style.display = 'none';
        }
        const el = document.getElementById(legendId);
        if (!el || !result) { if (el) el.style.display = 'none'; return; }

        // Guard: skip rebuild if already built for this indicator+geoLevel
        const indicator = State.get('activeIndicator');
        const geoLevel = State.get('geoLevel');
        const bKey = indicator + '|' + geoLevel + '|bubble';
        if (_bubbleLegendKey === bKey) return;
        if (mapNum === 2 || !_isDual) _bubbleLegendKey = bKey;

        const { radiusScale } = result;
        // Use all-years values for stable legend across timelapse
        const allPositive = (_allValues || []).filter(v => v > 0);
        if (allPositive.length === 0) { el.style.display = 'none'; return; }

        const sorted = [...allPositive].sort((a, b) => a - b);
        const def = DataLoader.getIndicatorDef(indicator);
        const label = def ? def.label : indicator;

        // 3 reference values
        const small = sorted[Math.floor(sorted.length * 0.1)];
        const medium = sorted[Math.floor(sorted.length * 0.5)];
        const large = sorted[Math.floor(sorted.length * 0.95)];
        const refs = [large, medium, small];

        const maxR = radiusScale(large);
        const svgW = Math.max(230, maxR * 2 + 150);
        const rowH = Math.max(24, maxR * 0.72);
        const svgH = rowH * refs.length + 8;

        let html = `<div class="map-bubble-legend-title">${label}</div>`;
        html += `<svg class="map-bubble-legend-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" aria-hidden="true">`;

        refs.forEach((v, i) => {
            const r = radiusScale(v);
            const cy = 6 + i * rowH + rowH / 2;
            const cx = maxR + 4;
            const labelX = maxR * 2 + 22;
            html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#52625f" stroke-width="1"/>`;
            html += `<line x1="${cx + r + 5}" y1="${cy}" x2="${labelX - 8}" y2="${cy}" stroke="#c4cbc6" stroke-width="1"/>`;
            html += `<text x="${labelX}" y="${cy + 3.5}" fill="#52625f" font-size="10">${fmtIndicator(v, indicator)}</text>`;
        });
        html += `</svg>`;

        el.innerHTML = html;
        el.style.display = '';
    }

    /* ── Choropleth legend ── */
    function _buildLegend(mapNum) {
        const indicator = State.get('activeIndicator');
        const geoLevel = State.get('geoLevel');
        const key = indicator + '|' + geoLevel;
        // Guard: skip rebuild if legend is already built for this indicator+geoLevel
        if (_legendKey === key) return;
        if (mapNum === 2 || !_isDual) _legendKey = key;

        let cfg = MAP_SCALES[indicator] || MAP_SCALES.habitantes;
        if (cfg.type === 'alias') cfg = MAP_SCALES[cfg.aliasOf] || MAP_SCALES.habitantes;

        // In dual mode, use shared legend; otherwise per-pane
        let legendId;
        if (_isDual) {
            legendId = 'map-legend-shared';
            document.getElementById('map-legend').style.display = 'none';
            document.getElementById('map-legend-2').style.display = 'none';
        } else {
            legendId = mapNum === 2 ? 'map-legend-2' : 'map-legend';
            const shared = document.getElementById('map-legend-shared');
            if (shared) shared.style.display = 'none';
        }
        const el = document.getElementById(legendId);
        if (!el) return;

        // Categorical legend: discrete swatches
        if (cfg.type === 'categorical') {
            let html = `<div class="map-legend-title">${cfg.label}</div><div class="map-legend-categorical">`;
            for (const cat of cfg.categories) {
                html += `<span class="map-legend-cat-item"><span class="map-legend-cat-swatch" style="background:${cat.color}"></span>${cat.label}</span>`;
            }
            html += `</div>`;
            el.innerHTML = html;
            el.style.display = '';
            return;
        }

        // Dichotomous legend: two boxes with labels (Rural/Urbano)
        if (cfg.dichotomous) {
            let html = `<div class="map-legend-title">${cfg.label}</div><div class="map-legend-categorical">`;
            for (let i = 0; i < cfg.colors.length; i++) {
                html += `<span class="map-legend-cat-item"><span class="map-legend-cat-swatch" style="background:${cfg.colors[i]}"></span>${cfg.labels[i]}</span>`;
            }
            html += `<span class="map-legend-cat-item"><span class="map-legend-cat-swatch" style="background:#e8e6e1"></span>Sin dato</span>`;
            html += `</div>`;
            el.innerHTML = html;
            el.style.display = '';
            return;
        }

        // Use the visible year for the legend to keep initial paint responsive.
        let values = _computeValues(State.get('currentYear'), indicator);
        values.sort((a, b) => a - b);

        const isPct = indicator.startsWith('pct_');
        const isClimate = ['tmean', 'tmin', 'tmax', 'prec'].includes(indicator);

        const colorFn = buildColorScale(indicator, values);
        let steps;
        if (cfg.fixed) {
            // Fixed-domain indicators: evenly-spaced steps from domain
            steps = d3.range(8).map(i => cfg.domain[0] + i / 7 * (cfg.domain[1] - cfg.domain[0]));
        } else {
            steps = values.length > 8
                ? d3.range(8).map(i => values[Math.floor(i / 7 * (values.length - 1))])
                : values.length > 0 ? values : _logSteps(cfg.domain[0], cfg.domain[1], 8);
        }

        const fmtLegend = isPct ? v => v.toFixed(0) + '%'
            : isClimate ? v => (indicator === 'prec' ? Math.round(v) + ' mm' : v.toFixed(1) + ' °C')
            : v => fmt(v);
        let html = `<div class="map-legend-title">${cfg.label}</div><div class="map-legend-row">`;
        for (const v of steps) {
            html += `<div class="map-legend-cell" style="background:${colorFn(v)}"></div>`;
        }
        html += `</div><div class="map-legend-labels">`;
        for (let i = 0; i < steps.length; i++) {
            const show = i === 0 || i === steps.length - 1 || i === Math.floor(steps.length / 2);
            html += `<span>${show ? fmtLegend(steps[i]) : ''}</span>`;
        }
        html += `</div>`;
        el.innerHTML = html;
        el.style.display = '';
    }

    function _logSteps(min, max, n) {
        const logMin = Math.log10(min);
        const logMax = Math.log10(max);
        const step = (logMax - logMin) / (n - 1);
        return d3.range(n).map(i => Math.pow(10, logMin + i * step));
    }

    return { init, render };
})();

export default MapView;
