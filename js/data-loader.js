/* data-loader.js — Multi-category data loader with lazy loading.
   Supports arbitrary categories (poblacion, clima, etc.) loaded on demand.
   Each category has its own year range and data arrays. */
const DataLoader = (() => {
    let _geoData = {};              // level -> GeoJSON FeatureCollection
    let _meta = null;
    let _indicatorDefs = {};        // indId -> {def + _category}
    let _stores = {};               // catId -> {years, index, byLevel}
    let _monthlyStores = {};        // catId -> {years, index}
    let _loadPromises = {};
    let _monthlyPromises = {};
    let _activeCategory = 'clima';
    let _initialized = false;

    async function init() {
        if (_initialized) return;
        _initialized = true;
        const [munGeo, comGeo, provGeo, metaRaw] = await Promise.all([
            fetch('data/municipios.geojson').then(r => r.json()),
            fetch('data/comarcas.geojson').then(r => r.json()),
            fetch('data/provincias.geojson').then(r => r.json()),
            fetch('data/metadata.json').then(r => r.json()),
        ]);
        _geoData = { municipio: munGeo, comarca: comGeo, provincia: provGeo };
        _meta = metaRaw;

        // Build indicator definitions (flatten all categories)
        _indicatorDefs = {};
        for (const cat of _meta.categories) {
            for (const grp of (cat.indicatorGroups || [])) {
                for (const ind of grp.indicators) {
                    _indicatorDefs[ind.id] = { ...ind, _category: cat.id };
                }
            }
        }

        // Load default category (first enabled)
        const defaultCat = _meta.categories.find(c => c.enabled);
        if (defaultCat) {
            await loadCategory(defaultCat.id);
            _activeCategory = defaultCat.id;
        }
    }

    async function loadCategory(catId) {
        if (_stores[catId]) return;
        if (_loadPromises[catId]) return _loadPromises[catId];
        const cat = _meta.categories.find(c => c.id === catId);
        if (!cat || !cat.dataFiles || !cat.dataFiles.annual) {
            throw new Error(`No data files for category: ${catId}`);
        }
        _loadPromises[catId] = (async () => {
            const dataRaw = await fetch(cat.dataFiles.annual).then(r => r.json());
            const store = {
                years: dataRaw.years,
                index: {},
                byLevel: { region: [], provincia: [], comarca: [], municipio: [] },
            };
            for (const t of dataRaw.territories) {
                store.index[t.code] = t;
                if (store.byLevel[t.level]) store.byLevel[t.level].push(t);
            }
            _stores[catId] = store;
        })();
        return _loadPromises[catId];
    }

    async function loadMonthlyData(catId) {
        const cid = catId || _activeCategory;
        if (_monthlyStores[cid]) return;
        if (_monthlyPromises[cid]) return _monthlyPromises[cid];
        const cat = _meta.categories.find(c => c.id === cid);
        if (!cat || !cat.dataFiles || !cat.dataFiles.monthly) return;
        _monthlyPromises[cid] = (async () => {
            const dataRaw = await fetch(cat.dataFiles.monthly).then(r => r.json());
            const store = { years: dataRaw.years, index: {} };
            for (const t of dataRaw.territories) {
                store.index[t.code] = t;
            }
            _monthlyStores[cid] = store;
        })();
        return _monthlyPromises[cid];
    }

    function hasCategory(catId) {
        return !!_stores[catId];
    }

    function hasMonthlyData(catId) {
        const cid = catId || _activeCategory;
        return !!_monthlyStores[cid];
    }

    function setActiveCategory(catId) { _activeCategory = catId; }
    function getActiveCategory() { return _activeCategory; }

    /** Get years for a category (defaults to active) */
    function getYears(catId) {
        const cid = catId || _activeCategory;
        const store = _stores[cid];
        return store ? store.years : [];
    }

    function getYearRange(catId) {
        const years = getYears(catId);
        return years.length > 0 ? [years[0], years[years.length - 1]] : [1750, 2024];
    }

    function getMeta() { return _meta; }

    /** Get territory metadata — prefers poblacion store (most complete) */
    function getTerritoryMeta(code) {
        const popStore = _stores.poblacion;
        if (popStore && popStore.index[code]) return popStore.index[code];
        for (const catId of Object.keys(_stores)) {
            if (_stores[catId].index[code]) return _stores[catId].index[code];
        }
        return null;
    }

    /** Get all territories at a level — always from poblacion store */
    function getAllTerritories(level) {
        const store = _stores.poblacion || _stores[_activeCategory];
        if (!store) return [];
        return level ? (store.byLevel[level] || []) : Object.values(store.index);
    }

    function getIndicatorDef(indicatorId) {
        return _indicatorDefs[indicatorId] || null;
    }

    function getEnabledIndicators() {
        const result = [];
        for (const cat of _meta.categories) {
            if (!cat.enabled) continue;
            for (const grp of (cat.indicatorGroups || [])) {
                for (const ind of grp.indicators) {
                    if (ind.enabled) result.push({ ...ind, group: grp.id, groupLabel: grp.label });
                }
            }
        }
        return result;
    }

    function _yearIdx(year, store) {
        return store.years.indexOf(year);
    }

    function _rawField(code, year, field, store) {
        const t = store.index[code];
        if (!t) return null;
        const arr = t[field];
        if (!arr) return null;
        const idx = _yearIdx(year, store);
        if (idx < 0) return null;
        return arr[idx];
    }

    function getValue(code, year, indicator) {
        const def = _indicatorDefs[indicator];
        if (!def) return null;
        const store = _stores[def._category];
        if (!store) return null;

        if (def.computed) {
            if (def.formula === 'pop/area') {
                const pop = _rawField(code, year, 'pop', store);
                if (pop == null) return null;
                const t = store.index[code];
                if (!t || !t.area_km2) return null;
                return pop / t.area_km2;
            }
            if (def.formula === 'pop-nuc') {
                const pop = _rawField(code, year, 'pop', store);
                const nuc = _rawField(code, year, 'nuc', store);
                if (pop == null || nuc == null) return null;
                return pop - nuc;
            }
            if (def.formula === '100-disp') {
                const disp = _rawField(code, year, 'disp', store);
                if (disp == null) return null;
                return 100 - disp;
            }
            return null;
        }

        return _rawField(code, year, def.dataField, store);
    }

    function getTimeSeries(code, indicator) {
        const def = _indicatorDefs[indicator];
        if (!def) return [];
        const store = _stores[def._category];
        if (!store) return [];
        return store.years.map(y => ({
            year: y,
            value: getValue(code, y, indicator),
        })).filter(d => d.value != null);
    }

    function getRanking(year, indicator, geoLevel) {
        const def = _indicatorDefs[indicator];
        if (!def) return [];
        const store = _stores[def._category];
        if (!store) return [];
        const list = store.byLevel[geoLevel] || [];
        const entries = [];
        for (const t of list) {
            const v = getValue(t.code, year, indicator);
            if (v != null) entries.push({ code: t.code, name: t.name, provincia: t.provincia || '', value: v });
        }
        entries.sort((a, b) => b.value - a.value);
        entries.forEach((e, i) => e.rank = i + 1);
        return entries;
    }

    function getRankingEvolution(indicator, geoLevel, topN) {
        const def = _indicatorDefs[indicator];
        if (!def) return { evolution: {}, topCodes: new Set(), totalCount: 0 };
        const store = _stores[def._category];
        if (!store) return { evolution: {}, topCodes: new Set(), totalCount: 0 };

        const list = store.byLevel[geoLevel] || [];
        const evolution = {};
        for (const year of store.years) {
            const entries = [];
            for (const t of list) {
                const v = getValue(t.code, year, indicator);
                if (v != null) entries.push({ code: t.code, value: v });
            }
            entries.sort((a, b) => b.value - a.value);
            entries.forEach((e, i) => {
                if (!evolution[e.code]) evolution[e.code] = [];
                evolution[e.code].push({ year, rank: i + 1, value: e.value });
            });
        }
        const latestYear = store.years[store.years.length - 1];
        const latestRanking = getRanking(latestYear, indicator, geoLevel);
        const topCodes = new Set(latestRanking.slice(0, topN).map(e => e.code));
        return { evolution, topCodes, totalCount: list.length };
    }

    function getLevelTotal(year, indicator, geoLevel) {
        const def = _indicatorDefs[indicator];
        if (!def) return 0;
        const store = _stores[def._category];
        if (!store) return 0;
        const list = store.byLevel[geoLevel] || [];
        let sum = 0;
        for (const t of list) {
            const v = getValue(t.code, year, indicator);
            if (v != null) sum += v;
        }
        return sum;
    }

    function searchTerritories(query, geoLevel) {
        if (!query || query.length < 1) return [];
        const q = query.toLowerCase().trim();
        const store = _stores.poblacion || _stores[_activeCategory];
        if (!store) return [];
        const list = geoLevel ? (store.byLevel[geoLevel] || []) : Object.values(store.index);

        const scored = [];
        for (const t of list) {
            const name = t.name.toLowerCase();
            const code = t.code.toLowerCase();
            let score = 0;
            if (name === q) score = 100;
            else if (name.startsWith(q)) score = 80;
            else if (name.includes(q)) score = 60;
            else if (code.startsWith(q)) score = 50;
            else if (code.includes(q)) score = 40;
            else if ((t.provincia || '').toLowerCase().includes(q)) score = 10;
            if (score > 0) scored.push({ t, score });
        }
        scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
        return scored.slice(0, 20).map(s => s.t);
    }

    function getGeoFeatures(level) {
        return _geoData[level] || null;
    }

    /** Get monthly data object for a territory {tmean:[...], prec:[...]} */
    function getMonthlyData(code, catId) {
        const cid = catId || _activeCategory;
        const store = _monthlyStores[cid];
        if (!store) return null;
        return store.index[code] || null;
    }

    /** Get years array for monthly store */
    function getMonthlyYears(catId) {
        const cid = catId || _activeCategory;
        const store = _monthlyStores[cid];
        return store ? store.years : [];
    }

    return {
        init, loadCategory, loadMonthlyData,
        hasCategory, hasMonthlyData,
        setActiveCategory, getActiveCategory,
        getYears, getYearRange, getMeta, getTerritoryMeta,
        getAllTerritories, getValue, getTimeSeries,
        getRanking, getRankingEvolution, getLevelTotal,
        searchTerritories, getGeoFeatures,
        getIndicatorDef, getEnabledIndicators,
        getMonthlyData, getMonthlyYears,
    };
})();

export default DataLoader;
