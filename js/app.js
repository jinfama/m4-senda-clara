/* app.js — Application entry point */
import State from './state.js';
import DataLoader from './data-loader.js';
import { CATEGORY_ICONS, VIEW_ICONS, territoryColor } from './utils.js';
import Tooltip from './components/tooltip.js';
import Timeline from './components/timeline.js';
import TerritoryPicker from './components/territory-picker.js';
import MapView from './views/map-view.js';
import LineView from './views/line-view.js';
import AreaView from './views/area-view.js';
import RankingView from './views/ranking-view.js';
import TableView from './views/table-view.js';
import StripesView from './views/stripes-view.js';
import ClimogramView from './views/climogram-view.js';
import SpaghettiView from './views/spaghetti-view.js';
import RidgeView from './views/ridge-view.js';
import PalimpsestoView from './views/palimpsesto-view.js';
import { METHODOLOGY } from './about-content.js';


let _viewsInitialized = {};

const RURAL_IND_SET = new Set([
    'pct_rural_5k', 'pct_rural_10k', 'pct_rural_5k_nuc', 'pct_rural_10k_nuc',
    'pct_rural_5k_ex', 'pct_rural_10k_ex', 'pct_rural_5k_nuc_ex', 'pct_rural_10k_nuc_ex'
]);

const DISPERSION_IND_SET = new Set([
    'pct_dispersion', 'pct_agrupada', 'pob_dispersa', 'pob_agrupada'
]);

function _deriveRuralIndicator() {
    const method = State.get('ruralMethod');
    const ex = State.get('excludeAgro');
    return 'pct_rural_' + method + (ex ? '_ex' : '');
}

function _getIndicatorGroup(indId) {
    const meta = DataLoader.getMeta();
    const cat = meta.categories.find(c => c.id === State.get('activeCategory'));
    if (!cat) return null;
    for (const grp of (cat.indicatorGroups || []))
        if (grp.indicators.some(i => i.id === indId || i.id === indId.replace(/_ex$/, '')))
            return grp.id;
    return null;
}

(async () => {
    const loadEl = document.getElementById('loading');

    /* ── 1. Load data ── */
    try {
        // Show loading overlay (visible once landing fades)
        loadEl.style.display = '';
        await DataLoader.init();
    } catch (err) {
        console.error('Failed to load data:', err);
        loadEl.style.display = '';
        loadEl.innerHTML = `<div class="loading-title">Error</div><div class="loading-sub">${err.message}</div>`;
        return;
    }

    /* ── 2. Load default category data ── */
    const defaultCat = State.get('activeCategory');
    const meta = DataLoader.getMeta();
    const catDef = meta.categories.find(c => c.id === defaultCat);
    try {
        // Ensure data for the default category is loaded (init() only loads the first enabled category)
        await DataLoader.loadCategory(defaultCat);
        DataLoader.setActiveCategory(defaultCat);
    } catch (err) {
        console.error('Failed to load default category:', defaultCat, err);
        // Fallback: use whatever category DataLoader already loaded
        const fallbackCat = meta.categories.find(c => c.enabled);
        if (fallbackCat && fallbackCat.id !== defaultCat) {
            try {
                await DataLoader.loadCategory(fallbackCat.id);
                DataLoader.setActiveCategory(fallbackCat.id);
                State.set('activeCategory', fallbackCat.id);
            } catch (e2) {
                loadEl.innerHTML = `<div class="loading-title">Error</div><div class="loading-sub">${err.message}</div>`;
                return;
            }
        }
    }

    // Set year range for default category + indicator
    const years = DataLoader.getYears();
    if (years.length > 0) {
        State.set('yearRange', [years[0], years[years.length - 1]]);
        const cur = State.get('currentYear');
        if (cur < years[0] || cur > years[years.length - 1]) {
            State.set('currentYear', years[years.length - 1]);
        }
    }
    // Narrow year range to match the default indicator's available data
    _updateYearRangeForIndicator(State.get('activeIndicator'));

    /* ── 3. Build UI chrome ── */
    // Update category label to match the actual active category (may differ after fallback)
    const activeCat = State.get('activeCategory');
    const activeCatDef = meta.categories.find(c => c.id === activeCat);
    document.getElementById('category-label').textContent = activeCatDef ? activeCatDef.label : '';

    _buildSidebar();
    _buildIndicatorPanel();
    _buildViewTabs();
    _buildMethodCards();
    _initAboutNav();

    /* ── 4. Init components ── */
    Tooltip.init();
    Timeline.init();
    TerritoryPicker.init();

    /* ── 5. Init views ── */
    MapView.init(); _viewsInitialized.map = true;
    LineView.init(); _viewsInitialized.line = true;
    AreaView.init(); _viewsInitialized.area = true;
    RankingView.init(); _viewsInitialized.ranking = true;
    TableView.init(); _viewsInitialized.table = true;
    // Init climate-specific views if starting with clima
    if (activeCat === 'clima') {
        StripesView.init(); _viewsInitialized.stripes = true;
        ClimogramView.init(); _viewsInitialized.climogram = true;
        SpaghettiView.init(); _viewsInitialized.spaghetti = true;
        RidgeView.init(); _viewsInitialized.ridge = true;
    }

    /* ── 6. Wire header buttons ── */
    document.getElementById('btn-territory').addEventListener('click', () => State.set('pickerOpen', true));
    // Geo-level pills in header
    document.querySelectorAll('.geo-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const newLevel = btn.dataset.level;
            State.clearTerritories();
            State.set('geoLevel', newLevel);
            _autoSelectTerritories(newLevel);
        });
    });
    document.getElementById('btn-info').addEventListener('click', () => {
        const current = State.get('activeView');
        State.set('activeView', current === 'about' ? 'map' : 'about');
    });
    document.getElementById('btn-csv').addEventListener('click', _exportCSV);
    document.getElementById('btn-fs').addEventListener('click', _toggleFullscreen);
    _initSettings();

    /* ── 7. State subscriptions for UI chrome ── */
    State.subscribe('activeView', _syncActiveView);
    State.subscribe('activeCategory', _onCategoryChange);
    State.subscribe('activeIndicator', _syncIndicatorPills);
    State.subscribe('activeIndicator', _updateFooterSource);
    State.subscribe('activeIndicator', _buildViewTabs);
    State.subscribe('geoLevel', _syncTerritoryBtn);
    State.subscribe('geoLevel', _buildViewTabs);
    State.subscribe('geoLevel', () => {
        const level = State.get('geoLevel');
        // Default to facetas for comarcas/provincias when using rural/habitat indicators
        if (level === 'comarca' || level === 'provincia') {
            const ind = State.get('activeIndicator');
            if (RURAL_IND_SET.has(ind) || ind === 'hab4') {
                State.set('chartLayout', 'facet');
            }
        }
        // Reset pct_total at region level (always 100%, meaningless)
        if (level === 'region' && State.get('axisMode') === 'pct_total') {
            State.set('axisMode', 'absolute');
        }
    });
    State.subscribe('selectedTerritories', _syncSelectionBar);

    /* ── 8. Apply initial state ── */
    _syncActiveView(State.get('activeView'));
    _syncSelectionBar();
    _updateFooterSource();

    /* ── 9. Parse hash ── */
    _parseHash();
    window.addEventListener('hashchange', _parseHash);

    /* ── 10. Hide loading ── */
    loadEl.style.display = 'none';

})();

