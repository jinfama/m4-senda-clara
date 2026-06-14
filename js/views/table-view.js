/* table-view.js — Sortable data table */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import { fmt, fmtIndicator } from '../utils.js';

const RURAL_IND_SET = new Set([
    'pct_rural_5k', 'pct_rural_10k', 'pct_rural_5k_nuc', 'pct_rural_10k_nuc',
    'pct_rural_5k_ex', 'pct_rural_10k_ex', 'pct_rural_5k_nuc_ex', 'pct_rural_10k_nuc_ex'
]);

const RURAL_METHOD_LABELS = {
    '5k': '> 5.000 (municipio)',
    '10k': '> 10.000 (municipio)',
    '5k_nuc': '> 5.000 (núcleo)',
    '10k_nuc': '> 10.000 (núcleo)',
};

const TableView = (() => {
    let _initialized = false;
    let _sortCol = 'value';
    let _sortAsc = false;

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('currentYear', render);
        State.subscribe('activeIndicator', render);
        State.subscribe('geoLevel', render);
        State.subscribe('selectedTerritories', render);
        State.subscribe('ruralMethod', render);
        State.subscribe('excludeAgro', render);
    }

    function render() {
        if (State.get('activeView') !== 'table') return;

        const year = State.get('currentYear');
        const indicator = State.get('activeIndicator');
        const level = State.get('geoLevel');
        const selected = State.get('selectedTerritories');

        const displayLevel = level === 'region' ? 'provincia' : level;
        let ranking = DataLoader.getRanking(year, indicator, displayLevel);

        const isRuralMuni = RURAL_IND_SET.has(indicator) && level === 'municipio';

        // Sort
        ranking.sort((a, b) => {
            let va = a[_sortCol] ?? '';
            let vb = b[_sortCol] ?? '';
            if (_sortCol === 'value' && isRuralMuni) {
                // Sort by categorical: Rural before Urbano
                va = (a.value != null && a.value >= 50) ? 0 : 1;
                vb = (b.value != null && b.value >= 50) ? 0 : 1;
            }
            if (typeof va === 'string') return _sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return _sortAsc ? va - vb : vb - va;
        });

        const container = document.getElementById('table-container');
        const arrow = col => _sortCol === col ? (_sortAsc ? ' \u25B2' : ' \u25BC') : '';

        const territoryLabel = level === 'municipio' ? 'Municipio' :
            level === 'comarca' ? 'Comarca' :
            level === 'provincia' ? 'Provincia' : 'Territorio';

        let valueHeader;
        if (isRuralMuni) {
            const method = State.get('ruralMethod');
            const exAgro = State.get('excludeAgro');
            valueHeader = (RURAL_METHOD_LABELS[method] || method) + (exAgro ? ' (excl. agro.)' : '');
        } else {
            valueHeader = (DataLoader.getIndicatorDef(indicator) || {}).label || indicator;
        }

        let html = `<table class="data-table">
            <thead><tr>
                <th data-col="rank">#${arrow('rank')}</th>
                <th data-col="name">${territoryLabel}${arrow('name')}</th>
                <th data-col="provincia">Provincia${arrow('provincia')}</th>
                <th data-col="value">${valueHeader}${arrow('value')}</th>
            </tr></thead><tbody>`;

        for (const item of ranking) {
            const sel = selected.includes(item.code) ? ' class="selected"' : '';
            let displayValue;
            if (isRuralMuni) {
                if (item.value != null) {
                    displayValue = item.value >= 50
                        ? '<span style="color:#d95f02;font-weight:600">Rural</span>'
                        : '<span style="color:#1b9e77;font-weight:600">Urbano</span>';
                } else {
                    displayValue = '<span style="color:#999">—</span>';
                }
            } else {
                displayValue = fmtIndicator(item.value, indicator);
            }
            html += `<tr${sel} data-code="${item.code}">
                <td>${item.rank}</td>
                <td>${item.name}</td>
                <td>${item.provincia || ''}</td>
                <td>${displayValue}</td>
            </tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;

        // Sort handlers
        container.querySelectorAll('th').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                if (_sortCol === col) _sortAsc = !_sortAsc;
                else { _sortCol = col; _sortAsc = col === 'name'; }
                render();
            });
        });

        // Row click to select
        container.querySelectorAll('tr[data-code]').forEach(tr => {
            tr.addEventListener('click', () => State.toggleTerritory(tr.dataset.code));
            tr.style.cursor = 'pointer';
        });
    }

    return { init, render };
})();

export default TableView;
