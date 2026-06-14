/* utils.js — Formatters, color scales, constants */

/* ── Mediterranean / Andalusian comparison palette ── */
export const COLORS = [
    '#2a7f62',   // olive green
    '#1a6b8a',   // Mediterranean blue
    '#c96b30',   // terracotta
    '#5b8c5a',   // sage green
    '#8b5e3c',   // earth brown
    '#3a9e96',   // turquoise
    '#7c6ea0',   // lavender
    '#d4a843',   // golden amber
    '#4a8fa8',   // sea blue
    '#9b6b4d',   // clay
];

export function territoryColor(idx) {
    return COLORS[idx % COLORS.length];
}

/* ── Ranking band palette (20 bands from top to bottom) ── */
export const RANK_PALETTE = [
    '#0b4f3e', '#14694f', '#1a8562', '#2a9e76', '#45b48c',
    '#66c9a2', '#8ddab9', '#aee8ce', '#c9f0dd', '#e0f6ea',
    '#f0f4e8', '#f5f0d0', '#f5e4b0', '#f2d08c', '#e6b46a',
    '#d99650', '#c97a3c', '#b5602e', '#9c4524', '#7a2e1c',
];

/* ── Number formatting ── */
export function fmt(v, decimals = 0) {
    if (v == null || isNaN(v)) return '—';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + ' M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + ' K';
    return v.toLocaleString('es-ES', { maximumFractionDigits: decimals });
}

export function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return v.toFixed(1) + '%';
}

/** Compute smart X-axis tick values: always includes first and last year,
 *  plus evenly spaced intermediates that won't overlap.
 *  @param {[number,number]} domain - [minYear, maxYear]
 *  @param {number} pixelWidth - available axis width in pixels
 *  @param {number} [tickWidth=40] - estimated pixel width per tick label
 */
export function smartXTicks(domain, pixelWidth, tickWidth = 40) {
    const [y0, y1] = domain;
    if (y0 === y1) return [y0];
    const maxTicks = Math.max(2, Math.floor(pixelWidth / tickWidth));
    const span = y1 - y0;
    // Pick a "nice" step (multiples of 5, 10, 20, 25, 50, 100...)
    const rawStep = span / (maxTicks - 1);
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
    let step = niceSteps.find(s => s >= rawStep) || Math.ceil(rawStep / 100) * 100;
    const ticks = [y0];
    const firstNice = Math.ceil(y0 / step) * step;
    for (let y = firstNice; y < y1; y += step) {
        if (y > y0 && y < y1) ticks.push(y);
    }
    ticks.push(y1);
    // Remove intermediates that are too close to endpoints (pixel-based check)
    const pxPerUnit = pixelWidth / span;
    const minPxGap = tickWidth * 0.9; // need ~90% of tickWidth between labels
    return ticks.filter((t, i) => {
        if (i === 0 || i === ticks.length - 1) return true;
        const pxFromStart = (t - y0) * pxPerUnit;
        const pxFromEnd = (y1 - t) * pxPerUnit;
        return pxFromStart >= minPxGap && pxFromEnd >= minPxGap;
    });
}

/** Format a value according to its indicator type */
export function fmtIndicator(v, indicator) {
    if (v == null || isNaN(v)) return '—';
    // Categorical habitat
    if (indicator === 'hab4') {
        const cat = HAB4_CATEGORIES.find(c => c.code === v);
        return cat ? cat.label : '—';
    }
    const pctIndicators = ['pct_dispersion', 'pct_agrupada',
                           'pct_rural_5k', 'pct_rural_10k', 'pct_rural_5k_nuc', 'pct_rural_10k_nuc',
                           'pct_rural_5k_ex', 'pct_rural_10k_ex', 'pct_rural_5k_nuc_ex', 'pct_rural_10k_nuc_ex',
                           'pct_agr', 'pct_ind', 'pct_ser',
                           'pct_ciudad', 'pct_agrociudad', 'pct_nucleado', 'pct_disperso'];
    if (pctIndicators.includes(indicator)) return fmtPct(v);
    if (indicator === 'densidad') return v.toFixed(1) + ' hab/km²';
    if (indicator === 'tmean' || indicator === 'tmin' || indicator === 'tmax') return v.toFixed(1) + ' °C';
    if (indicator === 'prec') return Math.round(v) + ' mm/año';
    if (indicator === 'habitantes' || indicator === 'pob_dispersa' || indicator === 'pob_agrupada'
        || indicator === 'n_agr' || indicator === 'n_ind' || indicator === 'n_ser')
        return fmt(v) + ' personas';
    return fmt(v);
}