/* ════════════════════════════════════════════════
   UI Builder functions
   ════════════════════════════════════════════════ */

function _buildSidebar() {
    const meta = DataLoader.getMeta();
    const sidebar = document.getElementById('sidebar');
    let html = '';
    for (const cat of meta.categories) {
        const dis = cat.enabled ? '' : ' disabled';
        const act = cat.id === State.get('activeCategory') ? ' active' : '';
        const iconSvg = CATEGORY_ICONS[cat.id] || CATEGORY_ICONS.poblacion;
        const label = cat.sidebarLabel || cat.label;
        html += `<button class="sb-btn${act}${dis}" data-cat="${cat.id}" ${cat.enabled ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24">${iconSvg}</svg>
            <span class="sb-label">${label}</span>
        </button>`;
    }
    sidebar.innerHTML = html;
    sidebar.querySelectorAll('.sb-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => State.set('activeCategory', btn.dataset.cat));
    });
}

function _buildViewTabs() {
    const meta = DataLoader.getMeta();
    const cat = meta.categories.find(c => c.id === State.get('activeCategory'));
    const allowedViews = cat && cat.views ? cat.views : meta.views.map(v => v.id);
    const indicator = State.get('activeIndicator');
    const level = State.get('geoLevel');
    const isRuralMuni = RURAL_IND_SET.has(indicator) && level === 'municipio';
    const container = document.getElementById('view-tabs');
    let html = '';
    for (const v of meta.views) {
        if (!allowedViews.includes(v.id)) continue;
        if (v.id === 'about') continue;  // Info has its own button in sidebar
        const disabled = v.id === 'ranking' && isRuralMuni;
        const act = v.id === State.get('activeView') ? ' active' : '';
        const dis = disabled ? ' disabled' : '';
        const icon = VIEW_ICONS[v.id] || '';
        html += `<button class="view-tab${act}${dis}" data-view="${v.id}"${disabled ? ' title="No disponible para municipios"' : ''}>
            <svg viewBox="0 0 24 24">${icon}</svg>${v.label}
        </button>`;
    }
    container.innerHTML = html;
    container.querySelectorAll('.view-tab').forEach(btn => {
        if (btn.classList.contains('disabled')) return;
        btn.addEventListener('click', () => State.set('activeView', btn.dataset.view));
    });
}

