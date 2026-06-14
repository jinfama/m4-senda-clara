/* territory-picker.js — Slide-in panel for selecting territories
   Now includes level tabs (Municipios/Comarcas/Provincias/Andalucía). */
import State from '../state.js';
import DataLoader from '../data-loader.js';

const TerritoryPicker = (() => {
    let _initialized = false;
    let _visibleCodes = [];

    const LEVEL_LABELS = {
        municipio: 'Municipios',
        comarca: 'Comarcas',
        provincia: 'Provincias',
        region: 'Andalucía',
    };
    const SEARCH_PLACEHOLDERS = {
        municipio: 'Buscar municipio...',
        comarca: 'Buscar comarca...',
        provincia: 'Buscar provincia...',
        region: '',
    };

    function init() {
        if (_initialized) return;
        _initialized = true;

        document.getElementById('picker-close').addEventListener('click', close);
        document.getElementById('picker-backdrop').addEventListener('click', close);
        document.getElementById('picker-search').addEventListener('input', _onSearch);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && State.get('pickerOpen')) close(); });

        State.subscribe('pickerOpen', open => {
            document.getElementById('picker-overlay').classList.toggle('open', open);
            if (open) {
                document.getElementById('picker-search').value = '';
                _buildLevels();
                _updateSearchPlaceholder();
                _render();
                document.getElementById('picker-search').focus();
            }
        });
        State.subscribe('selectedTerritories', () => { if (State.get('pickerOpen')) _render(); });
        State.subscribe('geoLevel', () => {
            if (State.get('pickerOpen')) {
                _buildLevels();
                _updateSearchPlaceholder();
                document.getElementById('picker-search').value = '';
                _render();
            }
        });
    }

    function open() { State.set('pickerOpen', true); }
    function close() { State.set('pickerOpen', false); }

    function _buildLevels() {
        const container = document.getElementById('picker-levels');
        if (!container) return;
        const level = State.get('geoLevel');
        const view = State.get('activeView');
        // Show Andalucía option only in non-map views
        const showAndalucia = view !== 'map';

        let html = '';
        const levels = [
            { id: 'municipio', label: 'Municipios' },
            { id: 'comarca', label: 'Comarcas' },
            { id: 'provincia', label: 'Provincias' },
        ];
        if (showAndalucia) {
            levels.push({ id: 'region', label: 'Andalucía' });
        }

        for (const l of levels) {
            const active = l.id === level ? ' active' : '';
            html += `<button class="picker-level-btn${active}" data-level="${l.id}">${l.label}</button>`;
        }
        container.innerHTML = html;

        container.querySelectorAll('.picker-level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const newLevel = btn.dataset.level;
                if (newLevel === 'region') {
                    // Andalucía: select regional aggregate directly
                    State.clearTerritories();
                    State.set('geoLevel', 'region');
                    State.addTerritory('AND');
                    close();
                    return;
                }
                State.clearTerritories();
                State.set('geoLevel', newLevel);
            });
        });
    }

    function _updateSearchPlaceholder() {
        const level = State.get('geoLevel');
        const input = document.getElementById('picker-search');
        if (input) input.placeholder = SEARCH_PLACEHOLDERS[level] || 'Buscar...';
    }

    function _onSearch() {
        _render(document.getElementById('picker-search').value);
    }

    function _selectAll() {
        for (const code of _visibleCodes) {
            State.addTerritory(code);
        }
    }

    function _render(query = '') {
        const body = document.getElementById('picker-body');
        const selected = State.get('selectedTerritories');
        const level = State.get('geoLevel');
        const displayLevel = level === 'region' ? 'provincia' : level;
        let html = '';
        _visibleCodes = [];

        // Selection actions bar
        html += `<div class="picker-section-title">
            <span>Seleccionados (${selected.length})</span>
            <span class="picker-actions">
                <button class="picker-select-all" id="picker-select-all-btn">Seleccionar todos</button>
                ${selected.length > 0 ? '<button class="picker-clear" onclick="document.dispatchEvent(new CustomEvent(\'picker-clear\'))">Limpiar</button>' : ''}
            </span>
        </div>`;
        if (selected.length > 0) {
            for (const code of selected) {
                const t = DataLoader.getTerritoryMeta(code);
                if (t) html += _itemHtml(t, true);
            }
        }

        // Filter territories — search within current level only
        let territories;
        if (query.length > 0) {
            territories = DataLoader.searchTerritories(query, displayLevel);
        } else {
            territories = DataLoader.getAllTerritories(displayLevel);
        }

        // Track visible codes
        for (const t of territories) {
            _visibleCodes.push(t.code);
        }

        // Group by provincia for municipio/comarca levels
        if (!query && (displayLevel === 'municipio' || displayLevel === 'comarca')) {
            const groups = {};
            for (const t of territories) {
                const prov = t.provincia || 'Otros';
                (groups[prov] = groups[prov] || []).push(t);
            }
            for (const [prov, items] of Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))) {
                html += `<div class="picker-section-title"><span>${prov} (${items.length})</span></div>`;
                for (const t of items.sort((a, b) => a.name.localeCompare(b.name))) {
                    html += _itemHtml(t, selected.includes(t.code));
                }
            }
        } else {
            if (territories.length > 0) {
                const label = query ? 'Resultados' : (LEVEL_LABELS[displayLevel] || 'Territorios');
                html += `<div class="picker-section-title"><span>${label} (${territories.length})</span></div>`;
                for (const t of territories.sort((a, b) => a.name.localeCompare(b.name))) {
                    html += _itemHtml(t, selected.includes(t.code));
                }
            }
        }

        if (!html) {
            html = '<div style="padding:20px;color:var(--c-text-3);text-align:center;">Sin resultados</div>';
        }

        body.innerHTML = html;

        body.querySelectorAll('.picker-item').forEach(el => {
            el.addEventListener('click', () => {
                State.toggleTerritory(el.dataset.code);
            });
        });

        const selectAllBtn = document.getElementById('picker-select-all-btn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', _selectAll);
        }
    }

    function _itemHtml(t, isSelected) {
        const cls = isSelected ? 'picker-item selected' : 'picker-item';
        let tag = '';
        if (t.level === 'municipio' && t.provincia) {
            tag = `<span class="picker-item-tag">${t.provincia}</span>`;
        } else if (t.level === 'comarca') {
            tag = `<span class="picker-item-tag">Comarca${t.provincia ? ' · ' + t.provincia : ''}</span>`;
        } else if (t.level === 'provincia') {
            tag = `<span class="picker-item-tag">Provincia</span>`;
        } else if (t.level === 'region') {
            tag = `<span class="picker-item-tag">Región</span>`;
        }
        return `<div class="${cls}" data-code="${t.code}">
            <div class="picker-checkbox"></div>
            <span class="picker-item-name">${t.name}</span>
            ${tag}
        </div>`;
    }

    // Handle clear button
    document.addEventListener('picker-clear', () => State.clearTerritories());

    return { init, open, close };
})();

export default TerritoryPicker;