/** Build a tooltip context subtitle showing category · indicator — year.
 *  @param {object} meta - DataLoader metadata (.categories)
 *  @param {string} categoryId
 *  @param {string} indicatorId
 *  @param {number} [year]
 *  @returns {string} HTML snippet for a tooltip subtitle row
 */
export function fmtTooltipContext(meta, categoryId, indicatorId, year) {
    const cat = meta && meta.categories ? meta.categories.find(c => c.id === categoryId) : null;
    const catLabel = cat ? cat.label : '';
    let indLabel = indicatorId;
    if (cat) {
        for (const grp of (cat.indicatorGroups || [])) {
            const ind = grp.indicators.find(i => i.id === indicatorId || i.id === indicatorId.replace(/_ex$/, ''));
            if (ind) {
                // Avoid redundancy: skip group label if it matches category label
                indLabel = (grp.pillLabel && grp.pillLabel !== catLabel)
                    ? grp.pillLabel + ' · ' + ind.label
                    : ind.label;
                break;
            }
        }
    }
    const parts = [catLabel, indLabel].filter(Boolean).join(' · ');
    return year != null
        ? `<div class="tooltip-sub">${parts} — ${year}</div>`
        : `<div class="tooltip-sub">${parts}</div>`;
}

/* ── Sidebar category icons ── */
export const CATEGORY_ICONS = {
    clima: '<path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/>',
    poblacion: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
    empleo: '<path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-2 .89-2 2v11c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/>',
    suelo: '<path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"/>',
    agraria: '<path d="M17.2 3.3c.18-.51-.12-1.07-.65-1.19-.52-.12-1.05.2-1.18.71l-.71 2.74c-.14.51.18 1.04.69 1.16l.06.01c.48.1.97-.2 1.1-.7l.69-2.73zM12 6c-1.1 0-2 .9-2 2 0 .74.4 1.38 1 1.72V21h2V9.72c.6-.34 1-.98 1-1.72 0-1.1-.9-2-2-2zm-4.2.3l.69 2.73c.13.5.62.8 1.1.7l.06-.01c.51-.12.83-.65.69-1.16l-.71-2.74c-.13-.51-.66-.83-1.18-.71-.53.12-.83.68-.65 1.19zM7 14h10v2H7v-2zm1 4h8v2H8v-2z"/>',
    transportes: '<path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/>',
};

/* ── View type icons ── */
export const VIEW_ICONS = {
    map: '<path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>',
    chart: '<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/><path d="M3 13h2v5H3z" opacity=".3"/>',
    line: '<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>',
    area: '<path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/><path d="M3.5 18.49l6-6.01 4 4L22 6.92" fill="none" stroke="currentColor" stroke-width="2"/>',
    ranking: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>',
    table: '<path d="M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z"/>',
    about: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
    stripes: '<path d="M3 3h2v18H3zm4 0h2v18H7zm4 0h2v18h-2zm4 0h2v18h-2zm4 0h2v18h-2z"/>',
    climogram: '<path d="M4 18h2v-4H4v4zm4 0h2v-8H8v8zm4 0h2v-6h-2v6zm4 0h2v-10h-2v10z"/><path d="M3 8l4-3 4 2 4-4 4 3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    spaghetti: '<path d="M3 17c3-8 6-2 9-10s6 2 9-3" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3"/><path d="M3 14c3-6 6-1 9-8s6 1 9-2" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3"/><path d="M3 12c3-4 6 1 9-6s6 3 9-1" fill="none" stroke="currentColor" stroke-width="2"/>',
    ridge: '<path d="M3 19h18M3 15c2-4 4-6 6-6s4 2 6 2 4-3 6-3" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/><path d="M3 11c2-4 4-7 6-7s4 3 6 3 4-4 6-4" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/><path d="M3 7c2-3 4-5 6-5s4 2 6 2 4-3 6-3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    palimpsesto: '<path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/>',
};