function _buildIndicatorPanel() {
    const meta = DataLoader.getMeta();
    const cat = meta.categories.find(c => c.id === State.get('activeCategory'));
    const panel = document.getElementById('ind-panel');

    // Hide panel for layer-mode categories (transportes) or when no category
    if (!cat || cat.layerMode || !(cat.indicatorGroups && cat.indicatorGroups.length)) {
        panel.classList.add('hidden');
        return;
    }

    const currentInd = State.get('activeIndicator');
    const isExActive = currentInd.endsWith('_ex');
    const baseInd = isExActive ? currentInd.replace(/_ex$/, '') : currentInd;

    let bodyHtml = '';
    for (const grp of cat.indicatorGroups) {
        const enabledInds = grp.indicators.filter(i => i.enabled);
        const visibleInds = enabledInds.filter(i => !i.hidden);
        if (visibleInds.length === 0) continue;

        const activeInGroup = enabledInds.find(i => i.id === currentInd) ||
                              (isExActive && enabledInds.find(i => i.id === baseInd));
        const isActive = !!activeInGroup;
        // Auto-open accordion if it contains the active indicator
        const openCls = isActive ? ' open' : '';

        // Badge for _ex variant
        const badgeHtml = (isExActive && activeInGroup)
            ? ' <span class="acc-badge">sin agro</span>' : '';

        // Checkbox-mode: rural
        if (grp.id === 'rural') {
            const visible = State.get('ruralVisibleLines');
            bodyHtml += `<div class="acc-group${openCls}" data-group="rural">
                <div class="acc-header">
                    <span class="acc-chevron">\u25b8</span>
                    <span class="acc-title">Rural / Urbano</span>
                </div>
                <div class="acc-body">
                    <label class="acc-check"><input type="checkbox" data-line="rural" ${visible.includes('rural') ? 'checked' : ''}> Rural</label>
                    <label class="acc-check"><input type="checkbox" data-line="urbano" ${visible.includes('urbano') ? 'checked' : ''}> Urbano</label>
                </div>
            </div>`;
            continue;
        }

        // Checkbox-mode: dispersion
        if (grp.id === 'dispersion') {
            const visible = State.get('dispersionVisibleLines');
            const dispChecks = [
                { field: 'dispersa', label: 'Dispersa' },
                { field: 'agrupada', label: 'Agrupada' },
            ];
            bodyHtml += `<div class="acc-group${openCls}" data-group="dispersion">
                <div class="acc-header">
                    <span class="acc-chevron">\u25b8</span>
                    <span class="acc-title">Dispersión</span>
                </div>
                <div class="acc-body">`;
            for (const dc of dispChecks) {
                bodyHtml += `<label class="acc-check"><input type="checkbox" data-line="${dc.field}" ${visible.includes(dc.field) ? 'checked' : ''}> ${dc.label}</label>`;
            }
            bodyHtml += `</div></div>`;
            continue;
        }

        // Checkbox-mode: habitat
        if (grp.id === 'habitat') {
            const visible = State.get('habitatVisibleLines');
            const habChecks = [
                { field: 'pct_ciudad', label: 'Ciudad' },
                { field: 'pct_agro', label: 'Agrociudad' },
                { field: 'pct_nuc', label: 'Rural nucleado' },
                { field: 'pct_disp', label: 'Rural disperso' },
            ];
            bodyHtml += `<div class="acc-group${openCls}" data-group="habitat">
                <div class="acc-header">
                    <span class="acc-chevron">\u25b8</span>
                    <span class="acc-title">Hábitat</span>
                </div>
                <div class="acc-body">`;
            for (const hc of habChecks) {
                bodyHtml += `<label class="acc-check"><input type="checkbox" data-line="${hc.field}" ${visible.includes(hc.field) ? 'checked' : ''}> ${hc.label}</label>`;
            }
            bodyHtml += `</div></div>`;
            continue;
        }

        // Normal indicator group
        const grpLabel = grp.pillLabel || grp.label;
        bodyHtml += `<div class="acc-group${openCls}" data-group="${grp.id}">
            <div class="acc-header">
                <span class="acc-chevron">\u25b8</span>
                <span class="acc-title">${grpLabel}</span>${badgeHtml}
            </div>
            <div class="acc-body">`;

        // SubGroups
        if (grp.subGroups && grp.subGroups.length > 0) {
            for (const sg of grp.subGroups) {
                const sgInds = sg.indicatorIds
                    .map(id => visibleInds.find(i => i.id === id))
                    .filter(Boolean);
                if (sgInds.length === 0) continue;
                const sgActive = sgInds.some(i => i.id === currentInd || i.id === baseInd);
                bodyHtml += `<div class="acc-subgroup${sgActive ? ' active' : ''}" data-sg-ids="${sg.indicatorIds.join(',')}">`;
                bodyHtml += `<div class="acc-subgroup-label">${sg.label}</div>`;
                for (const ind of sgInds) {
                    const iact = (ind.id === currentInd || (isExActive && ind.id === baseInd)) ? ' active' : '';
                    bodyHtml += `<div class="acc-item${iact}" data-ind="${ind.id}">${ind.label}</div>`;
                }
                bodyHtml += `</div>`;
            }
        } else {
            // Flat list
            for (const ind of visibleInds) {
                const iact = (ind.id === currentInd || (isExActive && ind.id === baseInd)) ? ' active' : '';
                bodyHtml += `<div class="acc-item${iact}" data-ind="${ind.id}">${ind.label}</div>`;
            }
        }

        // Agro toggle
        if (grp.hasExcludeAgro) {
            bodyHtml += `<label class="acc-agro-toggle">
                <input type="checkbox" class="agro-toggle" ${isExActive && activeInGroup ? 'checked' : ''}>
                Excluir agrociudades
            </label>`;
        }

        bodyHtml += `</div></div>`;
    }

    const panelTitle = `Indicadores de ${cat.label}`;
    panel.innerHTML = `<div class="ind-panel-header">${panelTitle}</div>
        <div class="ind-panel-body">${bodyHtml}</div>`;
    panel.classList.remove('hidden');

    // Wire accordion toggle
    panel.querySelectorAll('.acc-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            hdr.closest('.acc-group').classList.toggle('open');
        });
    });

    // Wire accordion header click also selects indicator for checkbox groups
    panel.querySelectorAll('.acc-group[data-group="rural"] .acc-header').forEach(hdr => {
        hdr.addEventListener('click', () => State.set('activeIndicator', _deriveRuralIndicator()));
    });
    panel.querySelectorAll('.acc-group[data-group="habitat"] .acc-header').forEach(hdr => {
        hdr.addEventListener('click', () => State.set('activeIndicator', 'hab4'));
    });
    panel.querySelectorAll('.acc-group[data-group="dispersion"] .acc-header').forEach(hdr => {
        hdr.addEventListener('click', () => State.set('activeIndicator', 'pct_dispersion'));
    });

    // Wire item clicks
    panel.querySelectorAll('.acc-item[data-ind]').forEach(item => {
        item.addEventListener('click', () => {
            const grp = item.closest('.acc-group');
            const toggle = grp ? grp.querySelector('.agro-toggle') : null;
            const indId = (toggle && toggle.checked) ? item.dataset.ind + '_ex' : item.dataset.ind;
            State.set('activeIndicator', indId);
        });
    });

    // Wire sub-group label clicks
    panel.querySelectorAll('.acc-subgroup-label').forEach(label => {
        label.addEventListener('click', () => {
            const sg = label.closest('.acc-subgroup');
            const ids = sg.dataset.sgIds.split(',');
            if (ids.length > 0) State.set('activeIndicator', ids[0]);
        });
    });

    // Wire checkbox toggles (rural / habitat)
    panel.querySelectorAll('.acc-check input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const grp = cb.closest('.acc-group');
            const grpId = grp.dataset.group;
            const lines = [];
            grp.querySelectorAll('.acc-check input[type="checkbox"]').forEach(c => {
                if (c.checked) lines.push(c.dataset.line);
            });
            const stateKey = grpId === 'rural' ? 'ruralVisibleLines'
                : grpId === 'dispersion' ? 'dispersionVisibleLines'
                : 'habitatVisibleLines';
            State.set(stateKey, lines);
        });
    });

    // Wire agro toggle
    panel.querySelectorAll('.agro-toggle').forEach(toggle => {
        toggle.addEventListener('change', () => {
            const cur = State.get('activeIndicator');
            const base = cur.replace(/_ex$/, '');
            State.set('activeIndicator', toggle.checked ? base + '_ex' : base);
        });
    });
}

/* ════════════════════════════════════════════════
   Sync functions
   ════════════════════════════════════════════════ */

