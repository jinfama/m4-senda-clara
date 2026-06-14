/* palimpsesto-view.js — Layered transport map ("Palimpsesto").
   Shows Andalusia province boundaries as context, overlaid with
   transport GeoJSON layers that can be toggled on/off.
   Includes timeline for temporal layers (ferrocarril, carreteras JRC, aeropuertos). */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';

const PalimpsestoView = (() => {
    let _svg, _gBase, _gLayers, _projection, _path;
    let _initialized = false;
    let _layerGroups = [];       // from metadata
    let _activeLayers = new Set(); // layer ids currently visible
    let _loadedData = {};        // layerId -> GeoJSON FeatureCollection
    let _loadingSet = new Set(); // layerIds currently being fetched

    // Timeline state
    let _timelineYear = null;    // current year shown (null = no filtering)
    let _timelineMin = null;
    let _timelineMax = null;
    let _playing = false;
    let _playTimer = null;
    const PLAY_INTERVAL = 350;   // ms per year step

    function init() {
        if (_initialized) return;
        _initialized = true;

        _svg = d3.select('#palimpsesto-svg');
        _gBase = _svg.append('g').attr('class', 'base-layer');
        _gLayers = _svg.append('g').attr('class', 'transport-layers');

        _projection = d3.geoMercator();
        _path = d3.geoPath().projection(_projection);

        // Read layer groups from metadata
        const meta = DataLoader.getMeta();
        const cat = meta.categories.find(c => c.id === 'transportes');
        _layerGroups = (cat && cat.layerGroups) || [];

        // Resize observer
        const container = document.getElementById('palimpsesto-map');
        if (container) {
            new ResizeObserver(() => {
                _fitProjection();
                _renderBase();
                _renderLayers();
            }).observe(container);
        }

        _wireTimeline();
        _buildSidebar();
        _fitProjection();
        _renderBase();

        // Enable first group's first layer by default
        if (_layerGroups.length > 0 && _layerGroups[0].layers.length > 0) {
            _toggleLayer(_layerGroups[0].layers[0].id);
        }
    }

    function _fitProjection() {
        const container = document.getElementById('palimpsesto-map');
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;

        const provGeo = DataLoader.getGeoFeatures('provincia');
        if (!provGeo) return;

        _projection.fitSize([w, h], provGeo);
        _path = d3.geoPath().projection(_projection);
    }

    function _renderBase() {
        const provGeo = DataLoader.getGeoFeatures('provincia');
        if (!provGeo) return;

        const paths = _gBase.selectAll('path.base-province')
            .data(provGeo.features, d => d.properties.code || d.properties.codigo);

        paths.enter()
            .append('path')
            .attr('class', 'base-province')
            .merge(paths)
            .attr('d', _path);

        paths.exit().remove();
    }

    /* ── Layer rendering with temporal filtering ── */

    function _renderLayers() {
        _gLayers.selectAll('g.transport-group').remove();

        for (const group of _layerGroups) {
            for (const layer of group.layers) {
                if (!_activeLayers.has(layer.id)) continue;
                const data = _loadedData[layer.id];
                if (!data) continue;

                // Filter features by current timeline year
                const filtered = _filterByYear(data, layer);

                const g = _gLayers.append('g')
                    .attr('class', 'transport-group')
                    .attr('data-layer', layer.id);

                if (layer.geomType === 'point') {
                    _renderPoints(g, filtered, group.color, layer);
                } else {
                    _renderLines(g, filtered, group.color, layer);
                }
            }
        }
    }

    /** Filter a GeoJSON FeatureCollection based on temporal metadata and _timelineYear */
    function _filterByYear(geojson, layer) {
        if (_timelineYear === null || !layer.temporal) return geojson;

        const year = _timelineYear;
        const t = layer.temporal;
        let features;

        if (t.type === 'range') {
            // range: feature visible when anio_apertura <= year AND (anio_cierre == 0 or null or >= year)
            features = geojson.features.filter(f => {
                const p = f.properties;
                const start = +p[t.startField];
                const end = +p[t.endField];
                if (!start || start > year) return false;
                if (end && end > 0 && end < year) return false;
                return true;
            });
        } else if (t.type === 'snapshots') {
            // snapshots: find the nearest snapshot year <= current year
            const snapYears = t.years || [];
            let snapYear = null;
            for (const sy of snapYears) {
                if (sy <= year) snapYear = sy;
            }
            if (snapYear === null) {
                features = []; // before first snapshot
            } else {
                const field = (t.existsPrefix || 'existe_') + snapYear;
                features = geojson.features.filter(f => {
                    const val = f.properties[field];
                    return val === 1 || val === '1' || val === true || val === 'true' || val === 'si' || val === 'Sí';
                });
            }
        } else {
            features = geojson.features;
        }

        return { type: 'FeatureCollection', features };
    }

    function _renderLines(g, geojson, color, layer) {
        g.selectAll('path')
            .data(geojson.features)
            .enter()
            .append('path')
            .attr('d', _path)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 1.2)
            .attr('stroke-opacity', 0.7)
            .attr('stroke-linecap', 'round')
            .on('mouseenter', (event, d) => {
                d3.select(event.currentTarget).attr('stroke-width', 3).attr('stroke-opacity', 1);
                const props = d.properties;
                const name = props.nombre || props.tipo || props.categoria || layer.label;
                let html = `<b>${name}</b>`;
                if (props.longitud_km) html += `<br>${(+props.longitud_km).toFixed(1)} km`;
                if (props.periodo) html += `<br>${props.periodo}`;
                if (props.clase) html += `<br>${props.clase}`;
                if (props.anio_apertura) html += `<br>Apertura: ${props.anio_apertura}`;
                if (props.anio_cierre && +props.anio_cierre > 0) html += `<br>Cierre: ${props.anio_cierre}`;
                Tooltip.show(html, event.clientX, event.clientY);
            })
            .on('mouseleave', (event) => {
                d3.select(event.currentTarget).attr('stroke-width', 1.2).attr('stroke-opacity', 0.7);
                Tooltip.hide();
            });
    }

    function _renderPoints(g, geojson, color, layer) {
        g.selectAll('circle')
            .data(geojson.features.filter(f => {
                const c = _getCoords(f);
                return c && _projection(c);
            }))
            .enter()
            .append('circle')
            .attr('cx', d => _projection(_getCoords(d))[0])
            .attr('cy', d => _projection(_getCoords(d))[1])
            .attr('r', 4)
            .attr('fill', color)
            .attr('fill-opacity', 0.8)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
            .on('mouseenter', (event, d) => {
                d3.select(event.currentTarget).attr('r', 7).attr('fill-opacity', 1);
                const props = d.properties;
                const name = props.nombre || props.codigo_iata || layer.label;
                let html = `<b>${name}</b>`;
                if (props.tipo) html += `<br>${props.tipo}`;
                if (props.tipo_puerto) html += `<br>${props.tipo_puerto}`;
                if (props.anio_apertura) html += `<br>Apertura: ${props.anio_apertura}`;
                if (props.anio_cierre && +props.anio_cierre > 0) html += `<br>Cierre: ${props.anio_cierre}`;
                if (props.anio_instalacion) html += `<br>Instalación: ${props.anio_instalacion}`;
                Tooltip.show(html, event.clientX, event.clientY);
            })
            .on('mouseleave', (event) => {
                d3.select(event.currentTarget).attr('r', 4).attr('fill-opacity', 0.8);
                Tooltip.hide();
            });
    }

    function _getCoords(feature) {
        const g = feature.geometry;
        if (!g) return null;
        if (g.type === 'Point') return g.coordinates;
        if (g.type === 'MultiPoint') return g.coordinates[0];
        return null;
    }

    /* ── Timeline controls ── */

    function _wireTimeline() {
        const playBtn = document.getElementById('palimpsesto-play');
        const slider = document.getElementById('palimpsesto-slider');

        if (playBtn) {
            playBtn.addEventListener('click', () => {
                if (_playing) _stopPlay(); else _startPlay();
            });
        }
        if (slider) {
            slider.addEventListener('input', () => {
                _timelineYear = +slider.value;
                _updateTimelineUI();
                _renderLayers();
            });
        }
    }

    /** Scan active layers for temporal info and compute the overall year range */
    function _computeTimeRange() {
        let min = Infinity, max = -Infinity;
        let hasTemporal = false;

        for (const group of _layerGroups) {
            for (const layer of group.layers) {
                if (!_activeLayers.has(layer.id)) continue;
                if (!layer.temporal) continue;
                hasTemporal = true;

                const t = layer.temporal;
                if (t.type === 'range') {
                    // Scan loaded data for actual year range
                    const data = _loadedData[layer.id];
                    if (data) {
                        for (const f of data.features) {
                            const s = +f.properties[t.startField];
                            const e = +f.properties[t.endField];
                            if (s && s > 0) { min = Math.min(min, s); max = Math.max(max, s); }
                            if (e && e > 0) max = Math.max(max, e);
                        }
                    }
                } else if (t.type === 'snapshots') {
                    const years = t.years || [];
                    if (years.length > 0) {
                        min = Math.min(min, years[0]);
                        max = Math.max(max, years[years.length - 1]);
                    }
                }
            }
        }

        if (!hasTemporal || min === Infinity) return null;
        return { min, max };
    }

    function _syncTimeline() {
        const range = _computeTimeRange();
        const tlEl = document.getElementById('palimpsesto-timeline');
        const yearLabel = document.getElementById('palimpsesto-year-label');

        if (!range) {
            // No temporal layers active — hide timeline
            if (tlEl) tlEl.style.display = 'none';
            if (yearLabel) yearLabel.style.display = 'none';
            _timelineYear = null;
            _timelineMin = null;
            _timelineMax = null;
            _stopPlay();
            return;
        }

        _timelineMin = range.min;
        _timelineMax = range.max;

        // Initialize year if needed
        if (_timelineYear === null || _timelineYear < _timelineMin || _timelineYear > _timelineMax) {
            _timelineYear = _timelineMin;
        }

        // Show and configure slider
        if (tlEl) tlEl.style.display = '';
        const slider = document.getElementById('palimpsesto-slider');
        if (slider) {
            slider.min = _timelineMin;
            slider.max = _timelineMax;
            slider.value = _timelineYear;
        }

        _updateTimelineUI();
    }

    function _updateTimelineUI() {
        const startEl = document.getElementById('palimpsesto-tl-start');
        const endEl = document.getElementById('palimpsesto-tl-end');
        const currentEl = document.getElementById('palimpsesto-tl-current');
        const yearLabel = document.getElementById('palimpsesto-year-label');

        if (startEl) startEl.textContent = _timelineMin || '';
        if (endEl) endEl.textContent = _timelineMax || '';
        if (currentEl) currentEl.textContent = _timelineYear || '';
        if (yearLabel && _timelineYear !== null) {
            yearLabel.textContent = _timelineYear;
            yearLabel.style.display = '';
        }
    }

    function _startPlay() {
        if (_playing) return;
        if (_timelineMin === null) return;
        _playing = true;

        const playBtn = document.getElementById('palimpsesto-play');
        if (playBtn) {
            playBtn.classList.add('playing');
            playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        }

        // If at the end, restart
        if (_timelineYear >= _timelineMax) {
            _timelineYear = _timelineMin;
        }

        _playTimer = setInterval(() => {
            _timelineYear++;
            if (_timelineYear > _timelineMax) {
                _stopPlay();
                return;
            }
            const slider = document.getElementById('palimpsesto-slider');
            if (slider) slider.value = _timelineYear;
            _updateTimelineUI();
            _renderLayers();
        }, PLAY_INTERVAL);
    }

    function _stopPlay() {
        _playing = false;
        if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }

        const playBtn = document.getElementById('palimpsesto-play');
        if (playBtn) {
            playBtn.classList.remove('playing');
            playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
        }
    }

    /* ── Sidebar layer controls ── */
    function _buildSidebar() {
        const sidebar = document.getElementById('palimpsesto-sidebar');
        if (!sidebar) return;

        let html = '<div class="palimpsesto-title">Capas de transporte</div>';

        for (const group of _layerGroups) {
            html += `<div class="palimpsesto-group" data-group="${group.id}">`;
            html += `<div class="palimpsesto-group-header" data-group="${group.id}">`;
            html += `<span class="palimpsesto-group-swatch" style="background:${group.color}"></span>`;
            html += `<span>${group.label}</span>`;
            html += `<span class="palimpsesto-group-arrow">&#9654;</span>`;
            html += `</div>`;
            html += `<div class="palimpsesto-group-layers">`;
            for (const layer of group.layers) {
                const temporalBadge = layer.temporal
                    ? ' <span class="palimpsesto-layer-badge" title="Capa temporal">&#9202;</span>'
                    : '';
                html += `<div class="palimpsesto-layer" data-layer="${layer.id}" style="--layer-color:${group.color}">`;
                html += `<span class="palimpsesto-layer-check" aria-hidden="true"></span>`;
                html += `<span class="palimpsesto-layer-name">${layer.label}${temporalBadge}</span>`;
                html += `</div>`;
            }
            html += `</div></div>`;
        }

        sidebar.innerHTML = html;

        // Wire group header toggle
        sidebar.querySelectorAll('.palimpsesto-group-header').forEach(el => {
            el.addEventListener('click', () => {
                el.closest('.palimpsesto-group').classList.toggle('open');
            });
        });

        // Wire layer toggle
        sidebar.querySelectorAll('.palimpsesto-layer').forEach(el => {
            el.addEventListener('click', () => {
                _toggleLayer(el.dataset.layer);
            });
        });

        // Open first group by default
        const first = sidebar.querySelector('.palimpsesto-group');
        if (first) first.classList.add('open');
    }

    function _toggleLayer(layerId) {
        if (_activeLayers.has(layerId)) {
            _activeLayers.delete(layerId);
            _updateSidebarState();
            _syncTimeline();
            _renderLayers();
        } else {
            _activeLayers.add(layerId);
            _updateSidebarState();
            if (_loadedData[layerId]) {
                _syncTimeline();
                _renderLayers();
            } else {
                _loadLayerData(layerId);
            }
        }
    }

    function _loadLayerData(layerId) {
        let layerDef = null;
        for (const g of _layerGroups) {
            for (const l of g.layers) {
                if (l.id === layerId) { layerDef = l; break; }
            }
            if (layerDef) break;
        }
        if (!layerDef) return;

        _loadingSet.add(layerId);
        _showLoading();

        fetch(layerDef.file)
            .then(r => r.json())
            .then(geojson => {
                _loadedData[layerId] = geojson;
                _loadingSet.delete(layerId);
                _showLoading();
                if (_activeLayers.has(layerId)) {
                    _syncTimeline();
                    _renderLayers();
                }
            })
            .catch(err => {
                console.error(`Failed to load layer ${layerId}:`, err);
                _loadingSet.delete(layerId);
                _activeLayers.delete(layerId);
                _updateSidebarState();
                _showLoading();
            });
    }

    function _showLoading() {
        let el = document.querySelector('.palimpsesto-loading');
        if (_loadingSet.size > 0) {
            if (!el) {
                el = document.createElement('div');
                el.className = 'palimpsesto-loading';
                document.getElementById('palimpsesto-map').appendChild(el);
            }
            el.textContent = `Cargando ${_loadingSet.size} capa${_loadingSet.size > 1 ? 's' : ''}...`;
        } else if (el) {
            el.remove();
        }
    }

    function _updateSidebarState() {
        document.querySelectorAll('.palimpsesto-layer').forEach(el => {
            el.classList.toggle('active', _activeLayers.has(el.dataset.layer));
        });
    }

    function render() {
        if (State.get('activeView') !== 'palimpsesto') return;
        _fitProjection();
        _renderBase();
        _renderLayers();
    }

    return { init, render };
})();

export default PalimpsestoView;