/* ── Habitat 4-type categorical definition ── */
export const HAB4_CATEGORIES = [
    { code: 1, id: 'ciudad',     label: 'Ciudad',          color: '#4e79a7' },
    { code: 2, id: 'agrociudad', label: 'Agrociudad',      color: '#e15759' },
    { code: 3, id: 'nucleado',   label: 'Pueblo nucleado', color: '#59a14f' },
    { code: 4, id: 'disperso',   label: 'Pueblo disperso', color: '#b07aa1' },
];

/* ── Map color scales — Mediterranean tones ── */
export const MAP_SCALES = {
    habitantes: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7fcf5', '#dff2d8', '#b5ddb5', '#7ec89a',
            '#41ae76', '#2a8c6a', '#1a6b5a', '#0b4f3e', '#043326',
        ])(t),
        domain: [100, 1000000],
        type: 'log',
        label: 'Habitantes',
    },
    densidad: {
        interpolator: t => d3.interpolateRgbBasis([
            '#fef9f0', '#fdecc8', '#f9d89c', '#f2c06a',
            '#e6a04a', '#d48030', '#b5602e', '#8c3c1c', '#5c2010',
        ])(t),
        domain: [1, 5000],
        type: 'log',
        label: 'Densidad (hab/km²)',
    },
    pct_dispersion: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7fbff', '#d4e4f7', '#a6cce3', '#6baed6',
            '#4292c6', '#2171b5', '#084594', '#042f6b',
        ])(t),
        domain: [0, 60],
        type: 'linear',
        label: '% Dispersión',
    },
    pob_agrupada: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7fcf5', '#dff2d8', '#b5ddb5', '#7ec89a',
            '#41ae76', '#2a8c6a', '#1a6b5a', '#0b4f3e', '#043326',
        ])(t),
        domain: [100, 500000],
        type: 'log',
        label: 'Pob. agrupada',
    },
    pob_dispersa: {
        interpolator: t => d3.interpolateRgbBasis([
            '#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b',
            '#fd8d3c', '#e6550d', '#a63603', '#7f2704',
        ])(t),
        domain: [10, 10000],
        type: 'log',
        label: 'Pob. dispersa',
    },
    // Rural indicators: dichotomous — binary threshold at 50%
    // At municipal level, values are 0% (urban) or 100% (rural)
    pct_rural_5k: {
        dichotomous: true,
        threshold: 50,
        colors: ['#1b9e77', '#d95f02'],  // urban blue, rural terracotta
        labels: ['Urbano', 'Rural'],
        domain: [0, 100],
        type: 'linear',
        label: 'Rural/Urbano (mun>5k)',
    },
    pct_rural_10k: {
        dichotomous: true,
        threshold: 50,
        colors: ['#1b9e77', '#d95f02'],
        labels: ['Urbano', 'Rural'],
        domain: [0, 100],
        type: 'linear',
        label: 'Rural/Urbano (mun>10k)',
    },
    pct_rural_5k_nuc: {
        dichotomous: true,
        threshold: 50,
        colors: ['#1b9e77', '#d95f02'],
        labels: ['Urbano', 'Rural'],
        domain: [0, 100],
        type: 'linear',
        label: 'Rural/Urbano (núcleo>5k)',
    },
    pct_rural_10k_nuc: {
        dichotomous: true,
        threshold: 50,
        colors: ['#1b9e77', '#d95f02'],
        labels: ['Urbano', 'Rural'],
        domain: [0, 100],
        type: 'linear',
        label: 'Rural/Urbano (núcleo>10k)',
    },
    // Rural excluding agrociudades (same palette as base)
    pct_rural_5k_ex: { type: 'alias', aliasOf: 'pct_rural_5k' },
    pct_rural_10k_ex: { type: 'alias', aliasOf: 'pct_rural_10k' },
    pct_rural_5k_nuc_ex: { type: 'alias', aliasOf: 'pct_rural_5k_nuc' },
    pct_rural_10k_nuc_ex: { type: 'alias', aliasOf: 'pct_rural_10k_nuc' },
    // Habitat categorical
    hab4: {
        type: 'categorical',
        categories: HAB4_CATEGORIES,
        label: 'Tipo de hábitat',
    },
    // Habitat percentages
    pct_ciudad: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7f9fc', '#d4dff0', '#a6bfdd', '#6b9cc8', '#4e79a7', '#3a5f88', '#264568',
        ])(t),
        domain: [0, 100], type: 'linear', label: '% Ciudad',
    },
    pct_agrociudad: {
        interpolator: t => d3.interpolateRgbBasis([
            '#fdf2f2', '#f9d4d4', '#f0a8a8', '#e15759', '#c23b3d', '#962d2f', '#6b2021',
        ])(t),
        domain: [0, 100], type: 'linear', label: '% Agrociudad',
    },
    pct_nucleado: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f4f9f2', '#d4eacd', '#a8d69e', '#7bc26f', '#59a14f', '#42803c', '#2c5f29',
        ])(t),
        domain: [0, 100], type: 'linear', label: '% Pueblo nucleado',
    },
    pct_disperso: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f8f4fa', '#e4d8ec', '#cbb3d9', '#b07aa1', '#955e87', '#7a436e', '#5f2955',
        ])(t),
        domain: [0, 100], type: 'linear', label: '% Pueblo disperso',
    },
    // Climate indicators
    tmean: {
        interpolator: t => d3.interpolateRgbBasis([
            '#fff5eb', '#fde0c5', '#f5c08b', '#f09850',
            '#e47020', '#c44e10', '#942808', '#5c1400',
        ])(t),
        domain: [8, 20],
        type: 'linear',
        label: 'Temp. media (°C)',
    },
    tmin: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7fbff', '#d4e4f7', '#a6cce3', '#6baed6',
            '#4292c6', '#2171b5', '#084594', '#042f6b',
        ])(t),
        domain: [2, 14],
        type: 'linear',
        label: 'Temp. mínima (°C)',
    },
    tmax: {
        interpolator: t => d3.interpolateRgbBasis([
            '#ffffcc', '#ffeda0', '#feb24c', '#fd8d3c',
            '#fc4e2a', '#e31a1c', '#bd0026', '#800026',
        ])(t),
        domain: [14, 28],
        type: 'linear',
        label: 'Temp. máxima (°C)',
    },
    prec: {
        interpolator: t => d3.interpolateRgbBasis([
            '#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb',
            '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84',
        ])(t),
        domain: [150, 1500],
        type: 'linear',
        label: 'Precipitación (mm)',
    },
    // Employment indicators
    pct_agr: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7fcf5', '#dff2d8', '#b5ddb5', '#7ec89a',
            '#41ae76', '#2a8c6a', '#1a6b5a', '#0b4f3e', '#043326',
        ])(t),
        domain: [0, 80],
        type: 'linear',
        label: '% Agricultura',
    },
    pct_ind: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7f4f9', '#e7e1ef', '#c9b9d7', '#a68cc1',
            '#8c6bb1', '#7a5ba5', '#6a4c93', '#553c7d', '#3f2d66',
        ])(t),
        domain: [0, 50],
        type: 'linear',
        label: '% Industria',
    },
    pct_ser: {
        interpolator: t => d3.interpolateRgbBasis([
            '#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b',
            '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704',
        ])(t),
        domain: [0, 80],
        type: 'linear',
        label: '% Servicios',
    },
    n_agr: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7fcf5', '#dff2d8', '#b5ddb5', '#7ec89a',
            '#41ae76', '#2a8c6a', '#1a6b5a', '#0b4f3e', '#043326',
        ])(t),
        domain: [10, 50000],
        type: 'log',
        label: 'Trab. Agricultura',
    },
    n_ind: {
        interpolator: t => d3.interpolateRgbBasis([
            '#f7f4f9', '#e7e1ef', '#c9b9d7', '#a68cc1',
            '#8c6bb1', '#7a5ba5', '#6a4c93', '#553c7d', '#3f2d66',
        ])(t),
        domain: [10, 50000],
        type: 'log',
        label: 'Trab. Industria',
    },
    n_ser: {
        interpolator: t => d3.interpolateRgbBasis([
            '#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b',
            '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704',
        ])(t),
        domain: [10, 100000],
        type: 'log',
        label: 'Trab. Servicios',
    },
};