function _syncActiveView(view) {
    // Toggle panels
    document.querySelectorAll('.viz-panel').forEach(el => el.classList.remove('active'));

    // 'chart' maps to either panel-line or panel-area depending on chartType
    if (view === 'chart') {
        const chartType = State.get('chartType');
        const panelId = chartType === 'area' ? 'panel-area' : 'panel-line';
        const p = document.getElementById(panelId);
        if (p) p.classList.add('active');
    } else {
        const panel = document.getElementById('panel-' + view);
        if (panel) panel.classList.add('active');
    }

    // Toggle tab highlight
    document.querySelectorAll('.view-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Toggle info button active state (now in sidebar)
    const infoBtn = document.getElementById('btn-info');
    if (infoBtn) infoBtn.classList.toggle('active', view === 'about');

    // Hide subheader/timeline/selection/footer/ind-panel for about and palimpsesto views
    const isAbout = view === 'about';
    const isPalimpsesto = view === 'palimpsesto';
    const hideChrome = isAbout || isPalimpsesto;
    document.querySelector('.subheader').style.display = hideChrome ? 'none' : '';
    document.querySelector('.selection-bar').style.display = (hideChrome || view === 'map') ? 'none' : '';
    document.querySelector('.timeline').style.display = hideChrome ? 'none' : '';
    document.querySelector('.footer').style.display = isAbout ? 'none' : '';
    // Hide indicator panel for about/palimpsesto
    const indPanel = document.getElementById('ind-panel');
    if (hideChrome) {
        indPanel.innerHTML = '';
        indPanel.classList.add('hidden');
    } else {
        _buildIndicatorPanel(); // re-show panel (handles its own hidden logic)
    }
    // Fire resize after panel transition settles
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    // If switching to map and geoLevel is region, fall back to provincia
    if (view === 'map' && State.get('geoLevel') === 'region') {
        State.clearTerritories();
        State.set('geoLevel', 'provincia');
    }

    // Show/hide settings pill — for views with configurable options
    // Also show for any view when indicator has extra settings (rural/habitat/dispersion)
    const indGroup = _getIndicatorGroup(State.get('activeIndicator'));
    const hasIndicatorSettings = ['rural', 'habitat', 'dispersion'].includes(indGroup);
    const hasSettings = ['map', 'chart', 'ranking'].includes(view) || hasIndicatorSettings;
    document.getElementById('btn-settings').style.display = hasSettings ? '' : 'none';
    if (!hasSettings) State.set('settingsOpen', false);

    // Auto-select top territories for views that need selection
    if (State.get('selectedTerritories').length === 0) {
        _autoSelectTerritories(State.get('geoLevel'));
    }

    // Trigger render for the active view
    requestAnimationFrame(() => {
        _renderView(view);
    });

    _updateHash();
}

function _renderView(view) {
    if (['climogram', 'spaghetti', 'ridge'].includes(view) && !DataLoader.hasMonthlyData('clima')) {
        const loading = document.getElementById('loading');
        loading.style.display = '';
        loading.querySelector('.loading-sub').textContent = 'Cargando datos mensuales...';
        DataLoader.loadMonthlyData('clima')
            .then(() => {
                loading.style.display = 'none';
                _renderView(view);
            })
            .catch(err => {
                console.error('Failed to load monthly climate data:', err);
                loading.style.display = 'none';
            });
        return;
    }

    if (view === 'map') MapView.render();
    else if (view === 'chart') {
        const chartType = State.get('chartType');
        if (chartType === 'area') AreaView.render();
        else LineView.render();
    }
    else if (view === 'line') LineView.render();
    else if (view === 'area') AreaView.render();
    else if (view === 'ranking') RankingView.render();
    else if (view === 'table') TableView.render();
    else if (view === 'stripes') StripesView.render();
    else if (view === 'climogram') ClimogramView.render();
    else if (view === 'spaghetti') SpaghettiView.render();
    else if (view === 'ridge') RidgeView.render();
    else if (view === 'palimpsesto') PalimpsestoView.render();
}

function _autoSelectTerritories(level) {
    if (level === 'region') {
        State.addTerritory('AND');
        return;
    }
    const displayLevel = level === 'region' ? 'provincia' : level;
    const year = State.get('currentYear');
    const indicator = State.get('activeIndicator');
    const ranking = DataLoader.getRanking(year, indicator, displayLevel);
    if (ranking.length > 0) {
        ranking.slice(0, 3).forEach(r => State.addTerritory(r.code));
    } else {
        // Fallback: first 3 territories alphabetically
        const all = DataLoader.getAllTerritories(displayLevel);
        all.slice(0, 3).forEach(t => State.addTerritory(t.code));
    }
}

async function _onCategoryChange(catId) {
    // If on about view, switch back to map
    if (State.get('activeView') === 'about') {
        State.set('activeView', 'map');
    }

    // Show loading overlay briefly
    const loading = document.getElementById('loading');
    loading.querySelector('.loading-sub').textContent = 'Cargando datos...';

    // Update sidebar
    document.querySelectorAll('.sb-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cat === catId);
    });

    // Update label
    const meta = DataLoader.getMeta();
    const cat = meta.categories.find(c => c.id === catId);
    document.getElementById('category-label').textContent = cat ? cat.label : '';

    // Layer-mode categories (e.g. transportes) — no time-series data
    if (cat && cat.layerMode) {
        loading.style.display = 'none';
        if (!_viewsInitialized.palimpsesto) {
            PalimpsestoView.init();
            _viewsInitialized.palimpsesto = true;
        }
        _buildIndicatorPanel();
        _buildViewTabs();
        const allowedViews = cat.views || [];
        const currentView = State.get('activeView');
        if (!allowedViews.includes(currentView)) {
            State.set('activeView', allowedViews[0] || 'palimpsesto');
        } else {
            _renderView(currentView);
        }
        _updateFooterSource();
        return;
    }

    // Load category data (lazy)
    try {
        loading.style.display = '';
        await DataLoader.loadCategory(catId);
        DataLoader.setActiveCategory(catId);

    } catch (err) {
        console.error('Failed to load category:', catId, err);
        loading.style.display = 'none';
        return;
    }
    loading.style.display = 'none';

    // Init climate-specific views if needed
    if (catId === 'clima') {
        if (!_viewsInitialized.stripes) { StripesView.init(); _viewsInitialized.stripes = true; }
        if (!_viewsInitialized.climogram) { ClimogramView.init(); _viewsInitialized.climogram = true; }
        if (!_viewsInitialized.spaghetti) { SpaghettiView.init(); _viewsInitialized.spaghetti = true; }
        if (!_viewsInitialized.ridge) { RidgeView.init(); _viewsInitialized.ridge = true; }
    }

    // Update year range and clamp current year FIRST (before setting indicator)
    const years = DataLoader.getYears();
    if (years.length > 0) {
        State.set('yearRange', [years[0], years[years.length - 1]]);
        const cur = State.get('currentYear');
        if (cur < years[0]) {
            State.set('currentYear', years[0]);
        } else if (cur > years[years.length - 1]) {
            State.set('currentYear', years[years.length - 1]);
        }
    }

    // Refresh timeline
    Timeline.refresh();

    // Reset axis mode to absolute (safest default for new category)
    if (cat && cat.axisModes && !cat.axisModes.includes(State.get('axisMode'))) {
        State.set('axisMode', 'absolute');
    }

    // Rebuild indicator panel and view tabs for this category
    _buildIndicatorPanel();
    _buildViewTabs();
    // Fire resize after panel transition so visualizations adapt
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    // Set first enabled indicator — but only if current indicator doesn't belong to this category
    const currentInd = State.get('activeIndicator');
    const currentDef = DataLoader.getIndicatorDef(currentInd);
    if (!currentDef || currentDef._category !== catId) {
        if (cat) {
            for (const grp of (cat.indicatorGroups || [])) {
                const first = grp.indicators.find(i => i.enabled);
                if (first) { State.set('activeIndicator', first.id); break; }
            }
        }
    } else {
        // Current indicator is already from this category — just re-render
        _syncIndicatorPills(currentInd);
        _renderView(State.get('activeView'));
    }

    // If current view is not available in this category, switch to map
    const allowedViews = cat && cat.views ? cat.views : [];
    const currentView = State.get('activeView');
    if (!allowedViews.includes(currentView)) {
        State.set('activeView', allowedViews[0] || 'map');
    } else {
        // Force re-render
        _renderView(currentView);
    }

    // Update footer source text
    _updateFooterSource();
}

