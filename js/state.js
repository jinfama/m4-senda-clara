/* state.js — Centralized pub/sub state management */
const State = (() => {
    const _state = {
        activeCategory: 'clima',
        activeIndicator: 'tmean',
        activeView: 'map',
        geoLevel: 'municipio',
        selectedTerritories: [],
        currentYear: 2024,
        yearRange: [1750, 2024],
        isPlaying: false,
        playSpeed: 100,
        axisMode: 'absolute',
        pickerOpen: false,
        isFullscreen: false,
        map2Year: null,
        mapMode: 'choropleth',
        chartType: 'line',     // 'line' | 'area'
        chartLayout: 'overlay', // 'overlay' | 'facet' | 'sector'
        scaleType: 'linear',   // 'linear' | 'log'
        settingsOpen: false,
        rankingTopN: 20,
        showAverage: false,
        ruralVisibleLines: ['rural', 'urbano'],
        ruralMethod: '5k',
        excludeAgro: false,
        ruralUnit: 'pct',
        habitatVisibleLines: ['pct_ciudad', 'pct_agro', 'pct_nuc', 'pct_disp'],
        habitatUnit: 'pct',
        dispersionVisibleLines: ['dispersa', 'agrupada'],
        dispersionUnit: 'pct',
        facetYAxis: 'fixed',   // 'fixed' | 'auto' — shared vs per-panel Y axis in facets
    };

    const _subs = {};

    function _notify(key) {
        (_subs[key] || []).forEach(fn => fn(_state[key]));
        (_subs['*'] || []).forEach(fn => fn(key, _state[key]));
    }

    return {
        get(key) { return _state[key]; },
        set(key, value) {
            if (JSON.stringify(_state[key]) === JSON.stringify(value)) return;
            _state[key] = value;
            _notify(key);
        },
        subscribe(key, fn) {
            (_subs[key] = _subs[key] || []).push(fn);
        },
        addTerritory(code) {
            const arr = _state.selectedTerritories;
            if (!arr.includes(code)) {
                _state.selectedTerritories = [...arr, code];
                _notify('selectedTerritories');
            }
        },
        removeTerritory(code) {
            const arr = _state.selectedTerritories;
            if (arr.includes(code)) {
                _state.selectedTerritories = arr.filter(c => c !== code);
                _notify('selectedTerritories');
            }
        },
        toggleTerritory(code) {
            _state.selectedTerritories.includes(code)
                ? this.removeTerritory(code)
                : this.addTerritory(code);
        },
        clearTerritories() {
            _state.selectedTerritories = [];
            _notify('selectedTerritories');
        },
        snapshot() { return JSON.parse(JSON.stringify(_state)); },
    };
})();

export default State;
