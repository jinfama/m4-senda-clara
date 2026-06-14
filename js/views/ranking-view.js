/* ranking-view.js — Atlas-style bump chart with top-N filter
   Adapts rank count to geo level. */
import State from '../state.js';
import DataLoader from '../data-loader.js';
import Tooltip from '../components/tooltip.js';
import { RANK_PALETTE, fmt, fmtIndicator, fmtTooltipContext, territoryColor } from '../utils.js';

const RankingView = (() => {
    let _initialized = false;
    const margin = { top: 48, right: 140, bottom: 36, left: 50 };

    function init() {
        if (_initialized) return;
        _initialized = true;
        State.subscribe('activeIndicator', render);
        State.subscribe('geoLevel', _onGeoChange);
        State.subscribe('selectedTerritories', render);
        State.subscribe('rankingTopN', render);
    }

    function _onGeoChange() {
        const level = State.get('geoLevel');
        const displayLevel = level === 'region' ? 'provincia' : level;
        const total = DataLoader.getAllTerritories(displayLevel).length;
        const topN = State.get('rankingTopN');

        // Auto-adjust for small levels
        if (total <= 10) {
            State.set('rankingTopN', 0);
        } else if (topN === 0 || topN > total) {
            State.set('rankingTopN', 20);
        }

        render();
    }

    function render() {
        if (State.get('activeView') !== 'ranking') return;

        const indicator = State.get('activeIndicator');
        const level = State.get('geoLevel');
        const selected = State.get('selectedTerritories');
        const displayLevel = level === 'region' ? 'provincia' : level;

        const container = document.getElementById('ranking-container');
        container.innerHTML = '<svg id="ranking-svg" style="width:100%;height:100%"></svg>';

        const svg = d3.select('#ranking-svg');
        const rect = container.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (!w || !h) return;

        const iw = w - margin.left - margin.right;
        const ih = h - margin.top - margin.bottom;

        const years = DataLoader.getYears();
        const totalTerritories = DataLoader.getAllTerritories(displayLevel).length;
        const topN = State.get('rankingTopN');
        const maxRank = topN > 0 ? Math.min(topN, totalTerritories) : totalTerritories;

        // Ranking for each year
        const rankByYear = {};
        for (const year of years) {
            const ranking = DataLoader.getRanking(year, indicator, displayLevel);
            rankByYear[year] = {};
            for (const entry of ranking) {
                rankByYear[year][entry.code] = entry;
            }
        }

        // Scales
        const xScale = d3.scaleBand().domain(years).range([0, iw]).padding(0);
        const yScale = d3.scaleLinear().domain([1, maxRank]).range([0, ih]);
        const bandH = ih / maxRank;
        const bandColors = _buildBandColors(maxRank);

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // Rank bands
        for (let rank = 1; rank <= maxRank; rank++) {
            g.append('rect')
                .attr('x', 0).attr('y', yScale(rank) - bandH / 2)
                .attr('width', iw).attr('height', bandH)
                .attr('fill', bandColors(rank)).attr('opacity', 0.3);
        }

        // Gridlines
        const gridStep = maxRank <= 10 ? 1 : maxRank <= 30 ? 5 : 10;
        for (let rank = 1; rank <= maxRank; rank += gridStep) {
            g.append('line')
                .attr('x1', 0).attr('x2', iw)
                .attr('y1', yScale(rank) - bandH / 2)
                .attr('y2', yScale(rank) - bandH / 2)
                .attr('stroke', '#ddd').attr('stroke-width', 0.5);
        }

        // Y axis
        for (let rank = 1; rank <= maxRank; rank += gridStep) {
            g.append('text')
                .attr('x', -8).attr('y', yScale(rank))
                .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
                .attr('font-size', 10).attr('fill', '#9ca3af')
                .text(rank);
        }

        // X axis
        const showEvery = years.length > 20 ? 5 : (years.length > 10 ? 2 : 1);
        for (let i = 0; i < years.length; i++) {
            if (i % showEvery !== 0 && i !== years.length - 1) continue;
            g.append('text')
                .attr('x', xScale(years[i]) + xScale.bandwidth() / 2)
                .attr('y', -10).attr('text-anchor', 'middle')
                .attr('font-size', 10).attr('font-weight', 600).attr('fill', '#5a6068')
                .text(years[i]);
        }

        // Selected territory paths
        const lineGen = d3.line()
            .x(d => xScale(d.year) + xScale.bandwidth() / 2)
            .y(d => yScale(d.rank))
            .curve(d3.curveMonotoneX)
            .defined(d => d.rank != null && d.rank <= maxRank);

        for (let si = 0; si < selected.length; si++) {
            const code = selected[si];
            const meta = DataLoader.getTerritoryMeta(code);
            const color = territoryColor(si);

            const pathData = years.map(year => {
                const entry = rankByYear[year]?.[code];
                return { year, rank: entry?.rank, value: entry?.value };
            }).filter(d => d.rank != null);

            if (pathData.length === 0) continue;

            // Band fill
            const areaGen = d3.area()
                .x(d => xScale(d.year) + xScale.bandwidth() / 2)
                .y0(d => yScale(Math.min(d.rank, maxRank)) - bandH / 2)
                .y1(d => yScale(Math.min(d.rank, maxRank)) + bandH / 2)
                .curve(d3.curveMonotoneX)
                .defined(d => d.rank != null && d.rank <= maxRank);

            g.append('path').datum(pathData).attr('d', areaGen)
                .attr('fill', color).attr('opacity', 0.25);

            // Line
            g.append('path').datum(pathData).attr('d', lineGen)
                .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.5);

            // Rank labels
            const labelYears = _pickLabelYears(years, pathData);
            for (const d of labelYears) {
                if (d.rank > maxRank) continue;
                const cx = xScale(d.year) + xScale.bandwidth() / 2;
                const cy = yScale(d.rank);
                g.append('rect').attr('x', cx - 14).attr('y', cy - 9)
                    .attr('width', 28).attr('height', 18)
                    .attr('fill', '#fff').attr('stroke', color).attr('stroke-width', 1.5);
                g.append('text').attr('x', cx).attr('y', cy + 1)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
                    .attr('font-size', 10).attr('font-weight', 700).attr('fill', color)
                    .text(d.rank);
            }

            // Right-side label
            const last = pathData[pathData.length - 1];
            if (last && last.rank <= maxRank) {
                g.append('text')
                    .attr('x', iw + 8).attr('y', yScale(last.rank))
                    .attr('dominant-baseline', 'middle')
                    .attr('font-size', 11).attr('font-weight', 600).attr('fill', color)
                    .text(`${last.rank}. ${meta ? meta.name : code}`);
            }
        }

        // Empty state
        if (selected.length === 0) {
            g.append('text').attr('x', iw / 2).attr('y', ih / 2)
                .attr('text-anchor', 'middle').attr('font-size', 13).attr('fill', '#9ca3af')
                .text('Selecciona territorios para ver su evolución en el ranking');
        }

        // Annotations
        const def = DataLoader.getIndicatorDef(indicator);
        const indLabel = def ? def.label : indicator;
        g.append('text').attr('x', -8).attr('y', -28)
            .attr('font-size', 9).attr('font-weight', 700).attr('fill', '#9ca3af')
            .text(`▲ Mayor ${indLabel}`);
        g.append('text').attr('x', -8).attr('y', ih + 28)
            .attr('font-size', 9).attr('font-weight', 700).attr('fill', '#9ca3af')
            .text(`▼ Menor ${indLabel}`);
        g.append('text').attr('x', iw).attr('y', -28)
            .attr('text-anchor', 'end').attr('font-size', 9).attr('font-weight', 600).attr('fill', '#9ca3af')
            .text(`${maxRank} de ${totalTerritories} ${displayLevel}s`);

        // Hover columns
        for (const year of years) {
            g.append('rect')
                .attr('x', xScale(year)).attr('y', 0)
                .attr('width', xScale.bandwidth()).attr('height', ih)
                .attr('fill', 'transparent').style('cursor', 'crosshair')
                .on('mousemove', function(e) {
                    const ranking = DataLoader.getRanking(year, indicator, displayLevel);
                    let html = fmtTooltipContext(DataLoader.getMeta(), State.get('activeCategory'), indicator, year);
                    for (const entry of ranking.slice(0, 5)) {
                        const isSel = selected.includes(entry.code);
                        const style = isSel ? ' style="color:#2a7f62;font-weight:700"' : '';
                        html += `<div class="tooltip-row"${style}><span class="tooltip-label">${entry.rank}. ${entry.name}</span><span class="tooltip-value">${fmtIndicator(entry.value, indicator)}</span></div>`;
                    }
                    Tooltip.show(html, e.clientX, e.clientY);
                })
                .on('mouseout', () => Tooltip.hide());
        }
    }

    function _buildBandColors(maxRank) {
        return rank => {
            const t = maxRank > 1 ? (rank - 1) / (maxRank - 1) : 0;
            const idx = Math.floor(t * (RANK_PALETTE.length - 1));
            return RANK_PALETTE[idx];
        };
    }

    function _pickLabelYears(allYears, pathData) {
        if (pathData.length <= 1) return pathData;
        return [pathData[0], pathData[pathData.length - 1]];
    }

    return { init, render };
})();

export default RankingView;