function _updateFooterSource() {
    const footer = document.querySelector('.footer span');
    if (!footer) return;
    const catId = State.get('activeCategory');
    const indGroup = _getIndicatorGroup(State.get('activeIndicator'));
    if (catId === 'clima') {
        footer.textContent = 'Fuente: MOTEDAS/MOPREDAS (1916\u20132020) \u00b7 WorldClim (1950\u20132023)';
    } else if (catId === 'empleo') {
        footer.textContent = 'Fuente: Infante-Amate, J. (2026). Base de datos de empleo hist\u00f3rico municipal de Andaluc\u00eda (1787-2023). Universidad de Granada.';
    } else if (catId === 'transportes') {
        footer.textContent = 'Fuente: Elaboraci\u00f3n propia \u00b7 JRC \u00b7 IECA \u00b7 ADIF \u00b7 Ministerio de Transportes';
    } else if (catId === 'poblacion' && indGroup === 'rural') {
        footer.textContent = 'Fuente: Travieso, E., Mart\u00ednez de la Fuente, J.L. & Infante-Amate, J. (2025). Historical Methods.';
    } else if (catId === 'poblacion' && (indGroup === 'dispersion' || indGroup === 'habitat')) {
        footer.textContent = 'Fuente: Mart\u00ednez de la Fuente, J.L., Infante-Amate, J. & Travieso, E. (2024). Journal of Rural Studies.';
    } else if (catId === 'poblacion') {
        footer.textContent = 'Fuente: Infante-Amate, J. (2026). Atlas Hist\u00f3rico Municipal de Andaluc\u00eda: series de poblaci\u00f3n 1750-2024. Universidad de Granada.';
    } else {
        footer.textContent = 'Fuente: Infante-Amate, J. (2026). Atlas Hist\u00f3rico Municipal de Andaluc\u00eda. Universidad de Granada.';
    }
}

function _syncIndicatorPills(indId) {
    _buildIndicatorPanel();
    _updateYearRangeForIndicator(indId);
    if (State.get('settingsOpen')) _buildSettingsContent();
    _updateHash();
}

function _updateYearRangeForIndicator(indId) {
    const def = DataLoader.getIndicatorDef(indId);
    if (!def) return;
    const years = DataLoader.getYears();
    if (years.length === 0) return;

    const catStart = years[0];
    const catEnd = years[years.length - 1];
    let indStart = def.yearStart || catStart;
    let indEnd = def.yearEnd || catEnd;

    // Data-driven detection: scan multiple territories to find actual data bounds
    if (!def.yearStart || !def.yearEnd) {
        let dataFirstYear = Infinity;
        let dataLastYear = -Infinity;

        // Scan regions first, then provincias as fallback
        const samples = DataLoader.getAllTerritories('region');
        const fallback = samples.length === 0 ? DataLoader.getAllTerritories('provincia') : [];
        const toScan = samples.length > 0 ? samples : fallback;

        for (const territory of toScan) {
            const ts = DataLoader.getTimeSeries(territory.code, indId);
            if (ts.length > 0) {
                if (ts[0].year < dataFirstYear) dataFirstYear = ts[0].year;
                if (ts[ts.length - 1].year > dataLastYear) dataLastYear = ts[ts.length - 1].year;
            }
        }

        if (dataFirstYear < Infinity && !def.yearStart) indStart = dataFirstYear;
        if (dataLastYear > -Infinity && !def.yearEnd) indEnd = dataLastYear;
    }

    const effectiveStart = Math.max(catStart, indStart);
    const effectiveEnd = Math.min(catEnd, indEnd);

    State.set('yearRange', [effectiveStart, effectiveEnd]);

    const cur = State.get('currentYear');
    if (cur < effectiveStart) State.set('currentYear', effectiveStart);
    if (cur > effectiveEnd) State.set('currentYear', effectiveEnd);

    Timeline.refresh();
}

function _syncTerritoryBtn(level) {
    // Highlight active geo pill
    document.querySelectorAll('.geo-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.level === level);
    });
    _updateHash();
}

function _syncSelectionBar() {
    const selected = State.get('selectedTerritories');
    const bar = document.getElementById('selection-bar');
    _updateHash();
    if (selected.length === 0) { bar.innerHTML = ''; return; }

    let html = '';
    for (let i = 0; i < selected.length; i++) {
        const code = selected[i];
        const t = DataLoader.getTerritoryMeta(code);
        const name = t ? t.name : code;
        const color = territoryColor(i);
        html += `<div class="chip">
            <div class="chip-dot" style="background:${color}"></div>
            ${name}
            <span class="chip-remove" data-code="${code}">&times;</span>
        </div>`;
    }
    bar.innerHTML = html;
    bar.querySelectorAll('.chip-remove').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            State.removeTerritory(el.dataset.code);
        });
    });
}

/* ════════════════════════════════════════════════
   About page: methodology cards + navigation
   ════════════════════════════════════════════════ */