/** Ed Hawkins warming-stripes diverging scale (blue → white → red) */
export function buildAnomalyScale(minVal, maxVal) {
    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 1;
    const interp = d3.interpolateRgbBasis([
        '#08306b', '#2171b5', '#6baed6', '#c6dbef',
        '#f7f7f7',
        '#fdd49e', '#fc8d59', '#d7301f', '#7f0000',
    ]);
    const scale = d3.scaleLinear().domain([-absMax, absMax]).range([0, 1]).clamp(true);
    return v => v == null ? '#e8e6e1' : interp(scale(v));
}

/** Precipitation anomaly scale (brown → white → blue) */
export function buildPrecAnomalyScale(minVal, maxVal) {
    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 1;
    const interp = d3.interpolateRgbBasis([
        '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3',
        '#f7f7f7',
        '#c7eae5', '#80cdc1', '#35978f', '#01665e',
    ]);
    const scale = d3.scaleLinear().domain([-absMax, absMax]).range([0, 1]).clamp(true);
    return v => v == null ? '#e8e6e1' : interp(scale(v));
}

export function buildColorScale(indicator, values) {
    let cfg = MAP_SCALES[indicator] || MAP_SCALES.habitantes;

    // Resolve aliases (rural _ex variants reuse base palette)
    if (cfg.type === 'alias') {
        cfg = MAP_SCALES[cfg.aliasOf] || MAP_SCALES.habitantes;
    }

    // Categorical: direct code → color mapping
    if (cfg.type === 'categorical') {
        const colorMap = {};
        for (const c of cfg.categories) colorMap[c.code] = c.color;
        return v => (v == null) ? '#e8e6e1' : (colorMap[v] || '#e8e6e1');
    }

    // Allow zero/negative values for percentage and climate indicators
    const isPct = indicator.startsWith('pct_');
    const isClimate = ['tmean', 'tmin', 'tmax', 'prec'].includes(indicator);
    const allowAll = isPct || isClimate;
    const interp = cfg.interpolator;

    // Dichotomous: binary threshold → 2 colors (rural/urban)
    if (cfg.dichotomous) {
        return v => v == null ? '#e8e6e1' : (v >= cfg.threshold ? cfg.colors[1] : cfg.colors[0]);
    }

    // Fixed scale: always use the declared domain (no quantile), ensures stable colors across years
    if (cfg.fixed) {
        const scale = d3.scaleLinear().domain(cfg.domain).range([0, 1]).clamp(true);
        return v => v == null ? '#e8e6e1' : interp(scale(v));
    }

    if (values && values.length > 2) {
        const valid = values.filter(v => v != null && (allowAll ? true : v > 0)).sort((a, b) => a - b);
        if (valid.length > 2) {
            const quantileScale = d3.scaleQuantile()
                .domain(valid)
                .range(d3.range(9).map(i => i / 8));
            return v => (v == null || (!allowAll && v <= 0)) ? '#e8e6e1' : interp(quantileScale(v));
        }
    }
    // Fallback: fixed log/linear scale
    const scale = cfg.type === 'log'
        ? d3.scaleLog().domain(cfg.domain).range([0, 1]).clamp(true)
        : d3.scaleLinear().domain(cfg.domain).range([0, 1]).clamp(true);
    return v => (v == null || (!allowAll && v <= 0)) ? '#e8e6e1' : interp(scale(v));
}

/** Check if an indicator is categorical */
export function isCategoricalIndicator(indicator) {
    const cfg = MAP_SCALES[indicator];
    return cfg && cfg.type === 'categorical';
}
