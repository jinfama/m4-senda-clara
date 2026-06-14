/* timeline.js — Maddison-style 2-handle range slider.
   Map view: handle-from = currentYear, handle-to = map2Year (auto dual-map).
   Non-map views: handle-from = yearRange[0], handle-to = yearRange[1]. */
import State from '../state.js';
import DataLoader from '../data-loader.js';

const Timeline = (() => {
    let _playInterval = null;
    const SPEEDS = [400, 200, 100, 50];
    let _speedIdx = 2;

    function init() {
        const playBtn = document.getElementById('tl-play');
        const speedBtn = document.getElementById('tl-speed');
        const track = document.getElementById('tl-track');
        const handleFrom = document.getElementById('tl-handle-from');
        const handleTo = document.getElementById('tl-handle-to');
        const startInput = document.getElementById('tl-year-start');
        const endInput = document.getElementById('tl-year-end');

        playBtn.addEventListener('click', _togglePlay);
        speedBtn.addEventListener('click', _cycleSpeed);
        track.addEventListener('mousedown', _onTrackMouseDown);

        handleFrom.addEventListener('mousedown', (e) => _startHandleDrag(e, 'from'));
        handleTo.addEventListener('mousedown', (e) => _startHandleDrag(e, 'to'));

        startInput.addEventListener('change', _onRangeInputChange);
        endInput.addEventListener('change', _onRangeInputChange);

        State.subscribe('currentYear', _updateUI);
        State.subscribe('isPlaying', _onPlayChange);
        State.subscribe('yearRange', _updateUI);
        State.subscribe('map2Year', _updateUI);
        State.subscribe('activeView', _updateUI);

        _initRange();
        _updateUI();
    }

    function _initRange() {
        const years = DataLoader.getYears();
        if (years.length === 0) return;
        const range = State.get('yearRange');
        const startInput = document.getElementById('tl-year-start');
        const endInput = document.getElementById('tl-year-end');
        startInput.value = range[0];
        startInput.min = years[0];
        startInput.max = years[years.length - 1];
        endInput.value = range[1];
        endInput.min = years[0];
        endInput.max = years[years.length - 1];
    }

    function _onRangeInputChange() {
        const years = DataLoader.getYears();
        if (years.length === 0) return;
        let s = parseInt(document.getElementById('tl-year-start').value) || years[0];
        let e = parseInt(document.getElementById('tl-year-end').value) || years[years.length - 1];
        s = Math.max(years[0], Math.min(s, years[years.length - 1]));
        e = Math.max(years[0], Math.min(e, years[years.length - 1]));
        if (s > e) { const tmp = s; s = e; e = tmp; }
        State.set('yearRange', [s, e]);
        const cur = State.get('currentYear');
        if (cur < s) State.set('currentYear', s);
        if (cur > e) State.set('currentYear', e);
    }

    function _togglePlay() {
        State.set('isPlaying', !State.get('isPlaying'));
    }

    function _onPlayChange(playing) {
        const btn = document.getElementById('tl-play');
        if (playing) {
            btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            _startAnimation();
        } else {
            btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
            _stopAnimation();
        }
    }

    function _startAnimation() {
        _stopAnimation();
        const years = _getVisibleYears();
        if (years.length === 0) return;

        const isMap = State.get('activeView') === 'map';
        const isDual = isMap && State.get('map2Year') != null;

        if (isDual) {
            // Dual map: animate map2Year (to-handle)
            const cur2 = State.get('map2Year');
            const idx2 = _closestVisibleIdx(years, cur2);
            if (idx2 < 0 || idx2 >= years.length - 1) {
                State.set('map2Year', years[0]);
            }
            _playInterval = setInterval(() => {
                const visYears = _getVisibleYears();
                const c = State.get('map2Year');
                const i = _closestVisibleIdx(visYears, c);
                if (i >= 0 && i < visYears.length - 1) {
                    State.set('map2Year', visYears[i + 1]);
                } else {
                    State.set('isPlaying', false);
                }
            }, State.get('playSpeed'));
        } else if (isMap) {
            // Single map: animate currentYear
            const cur = State.get('currentYear');
            const idx = _closestVisibleIdx(years, cur);
            if (idx < 0 || idx >= years.length - 1) {
                State.set('currentYear', years[0]);
            }
            _playInterval = setInterval(() => {
                const visYears = _getVisibleYears();
                const c = State.get('currentYear');
                const i = _closestVisibleIdx(visYears, c);
                if (i >= 0 && i < visYears.length - 1) {
                    State.set('currentYear', visYears[i + 1]);
                } else {
                    State.set('isPlaying', false);
                }
            }, State.get('playSpeed'));
        } else {
            // Non-map: animate yearRange[1] expanding forward
            const [rs] = State.get('yearRange');
            const allYears = DataLoader.getYears();
            const startIdx = _closestIdx(allYears, rs);
            let animIdx = startIdx;
            _playInterval = setInterval(() => {
                const all = DataLoader.getYears();
                animIdx++;
                if (animIdx < all.length) {
                    State.set('yearRange', [rs, all[animIdx]]);
                } else {
                    State.set('isPlaying', false);
                }
            }, State.get('playSpeed'));
        }
    }

    function _stopAnimation() {
        if (_playInterval) {
            clearInterval(_playInterval);
            _playInterval = null;
        }
    }

    function _getVisibleYears() {
        const allYears = DataLoader.getYears();
        const [s, e] = State.get('yearRange');
        return allYears.filter(y => y >= s && y <= e);
    }

    function _closestVisibleIdx(years, target) {
        let closest = -1;
        let minDiff = Infinity;
        for (let i = 0; i < years.length; i++) {
            const diff = Math.abs(years[i] - target);
            if (diff < minDiff) { minDiff = diff; closest = i; }
        }
        return closest;
    }

    function _cycleSpeed() {
        _speedIdx = (_speedIdx + 1) % SPEEDS.length;
        const speed = SPEEDS[_speedIdx];
        State.set('playSpeed', speed);
        document.getElementById('tl-speed').textContent = ['1x', '2x', '4x', '8x'][_speedIdx];
        if (State.get('isPlaying')) _startAnimation();
    }

    /** Convert mouse X position to nearest year */
    function _posToYear(clientX) {
        const track = document.getElementById('tl-track');
        const isMap = State.get('activeView') === 'map';
        const years = isMap ? _getVisibleYears() : DataLoader.getYears();
        if (years.length === 0) return null;
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const idx = Math.round(pct * (years.length - 1));
        return years[idx];
    }

    function _closestIdx(years, target) {
        let closest = 0;
        let minDiff = Infinity;
        for (let i = 0; i < years.length; i++) {
            const diff = Math.abs(years[i] - target);
            if (diff < minDiff) { minDiff = diff; closest = i; }
        }
        return closest;
    }

    /** Unified drag handler for either handle */
    function _startHandleDrag(e, which) {
        e.preventDefault();
        e.stopPropagation();
        const isMap = State.get('activeView') === 'map';

        function onMove(ev) {
            const year = _posToYear(ev.clientX);
            if (year == null) return;

            if (isMap) {
                if (which === 'from') {
                    State.set('currentYear', year);
                    // If converged with map2Year, exit dual
                    if (State.get('map2Year') != null && year === State.get('map2Year')) {
                        State.set('map2Year', null);
                    }
                } else {
                    // 'to' handle: auto dual-map
                    if (year === State.get('currentYear')) {
                        State.set('map2Year', null);
                    } else {
                        State.set('map2Year', year);
                    }
                }
            } else {
                // Non-map: handles control yearRange
                const range = State.get('yearRange');
                if (which === 'from') {
                    const newStart = Math.min(year, range[1]);
                    State.set('yearRange', [newStart, range[1]]);
                    const cur = State.get('currentYear');
                    if (cur < newStart) State.set('currentYear', newStart);
                } else {
                    const newEnd = Math.max(year, range[0]);
                    State.set('yearRange', [range[0], newEnd]);
                    const cur = State.get('currentYear');
                    if (cur > newEnd) State.set('currentYear', newEnd);
                }
            }
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    /** Track click: snap the closer handle */
    function _onTrackMouseDown(e) {
        if (e.target.closest('.tl-handle')) return;
        e.preventDefault();

        const year = _posToYear(e.clientX);
        if (year == null) return;

        const isMap = State.get('activeView') === 'map';

        if (isMap) {
            const isDual = State.get('map2Year') != null;
            if (!isDual) {
                // Single mode: move the linked handle
                State.set('currentYear', year);
                _startHandleDrag(e, 'from');
            } else {
                // Dual mode: snap the closer handle
                const cur = State.get('currentYear');
                const m2 = State.get('map2Year');
                if (Math.abs(cur - year) <= Math.abs(m2 - year)) {
                    State.set('currentYear', year);
                    _startHandleDrag(e, 'from');
                } else {
                    State.set('map2Year', year);
                    _startHandleDrag(e, 'to');
                }
            }
        } else {
            // Non-map: snap the closer range handle
            const [rs, re] = State.get('yearRange');
            if (Math.abs(rs - year) <= Math.abs(re - year)) {
                State.set('yearRange', [year, re]);
                _startHandleDrag(e, 'from');
            } else {
                State.set('yearRange', [rs, year]);
                _startHandleDrag(e, 'to');
            }
        }
    }

    function _updateUI() {
        const allYears = DataLoader.getYears();
        if (allYears.length === 0) return;

        const cur = State.get('currentYear');
        const [rangeStart, rangeEnd] = State.get('yearRange');
        const map2Year = State.get('map2Year');
        const isMap = State.get('activeView') === 'map';

        const handleFromEl = document.getElementById('tl-handle-from');
        const handleToEl = document.getElementById('tl-handle-to');
        const labelFrom = document.getElementById('tl-label-from');
        const labelTo = document.getElementById('tl-label-to');
        const rangeFill = document.getElementById('tl-range-fill');
        const yearEl = document.getElementById('tl-year');
        const startInput = document.getElementById('tl-year-start');
        const endInput = document.getElementById('tl-year-end');

        if (isMap) {
            // ── MAP VIEW: track spans only the indicator's yearRange ──
            startInput.style.display = '';
            startInput.value = rangeStart;
            startInput.readOnly = true;
            endInput.style.display = '';
            endInput.value = rangeEnd;
            endInput.readOnly = true;

            const visYears = _getVisibleYears();
            if (visYears.length === 0) return;
            const visSpan = visYears.length - 1;

            const isDual = map2Year != null;
            const fromYear = cur;
            const toYear = isDual ? map2Year : cur;

            const fromIdx = _closestIdx(visYears, fromYear);
            const toIdx = _closestIdx(visYears, toYear);
            const fromPct = visSpan > 0 ? fromIdx / visSpan * 100 : 0;
            const toPct = visSpan > 0 ? toIdx / visSpan * 100 : 0;

            handleFromEl.style.left = fromPct + '%';
            handleToEl.style.left = toPct + '%';
            labelFrom.textContent = fromYear;
            labelTo.textContent = toYear;

            // When single map, hide second handle
            if (!isDual) {
                handleToEl.style.display = 'none';
            } else {
                handleToEl.style.display = '';
            }

            // Range fill between handles
            const leftPct = Math.min(fromPct, toPct);
            const widthPct = Math.abs(toPct - fromPct);
            rangeFill.style.left = leftPct + '%';
            rangeFill.style.width = widthPct + '%';

            // Year display
            if (isDual && fromYear !== toYear) {
                const y1 = Math.min(fromYear, toYear);
                const y2 = Math.max(fromYear, toYear);
                yearEl.textContent = y1 + ' \u2013 ' + y2;
            } else {
                yearEl.textContent = fromYear;
            }
        } else {
            // ── NON-MAP VIEWS: handles control yearRange ──
            startInput.style.display = '';
            startInput.readOnly = false;
            endInput.style.display = '';
            endInput.readOnly = false;

            const totalSpan = allYears.length - 1;
            const startIdx = _closestIdx(allYears, rangeStart);
            const endIdx = _closestIdx(allYears, rangeEnd);
            const startPct = totalSpan > 0 ? startIdx / totalSpan * 100 : 0;
            const endPct = totalSpan > 0 ? endIdx / totalSpan * 100 : 100;

            handleFromEl.style.left = startPct + '%';
            handleToEl.style.left = endPct + '%';
            handleToEl.style.display = '';
            labelFrom.textContent = rangeStart;
            labelTo.textContent = rangeEnd;

            // Range fill
            rangeFill.style.left = startPct + '%';
            rangeFill.style.width = (endPct - startPct) + '%';

            // Year display
            yearEl.textContent = rangeStart + ' \u2013 ' + rangeEnd;

            // Inputs
            startInput.value = rangeStart;
            endInput.value = rangeEnd;
        }

        // Prevent label overlap: if both handles visible and close together, offset one label
        if (handleToEl.style.display !== 'none') {
            const fromRect = handleFromEl.getBoundingClientRect();
            const toRect = handleToEl.getBoundingClientRect();
            const dist = Math.abs(fromRect.left - toRect.left);
            if (dist < 45) {
                // Move the "from" label higher to avoid overlap
                labelFrom.style.bottom = 'calc(100% + 14px)';
            } else {
                labelFrom.style.bottom = '';
            }
        } else {
            labelFrom.style.bottom = '';
        }
    }

    /** Force UI refresh (call after category/indicator change alters year range) */
    function refresh() {
        _initRange();
        _updateUI();
    }

    return { init, refresh };
})();

export default Timeline;