function _buildMethodCards() {
    const meta = DataLoader.getMeta();
    const container = document.getElementById('method-cards');
    if (!container) return;

    const enabledCats = meta.categories.filter(c => c.enabled);
    let html = '';
    for (const cat of enabledCats) {
        const iconSvg = CATEGORY_ICONS[cat.id] || CATEGORY_ICONS.poblacion;
        const meth = METHODOLOGY[cat.id];
        const brief = meth ? meth.brief : 'Próximamente.';
        html += `<div class="method-card" data-cat="${cat.id}">
            <div class="method-card-inner">
                <div class="method-card-front">
                    <svg viewBox="0 0 24 24">${iconSvg}</svg>
                    <span>${cat.label}</span>
                </div>
                <div class="method-card-back">
                    <p>${brief}</p>
                </div>
            </div>
        </div>`;
    }
    container.innerHTML = html;

    // Click to show detail
    container.querySelectorAll('.method-card').forEach(card => {
        card.addEventListener('click', () => {
            const catId = card.dataset.cat;
            const detail = document.getElementById('method-detail');
            const meth = METHODOLOGY[catId];
            const wasActive = card.classList.contains('active');

            // Remove active from all cards
            container.querySelectorAll('.method-card').forEach(c => c.classList.remove('active'));

            if (wasActive) {
                // Toggle off
                detail.classList.remove('active');
                detail.innerHTML = '';
            } else {
                // Show detail
                card.classList.add('active');
                detail.innerHTML = meth ? meth.detail : '<p>Información próximamente.</p>';
                detail.classList.add('active');
                // Scroll detail into view
                detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    });
}

function _initAboutNav() {
    const nav = document.getElementById('about-nav');
    if (!nav) return;

    nav.querySelectorAll('.about-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Toggle active tab
            nav.querySelectorAll('.about-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Toggle active section
            document.querySelectorAll('.about-section').forEach(s => s.classList.remove('active'));
            const section = document.getElementById('about-' + btn.dataset.section);
            if (section) section.classList.add('active');
        });
    });
}

/* ════════════════════════════════════════════════
   Settings slide-out panel
   ════════════════════════════════════════════════ */

function _initSettings() {
    document.getElementById('btn-settings').addEventListener('click', () => {
        State.set('settingsOpen', !State.get('settingsOpen'));
    });
    document.getElementById('settings-close').addEventListener('click', () => {
        State.set('settingsOpen', false);
    });
    document.getElementById('settings-backdrop').addEventListener('click', () => {
        State.set('settingsOpen', false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && State.get('settingsOpen')) {
            State.set('settingsOpen', false);
        }
    });

    State.subscribe('settingsOpen', _onSettingsToggle);
}

function _onSettingsToggle(isOpen) {
    const overlay = document.getElementById('settings-overlay');
    const btn = document.getElementById('btn-settings');
    if (isOpen) {
        _buildSettingsContent();
        overlay.classList.add('open');
        btn.classList.add('active');
    } else {
        overlay.classList.remove('open');
        btn.classList.remove('active');
    }
}

function _buildSettingsContent() {
    const body = document.getElementById('settings-body');
    const view = State.get('activeView');
    const meta = DataLoader.getMeta();
    const cat = meta.categories.find(c => c.id === State.get('activeCategory'));
    const indicator = State.get('activeIndicator');
    const isCategorical = indicator === 'hab4';
    const isEmpleo = State.get('activeCategory') === 'empleo';
    const isRural = RURAL_IND_SET.has(indicator);
    const isDispersion = DISPERSION_IND_SET.has(indicator);
    const isClima = State.get('activeCategory') === 'clima';
    const geoLevel = State.get('geoLevel');
    const isRuralMuni = isRural && geoLevel === 'municipio';

    let html = '';

    if (view === 'map') {
        // Map mode: Coropletas / Burbujas
        const BUBBLE_INDICATORS = new Set(['habitantes', 'densidad', 'pob_agrupada', 'pob_dispersa']);
        const canBubble = !isCategorical && BUBBLE_INDICATORS.has(indicator);
        if (canBubble) {
            const mapMode = State.get('mapMode');
            html += `<div class="settings-section">
                <div class="settings-section-title">Tipo de mapa</div>
                <div class="settings-section-desc">Representación de los datos sobre el mapa</div>
                <div class="settings-options">
                    <button class="settings-opt${mapMode === 'choropleth' ? ' active' : ''}" data-setting="mapMode" data-val="choropleth">Coropletas</button>
                    <button class="settings-opt${mapMode === 'bubble' ? ' active' : ''}" data-setting="mapMode" data-val="bubble">Burbujas</button>
                </div>
            </div>`;
        }

        // Map count: 1 / 2
        const isDual = State.get('map2Year') != null;
        html += `<div class="settings-section">
            <div class="settings-section-title">Comparar mapas</div>
            <div class="settings-section-desc">Dos mapas para comparar diferentes años</div>
            <div class="settings-options">
                <button class="settings-opt${!isDual ? ' active' : ''}" data-setting="mapCount" data-val="1">1 mapa</button>
                <button class="settings-opt${isDual ? ' active' : ''}" data-setting="mapCount" data-val="2">2 mapas</button>
            </div>
        </div>`;

    } else if (view === 'chart') {
        // Chart type: Línea / Área
        if (!isCategorical && !isRuralMuni) {
            const chartType = State.get('chartType');
            html += `<div class="settings-section">
                <div class="settings-section-title">Tipo de gráfico</div>
                <div class="settings-options">
                    <button class="settings-opt${chartType === 'line' ? ' active' : ''}" data-setting="chartType" data-val="line">Línea</button>
                    <button class="settings-opt${chartType === 'area' ? ' active' : ''}" data-setting="chartType" data-val="area">Área</button>
                </div>
            </div>`;
        }

        // Layout: Superpuesto / Facetas / Sectores
        const chartType = State.get('chartType');
        if (!isRuralMuni && (chartType === 'line' || (chartType === 'area' && !isCategorical))) {
            const layout = State.get('chartLayout');
            html += `<div class="settings-section">
                <div class="settings-section-title">Disposición</div>
                <div class="settings-section-desc">Cómo se organizan las series en el gráfico</div>
                <div class="settings-options">
                    <button class="settings-opt${layout === 'overlay' ? ' active' : ''}" data-setting="chartLayout" data-val="overlay">Superpuesto</button>
                    <button class="settings-opt${layout === 'facet' ? ' active' : ''}" data-setting="chartLayout" data-val="facet">Facetas</button>
                    ${chartType === 'line' && isEmpleo ? `<button class="settings-opt${layout === 'sector' ? ' active' : ''}" data-setting="chartLayout" data-val="sector">Sectores</button>` : ''}
                </div>
            </div>`;
        }

        // Facet Y axis: Fixed vs Auto
        if (State.get('chartLayout') === 'facet' && !isRuralMuni) {
            const facetY = State.get('facetYAxis');
            html += `<div class="settings-section">
                <div class="settings-section-title">Eje Y en facetas</div>
                <div class="settings-section-desc">Fijo comparte el mismo rango en todos los paneles; ajustado escala cada panel a sus datos</div>
                <div class="settings-options">
                    <button class="settings-opt${facetY === 'fixed' ? ' active' : ''}" data-setting="facetYAxis" data-val="fixed">Fijo</button>
                    <button class="settings-opt${facetY === 'auto' ? ' active' : ''}" data-setting="facetYAxis" data-val="auto">Ajustado</button>
                </div>
            </div>`;
        }

        // Area sub-mode (not for rural/dispersion — they have their own unit toggle)
        if (chartType === 'area' && !isEmpleo && !isCategorical && !isRural && !isDispersion) {
            const axisMode = State.get('axisMode');
            html += `<div class="settings-section">
                <div class="settings-section-title">Modo del área</div>
                <div class="settings-options">
                    <button class="settings-opt${axisMode === 'absolute' ? ' active' : ''}" data-setting="axisMode" data-val="absolute">Absoluto</button>
                    <button class="settings-opt${axisMode === 'pct_composition' ? ' active' : ''}" data-setting="axisMode" data-val="pct_composition">% composición</button>
                    <button class="settings-opt${axisMode === 'pct_andalucia' ? ' active' : ''}" data-setting="axisMode" data-val="pct_andalucia">% Andalucía</button>
                </div>
            </div>`;
        }

        // Axis mode: Absoluto / Índice / % del total
        if (chartType === 'line' && !isCategorical && !isRural && !isDispersion) {
            // Filter axis modes: pct_total is meaningless at region level (always 100%)
            let axisModes = cat && cat.axisModes ? [...cat.axisModes] : ['absolute'];
            if (geoLevel === 'region') axisModes = axisModes.filter(m => m !== 'pct_total');
            if (axisModes.length > 1) {
                const axisMode = State.get('axisMode');
                html += `<div class="settings-section">
                    <div class="settings-section-title">Escala de valores</div>
                    <div class="settings-section-desc">Cómo se expresan los datos del eje Y</div>
                    <div class="settings-options">`;
                for (const m of axisModes) {
                    const label = { absolute: 'Absoluto', index: 'Índice', pct_total: '% del total' }[m] || m;
                    html += `<button class="settings-opt${m === axisMode ? ' active' : ''}" data-setting="axisMode" data-val="${m}">${label}</button>`;
                }
                html += `</div></div>`;
            }
        }

        // Scale type: Lineal / Logarítmica (only for line chart — area-view does not use scaleType)
        if (chartType === 'line' && !isCategorical && !isRural && !isDispersion) {
            const scaleType = State.get('scaleType');
            html += `<div class="settings-section">
                <div class="settings-section-title">Eje Y</div>
                <div class="settings-section-desc">Escala del eje vertical</div>
                <div class="settings-options">
                    <button class="settings-opt${scaleType === 'linear' ? ' active' : ''}" data-setting="scaleType" data-val="linear">Lineal</button>
                    <button class="settings-opt${scaleType === 'log' ? ' active' : ''}" data-setting="scaleType" data-val="log">Logarítmico</button>
                </div>
            </div>`;
        }

        // Historical average line (line chart, clima only)
        if (chartType === 'line' && !isCategorical && isClima) {
            const showAvg = State.get('showAverage');
            html += `<div class="settings-section">
                <div class="settings-section-title">Promedio histórico</div>
                <div class="settings-section-desc">Línea de referencia con la media de todo el período</div>
                <div class="settings-options">
                    <button class="settings-opt${!showAvg ? ' active' : ''}" data-setting="showAverage" data-val="false">Ocultar</button>
                    <button class="settings-opt${showAvg ? ' active' : ''}" data-setting="showAverage" data-val="true">Mostrar</button>
                </div>
            </div>`;
        }


    } else if (view === 'ranking') {
        const topN = State.get('rankingTopN');
        html += `<div class="settings-section">
            <div class="settings-section-title">Territorios visibles</div>
            <div class="settings-section-desc">Cuántos territorios se muestran en el ranking</div>
            <div class="settings-options">
                <button class="settings-opt${topN === 10 ? ' active' : ''}" data-setting="rankingTopN" data-val="10">Top 10</button>
                <button class="settings-opt${topN === 20 ? ' active' : ''}" data-setting="rankingTopN" data-val="20">Top 20</button>
                <button class="settings-opt${topN === 50 ? ' active' : ''}" data-setting="rankingTopN" data-val="50">Top 50</button>
                <button class="settings-opt${topN === 0 ? ' active' : ''}" data-setting="rankingTopN" data-val="0">Todos</button>
            </div>
        </div>`;
    }

    // Rural/Habitat settings (shown in ALL views)
    const indGroup = _getIndicatorGroup(indicator);
    if (indGroup === 'rural') {
        const method = State.get('ruralMethod');
        html += `<div class="settings-section">
            <div class="settings-section-title">Umbral rural / urbano</div>
            <div class="settings-section-desc">Población mínima para considerar un territorio como urbano. «Municipio» usa la población total del municipio; «núcleo» usa solo la del núcleo principal.</div>
            <div class="settings-options">
                <button class="settings-opt${method === '5k' ? ' active' : ''}" data-setting="ruralMethod" data-val="5k">&gt; 5.000 (mun.)</button>
                <button class="settings-opt${method === '10k' ? ' active' : ''}" data-setting="ruralMethod" data-val="10k">&gt; 10.000 (mun.)</button>
                <button class="settings-opt${method === '5k_nuc' ? ' active' : ''}" data-setting="ruralMethod" data-val="5k_nuc">&gt; 5.000 (núcleo)</button>
                <button class="settings-opt${method === '10k_nuc' ? ' active' : ''}" data-setting="ruralMethod" data-val="10k_nuc">&gt; 10.000 (núcleo)</button>
            </div>
        </div>`;
        const exAgro = State.get('excludeAgro');
        html += `<div class="settings-section">
            <div class="settings-section-title">Agrociudades</div>
            <div class="settings-section-desc">Municipios que superan el umbral de población pero tienen &gt;60% de activos en el sector agrario. Al excluirlos, estos se reclasifican como rurales pese a su tamaño.</div>
            <div class="settings-options">
                <button class="settings-opt${!exAgro ? ' active' : ''}" data-setting="excludeAgro" data-val="false">Incluir como urbanos</button>
                <button class="settings-opt${exAgro ? ' active' : ''}" data-setting="excludeAgro" data-val="true">Reclasificar como rurales</button>
            </div>
        </div>`;
        if (view === 'chart' && !isRuralMuni) {
            const ruralUnit = State.get('ruralUnit');
            html += `<div class="settings-section">
                <div class="settings-section-title">Unidad</div>
                <div class="settings-section-desc">Cómo se expresan los valores</div>
                <div class="settings-options">
                    <button class="settings-opt${ruralUnit === 'pct' ? ' active' : ''}" data-setting="ruralUnit" data-val="pct">Porcentaje</button>
                    <button class="settings-opt${ruralUnit === 'abs' ? ' active' : ''}" data-setting="ruralUnit" data-val="abs">Habitantes</button>
                </div>
            </div>`;
        }
    }
    if (indGroup === 'habitat' && view === 'chart' && State.get('chartType') === 'line') {
        const habUnit = State.get('habitatUnit');
        html += `<div class="settings-section">
            <div class="settings-section-title">Unidad</div>
            <div class="settings-section-desc">Cómo se expresan los valores</div>
            <div class="settings-options">
                <button class="settings-opt${habUnit === 'pct' ? ' active' : ''}" data-setting="habitatUnit" data-val="pct">Porcentaje</button>
                <button class="settings-opt${habUnit === 'abs' ? ' active' : ''}" data-setting="habitatUnit" data-val="abs">Habitantes</button>
            </div>
        </div>`;
    }
    if (indGroup === 'dispersion' && view === 'chart') {
        const dispUnit = State.get('dispersionUnit');
        html += `<div class="settings-section">
            <div class="settings-section-title">Unidad</div>
            <div class="settings-section-desc">Cómo se expresan los valores de dispersión</div>
            <div class="settings-options">
                <button class="settings-opt${dispUnit === 'pct' ? ' active' : ''}" data-setting="dispersionUnit" data-val="pct">Porcentaje</button>
                <button class="settings-opt${dispUnit === 'abs' ? ' active' : ''}" data-setting="dispersionUnit" data-val="abs">Habitantes</button>
            </div>
        </div>`;
    }

    body.innerHTML = html;

    // Wire buttons
    body.querySelectorAll('.settings-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.setting;
            const val = btn.dataset.val;

            // Map count toggle (1 or 2 maps)
            if (key === 'mapCount') {
                if (val === '2') {
                    // Enable dual map with a different year
                    const cur = State.get('currentYear');
                    const range = State.get('yearRange');
                    const offset = Math.max(10, Math.round((range[1] - range[0]) * 0.3));
                    const map2 = Math.max(range[0], cur - offset);
                    State.set('map2Year', map2 === cur ? cur - 1 : map2);
                } else {
                    State.set('map2Year', null);
                }
                _buildSettingsContent();
                return;
            }

            if (key === 'rankingTopN') {
                State.set(key, parseInt(val));
            } else if (key === 'showAverage' || key === 'excludeAgro') {
                State.set(key, val === 'true');
            } else {
                State.set(key, val);
            }

            if (key === 'chartType') {
                _syncActiveView('chart');
            }
            // Recalculate rural indicator when method or agro changes
            if (key === 'ruralMethod' || key === 'excludeAgro') {
                State.set('activeIndicator', _deriveRuralIndicator());
            }

            // Rebuild to reflect new state
            _buildSettingsContent();
        });
    });

}

/* ════════════════════════════════════════════════
   Hash routing
   ════════════════════════════════════════════════ */

function _updateHash() {
    const s = State.snapshot();
    const parts = [];
    if (s.activeCategory !== 'clima') parts.push('cat=' + s.activeCategory);
    parts.push('view=' + s.activeView);
    parts.push('ind=' + s.activeIndicator);
    parts.push('level=' + s.geoLevel);
    parts.push('year=' + s.currentYear);
    if (s.axisMode !== 'absolute') parts.push('axis=' + s.axisMode);
    if (s.selectedTerritories.length > 0) parts.push('t=' + s.selectedTerritories.join(','));
    if (s.map2Year != null) parts.push('m2=' + s.map2Year);
    if (s.mapMode !== 'choropleth') parts.push('mm=' + s.mapMode);
    if (s.chartType !== 'line') parts.push('ct=' + s.chartType);
    if (s.chartLayout !== 'overlay') parts.push('cl=' + s.chartLayout);
    if (s.scaleType !== 'linear') parts.push('st=' + s.scaleType);
    // Rural/habitat state
    if (s.ruralVisibleLines.length !== 2 || !s.ruralVisibleLines.includes('rural') || !s.ruralVisibleLines.includes('urbano'))
        parts.push('rv=' + s.ruralVisibleLines.join(','));
    if (s.ruralMethod !== '5k') parts.push('rm=' + s.ruralMethod);
    if (s.excludeAgro) parts.push('ea=1');
    if (s.ruralUnit !== 'pct') parts.push('ru=' + s.ruralUnit);
    if (s.habitatVisibleLines.length !== 4) parts.push('hv=' + s.habitatVisibleLines.join(','));
    if (s.habitatUnit !== 'pct') parts.push('hu=' + s.habitatUnit);
    // Dispersion state
    if (s.dispersionVisibleLines.length !== 2 || !s.dispersionVisibleLines.includes('dispersa') || !s.dispersionVisibleLines.includes('agrupada'))
        parts.push('dv=' + s.dispersionVisibleLines.join(','));
    if (s.dispersionUnit !== 'pct') parts.push('du=' + s.dispersionUnit);
    if (s.facetYAxis !== 'fixed') parts.push('fy=' + s.facetYAxis);
    history.replaceState(null, '', '#' + parts.join('&'));
}

function _parseHash() {
    const hash = location.hash.slice(1);
    if (!hash) return;
    const params = {};
    hash.split('&').forEach(p => { const [k, v] = p.split('='); if (k && v) params[k] = v; });

    if (params.cat) State.set('activeCategory', params.cat);
    if (params.view) {
        // Backward compat: old 'line'/'area' URLs → 'chart'
        let v = params.view;
        if (v === 'line') { v = 'chart'; State.set('chartType', 'line'); }
        else if (v === 'area') { v = 'chart'; State.set('chartType', 'area'); }
        State.set('activeView', v);
    }
    if (params.ind) State.set('activeIndicator', params.ind);
    if (params.level) State.set('geoLevel', params.level);
    if (params.year) State.set('currentYear', parseInt(params.year));
    if (params.axis) State.set('axisMode', params.axis);
    if (params.t) {
        State.clearTerritories();
        params.t.split(',').forEach(c => State.addTerritory(c));
    }
    if (params.m2) State.set('map2Year', parseInt(params.m2));
    if (params.mm) State.set('mapMode', params.mm);
    if (params.ct) State.set('chartType', params.ct);
    if (params.cl) State.set('chartLayout', params.cl);
    if (params.st) State.set('scaleType', params.st);
    // Rural/habitat state
    if (params.rv) State.set('ruralVisibleLines', params.rv.split(','));
    if (params.rm) State.set('ruralMethod', params.rm);
    if (params.ea) State.set('excludeAgro', params.ea === '1');
    if (params.ru) State.set('ruralUnit', params.ru);
    if (params.hv) State.set('habitatVisibleLines', params.hv.split(','));
    if (params.hu) State.set('habitatUnit', params.hu);
    // Dispersion state
    if (params.dv) State.set('dispersionVisibleLines', params.dv.split(','));
    if (params.du) State.set('dispersionUnit', params.du);
    if (params.fy) State.set('facetYAxis', params.fy);
    // Backward compat: derive ruralMethod + excludeAgro from old indicator IDs
    if (params.ind && RURAL_IND_SET.has(params.ind)) {
        const parts = params.ind.replace('pct_rural_', '').replace(/_ex$/, '');
        State.set('ruralMethod', parts);
        State.set('excludeAgro', params.ind.endsWith('_ex'));
    }
}

/* ════════════════════════════════════════════════
   Export / Fullscreen
   ════════════════════════════════════════════════ */

function _exportCSV() {
    const year = State.get('currentYear');
    const indicator = State.get('activeIndicator');
    const level = State.get('geoLevel');
    const displayLevel = level === 'region' ? 'provincia' : level;
    const ranking = DataLoader.getRanking(year, indicator, displayLevel);

    const def = DataLoader.getIndicatorDef(indicator);
    const unit = def ? def.label : indicator;
    let csv = `Rank,Codigo,Territorio,Provincia,${unit}\n`;
    for (const r of ranking) {
        csv += `${r.rank},"${r.code}","${r.name}","${r.provincia}",${r.value.toFixed(1)}\n`;
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `andalucia_${indicator}_${level}_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function _toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}
