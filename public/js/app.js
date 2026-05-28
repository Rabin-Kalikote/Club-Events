/**
 * Club Events – College of Idaho
 * app.js  |  Single-Page Application controller
 */

/* =============================================================
   STATE
   ============================================================= */
const state = {
  currentPage: 'home',
  calView: 'week',            // 'week' | 'day'
  calAnchorDate: new Date(),  // reference date for calendar view
  events: [],
  clubs: [],
  departments: [],
  selectedDepartmentId: null,
  loggedInClub: null,   // { id, name, token }
  adminToken: null,
  pendingLoginClub: null,  // club object waiting for password
};

/* Ensure CSS variable for calendar header height matches the rendered size.
   This keeps the .day-header top offset in sync if the header wraps or changes height. */
function syncCalendarHeaderHeight() {
  const el = document.querySelector('.calendar-header');
  if (!el) return;
  const h = Math.round(el.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--calendar-header-h', h + 'px');
}
window.addEventListener('load', () => setTimeout(syncCalendarHeaderHeight, 50));
window.addEventListener('resize', debounce(() => setTimeout(syncCalendarHeaderHeight, 60), 100));

/* =============================================================
   NAVIGATION
   ============================================================= */
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  document.querySelectorAll('.bnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });

  state.currentPage = page;

  if (page === 'home') renderCalendar();
  if (page === 'departments') loadDepartmentsPage();
  if (page === 'senate') renderSenatePage();
}

document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // If the brand button (Club Events) is clicked, allow the calendar to re-run the "scroll to now"
    if (btn.classList.contains('brand-btn') && btn.dataset.page === 'home') {
      state._hasScrolledToNow = false;
    }
    navigate(btn.dataset.page);
  });
});

/* =============================================================
   UTILITIES
   ============================================================= */
function fmt(date, opts = {}) {
  return date.toLocaleString('en-US', opts);
}

function formatDateTimeLocal(dt) {
  // "YYYY-MM-DDTHH:MM" for datetime-local input
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// Parse an ISO-like datetime string as local time (handles 'YYYY-MM-DDTHH:MM' etc.)
function parseLocalISO(s) {
  if (!s) return new Date(NaN);
  // If there's an explicit timezone, let Date handle it
  if (/[zZ]|[+-][0-9]{2}:?[0-9]{2}$/.test(s)) return new Date(s);
  const [datePart, timePart='00:00:00'] = String(s).split('T');
  const [y, m, d] = datePart.split('-').map(n => parseInt(n, 10));
  const t = timePart.split(':');
  const hh = parseInt(t[0]||0, 10);
  const mm = parseInt(t[1]||0, 10);
  const ss = t[2] ? parseInt(t[2].split('.')[0]||0, 10) : 0;
  return new Date(y, (m || 1) - 1, d || 1, hh, mm, ss);
}

function startOfDay(d) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getWeekStart(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay()); // Sunday
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Pick a visually distinct color for an event based on its club ID */
const PALETTE = [
  '#1565c0','#6a1b9a','#00695c','#b71c1c','#e65100',
  '#37474f','#4527a0','#2e7d32','#ad1457','#0277bd',
];
function eventColor(clubId) {
  return PALETTE[(clubId % PALETTE.length)];
}

/** Department color mapping (assign colors from PALETTE) */
function assignDepartmentColors(depts) {
  const map = {};
  depts.forEach((d, i) => { map[d.id] = PALETTE[i % PALETTE.length]; });
  return map;
}

// Cluster/overlap helpers
// state._clusterIndex stores the currently visible index for a given cluster id
state._clusterIndex = state._clusterIndex || {};

function clusterDayEvents(eventsForDay) {
  if (!eventsForDay || !eventsForDay.length) return [];
  // eventsForDay should be an array of events with parsed start/end mins
  const evs = eventsForDay.slice().sort((a,b) => (a._startMin - b._startMin) || (b._endMin - a._endMin));
  const clusters = [];
  let cur = { events: [], start: Infinity, end: -Infinity };
  for (const ev of evs) {
    if (cur.events.length === 0) {
      cur.events.push(ev); cur.start = ev._startMin; cur.end = ev._endMin;
      continue;
    }
    // if overlaps (start < current end) then same cluster
    if (ev._startMin < cur.end) {
      cur.events.push(ev);
      cur.end = Math.max(cur.end, ev._endMin);
    } else {
      clusters.push(cur);
      cur = { events: [ev], start: ev._startMin, end: ev._endMin };
    }
  }
  if (cur.events.length) clusters.push(cur);
  return clusters;
}

/** Show an inline alert */
function showAlert(elId, msg, type = 'danger') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = `alert-inline alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('d-none');
}
function hideAlert(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('d-none');
}

/* =============================================================
   API HELPERS
   ============================================================= */
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

  const token = state.loggedInClub?.token || state.adminToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
// Locations helpers
async function fetchLocations() {
  const { ok, data } = await apiFetch('/api/locations');
  return ok ? (data.locations || []) : [];
}

async function ensureLocation(newName) {
  const token = state.loggedInClub?.token || state.adminToken;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/locations', { method: 'POST', headers, body: JSON.stringify({ name: newName }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create location');
  return data.id;
}

/* =============================================================
   HOME – CALENDAR
   ============================================================= */
const HOUR_H = 60; // pixels per hour (matches CSS var --hour-h)
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

async function fetchEvents(startISO, endISO) {
  // Optionally filter by department (club_id) if selected
  const deptParam = state.selectedDepartmentId ? `&club_id=${state.selectedDepartmentId}` : '';
  const { ok, data } = await apiFetch(`/api/events?start=${startISO}&end=${endISO}${deptParam}`);
  return ok ? data.events || [] : [];
}

function isoLocal(d) {
  // "YYYY-MM-DDTHH:MM:SS" in local time
  return formatDateTimeLocal(d) + ':00';
}

async function renderCalendar() {
  const wrap = document.getElementById('cal-grid-wrap');
  const grid = document.getElementById('cal-grid');

  // Determine visible day range
  let days = [];
  // Treat <768px as mobile (single-day view). Tablets and up show 7-day week view.
  const isMobile = window.innerWidth < 768;

  if (state.calView === 'day' || isMobile) {
    state.calView = 'day';
    days = [startOfDay(state.calAnchorDate)];
    setViewToggleActive('day');
  } else {
    const ws = getWeekStart(state.calAnchorDate);
    days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    setViewToggleActive('week');
  }

  // Update title (will include event count after we fetch events below)
  const title = document.getElementById('cal-title');
  if (days.length === 1) {
    title.textContent = fmt(days[0], { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  } else {
    const s = fmt(days[0], { month:'short', day:'numeric' });
    const e = fmt(days[6], { month:'short', day:'numeric', year:'numeric' });
    title.textContent = `${s} – ${e}`;
  }

  // Fetch events for the range
  const rangeStart = isoLocal(days[0]);
  const rangeEnd   = isoLocal(addDays(days[days.length - 1], 1));
  const events = await fetchEvents(rangeStart, rangeEnd);

  // Debug: surface how many events we fetched and their datetimes
  try {
    console.debug('[renderCalendar] range', rangeStart, rangeEnd, 'fetched', events.length, 'events');
    console.debug('[renderCalendar] datetimes', events.map(e => e.start_datetime));
  } catch (err) { /* ignore logging errors */ }

  // Update title to include event count for quick verification
  if (days.length === 1) {
    title.textContent = fmt(days[0], { weekday:'long', month:'long', day:'numeric', year:'numeric' }) + ` — ${events.length} event${events.length !== 1 ? 's' : ''}`;
  } else {
    const s = fmt(days[0], { month:'short', day:'numeric' });
    const e = fmt(days[6], { month:'short', day:'numeric', year:'numeric' });
    title.textContent = `${s} – ${e}` + ` — ${events.length} event${events.length !== 1 ? 's' : ''}`;
  }

  // Build grid HTML
  const today = startOfDay(new Date());

  let html = `<div class="time-col">`;
  // Blank top cell (aligns with day headers)
  html += `<div style="height:52px"></div>`;
  HOURS.forEach(h => {
    const label = h === 0 ? '1am' : h < 11 ? `${h+1}am` : h === 11 ? '12pm' : `${h-12+1}pm`;
    html += `<div class="time-label">${label}</div>`;
  });
  html += `</div>`;

  html += `<div class="days-wrap">`;
  days.forEach(day => {
    const isToday = day.getTime() === today.getTime();
      const dayEvents = events.filter(ev => {
        const evStart = parseLocalISO(ev.start_datetime);
        const evDay = startOfDay(evStart);
        return evDay.getTime() === day.getTime();
      });

    html += `<div class="day-col">`;
    // header moved into #days-headers; reserve body space here
    html += `<div class="day-body" data-date="${day.toISOString()}">`;

    // Hour lines
    HOURS.forEach(h => {
      html += `<div class="hour-line" style="top:${h * HOUR_H}px"></div>`;
      html += `<div class="hour-line half" style="top:${h * HOUR_H + HOUR_H/2}px"></div>`;
    });

    // Current time indicator (today only)
    if (isToday) {
      const now = new Date();
      const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();
      const topPx = minutesFromMidnight * (HOUR_H / 60);
      html += `<div class="now-line" style="top:${topPx}px"></div>`;
    }

    // Event blocks: compute minute offsets and cluster overlapping events
    const prepared = dayEvents.map(ev => {
      const start = parseLocalISO(ev.start_datetime);
      const end   = parseLocalISO(ev.end_datetime);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin   = end.getHours() * 60 + end.getMinutes();
      return Object.assign({}, ev, { _startMin: startMin, _endMin: endMin, _startDate: start, _endDate: end });
    });

    const clusters = clusterDayEvents(prepared);
    clusters.forEach((cluster, ci) => {
      // determine a single render slot extents
      const slotStart = Math.min(...cluster.events.map(e => e._startMin));
      const slotEnd   = Math.max(...cluster.events.map(e => e._endMin));
      const slotTopPx = slotStart * (HOUR_H / 60);
      const slotHeightPx = Math.max((slotEnd - slotStart) * (HOUR_H / 60), 10);

      // attach a cluster id
      const clusterId = `c-${day.toISOString().slice(0,10)}-${ci}`;
      cluster.id = clusterId;
      // ensure index persisted
      if (!state._clusterIndex) state._clusterIndex = {};
      if (state._clusterIndex[clusterId] == null) state._clusterIndex[clusterId] = 0;

  // determine if all events have start/end within a small tolerance (10 minutes)
  const TOL_MIN = 10; // minutes
  const sameSlot = cluster.events.every(e => (Math.abs(e._startMin - slotStart) <= TOL_MIN && Math.abs(e._endMin - slotEnd) <= TOL_MIN));

      // store cluster length for nav handlers
      state._clusterLen = state._clusterLen || {};
      state._clusterLen[clusterId] = cluster.events.length;

      if (sameSlot && cluster.events.length > 1) {
        // carousel slot - only render the visible event for the cluster
        const len = cluster.events.length;
        const rawIdx = state._clusterIndex[clusterId] || 0;
        const visibleIdx = ((rawIdx % len) + len) % len; // normalize positive modulo
        const ev = cluster.events[visibleIdx];
        const start = ev._startDate; const end = ev._endDate;
        const timeStr = `${fmt(start,{hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;
        const deptForColor = ev.department_id || ev.club_id || 0;
        const color = (state.departmentColors && state.departmentColors[deptForColor]) || eventColor(deptForColor);
        html += `<div class="cal-event" style="top:${slotTopPx}px;height:${slotHeightPx}px;background:${color};color:#fff" data-ev-id="${ev.id}" data-cluster="${clusterId}" title="${escHtml(ev.title)} · ${escHtml(timeStr)}">
            <div class="ev-title">${escHtml(ev.title)}</div>
            <div class="ev-location">${escHtml(ev.location_name || '')}</div>
            <div class="ev-club">${escHtml(ev.club_name || '')}</div>
            <div class="ev-nav">
              <button class="ev-nav-prev" data-cluster-prev="${clusterId}">◀</button>
              <span class="ev-nav-counter">${visibleIdx+1}/${len}</span>
              <button class="ev-nav-next" data-cluster-next="${clusterId}">▶</button>
            </div>
          </div>`;
      } else {
        // render each event as normal blocks (even if overlapping) so they keep their proper top/height
        cluster.events.forEach((ev) => {
          const start = ev._startDate; const end = ev._endDate;
          const startMin = ev._startMin; const endMin = ev._endMin;
          const topPx = startMin * (HOUR_H / 60);
          const heightPx = Math.max((endMin - startMin) * (HOUR_H / 60), 12);
          const deptForColor = ev.department_id || ev.club_id || 0;
          const color = (state.departmentColors && state.departmentColors[deptForColor]) || eventColor(deptForColor);
          const timeStr = `${fmt(start,{hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;
          html += `<div class="cal-event" style="top:${topPx}px;height:${heightPx}px;background:${color};color:#fff" data-ev-id="${ev.id}" data-cluster="${clusterId}" title="${escHtml(ev.title)} · ${escHtml(timeStr)}">
            <div class="ev-title">${escHtml(ev.title)}</div>
            <div class="ev-location">${escHtml(ev.location_name || '')}</div>
            <div class="ev-club">${escHtml(ev.club_name || '')}</div>
          </div>`;
        });
      }
    });

    html += `</div></div>`;
  });
  html += `</div>`;

  grid.innerHTML = html;

  // Render day headers into the top header area so they stick together with .calendar-header
  const daysHeadersEl = document.getElementById('days-headers');
  if (daysHeadersEl) {
    daysHeadersEl.innerHTML = days.map(d => {
      const isToday = startOfDay(d).getTime() === today.getTime();
      return `<div class="day-header${isToday ? ' today' : ''}">
        <div class="day-name">${DAYS_SHORT[d.getDay()]}</div>
        <div class="day-num">${d.getDate()}</div>
      </div>`;
    }).join('');

    // sync horizontal scroll
    const headerScroll = daysHeadersEl;
    const gridScroll = document.querySelector('.days-wrap');
    if (gridScroll) {
      headerScroll.onscroll = () => { gridScroll.scrollLeft = headerScroll.scrollLeft; };
      gridScroll.onscroll = () => { headerScroll.scrollLeft = gridScroll.scrollLeft; };
    }
  }

  // Event block click → modal
  grid.querySelectorAll('.cal-event').forEach(el => {
    el.addEventListener('click', (e) => {
      // If clicked on nav buttons, ignore opening modal
      const target = e.target;
      if (target && (target.dataset.clusterPrev || target.dataset.clusterNext)) return;
      openEventModal(el.dataset.evId, events);
    });
  });

  // Cluster nav handlers (prev/next)
  grid.querySelectorAll('[data-cluster-prev]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.dataset.clusterPrev;
      if (!id) return;
      const idx = state._clusterIndex[id] || 0;
      const len = (state._clusterLen && state._clusterLen[id]) || 1;
      state._clusterIndex[id] = ((idx - 1) % len + len) % len;
      renderCalendar();
    });
  });
  grid.querySelectorAll('[data-cluster-next]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.dataset.clusterNext;
      if (!id) return;
      const idx = state._clusterIndex[id] || 0;
      const len = (state._clusterLen && state._clusterLen[id]) || 1;
      state._clusterIndex[id] = (idx + 1) % len;
      renderCalendar();
    });
  });

  // On first render, try to scroll so the current time is visible.
  // Find the vertical scroll container (closest ancestor with overflow:auto/scroll) so we scroll the correct element.
  function findVerticalScrollContainer(el) {
    let p = el.parentElement;
    while (p) {
      const st = getComputedStyle(p).overflowY;
      if (st === 'auto' || st === 'scroll') return p;
      p = p.parentElement;
    }
    return document.documentElement;
  }

  if (!state._hasScrolledToNow) {
    const nowEl = grid.querySelector('.now-line');
    const container = findVerticalScrollContainer(grid) || document.documentElement;
    if (nowEl && container) {
      const nowRect = nowEl.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const headerEl = document.querySelector('.calendar-header');
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
      // Small top margin so the now-line isn't flush with the header
      const margin = 24;
      const delta = nowRect.top - (contRect.top + headerH + margin);
      // Adjust scrollTop by delta (works for both documentElement and scrollable container)
      container.scrollTop = (container.scrollTop || 0) + delta;
    } else {
      // Fall back to scrolling to 7am (previous behavior)
      const dayHeaderH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--day-header-h')) || 52;
      const scrollTo = 7 * HOUR_H + dayHeaderH; // align so 7am sits below headers
      const container = findVerticalScrollContainer(grid) || document.documentElement;
      container.scrollTop = scrollTo;
    }
    state._hasScrolledToNow = true;
  }
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function openEventModal(evId, events) {
  const ev = events.find(e => String(e.id) === String(evId));
  if (!ev) return;

  const modal = new bootstrap.Modal(document.getElementById('eventModal'));
  const start = parseLocalISO(ev.start_datetime);
  const end   = parseLocalISO(ev.end_datetime);

  document.getElementById('eventModalLabel').textContent = ev.title;
  document.getElementById('event-modal-title').textContent = ev.title;
  document.getElementById('event-modal-club-badge').textContent = ev.club_name || '';
  document.getElementById('event-modal-time').textContent =
    `${fmt(start,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} – ${fmt(end,{hour:'numeric',minute:'2-digit'})}`;
  document.getElementById('event-modal-desc').textContent = ev.description || 'No description provided.';

  // Display location instead of poster image
  const img = document.getElementById('event-modal-poster');
  if (ev.location_name) {
    img.classList.add('d-none');
    // append location to time display
    document.getElementById('event-modal-time').textContent += ` · ${escHtml(ev.location_name)}`;
  } else {
    img.classList.add('d-none');
  }

  modal.show();
}

function setViewToggleActive(view) {
  document.getElementById('btn-view-week').classList.toggle('active', view === 'week');
  document.getElementById('btn-view-day').classList.toggle('active', view === 'day');
}

// Calendar navigation
document.getElementById('btn-prev').addEventListener('click', () => {
  const days = state.calView === 'week' ? 7 : 1;
  state.calAnchorDate = addDays(state.calAnchorDate, -days);
  renderCalendar();
});
document.getElementById('btn-next').addEventListener('click', () => {
  const days = state.calView === 'week' ? 7 : 1;
  state.calAnchorDate = addDays(state.calAnchorDate, days);
  renderCalendar();
});
document.getElementById('btn-today').addEventListener('click', () => {
  state.calAnchorDate = new Date();
  renderCalendar();
});
document.getElementById('btn-view-week').addEventListener('click', () => {
  state.calView = 'week';
  renderCalendar();
});
document.getElementById('btn-view-day').addEventListener('click', () => {
  state.calView = 'day';
  renderCalendar();
});

// Re-render calendar on resize (desktop ↔ mobile switch)
window.addEventListener('resize', debounce(() => {
  if (state.currentPage === 'home') renderCalendar();
}, 250));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* =============================================================
   CLUBS PAGE
   ============================================================= */
async function loadDepartmentsPage() {
  const grid = document.getElementById('departments-grid');
  grid.innerHTML = `<div class="text-center text-muted py-5 col-12">
    <i class="fa-solid fa-spinner fa-spin fa-2x mb-2"></i><p>Loading departments…</p></div>`;

  // Fetch departments and render
  await loadDepartments();
  renderDepartmentsGrid(state.departments);
}

async function loadDepartments() {
  const { ok, data } = await apiFetch('/api/departments');
  const depts = ok ? (data.departments || []) : [];
  state.departments = depts;
  state.clubs = depts; // keep alias for compatibility
  // assign colors
  state.departmentColors = assignDepartmentColors(depts);

  // Populate department select in calendar header
  const sel = document.getElementById('dept-select');
  if (sel) {
    const opts = ['<option value="">All Departments</option>']
      .concat(depts.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`));
    sel.innerHTML = opts.join('');
    sel.addEventListener('change', () => {
      state.selectedDepartmentId = sel.value ? parseInt(sel.value) : null;
      // re-render calendar for the selected department
      if (state.currentPage === 'home') renderCalendar();
    });
  }
}

function renderDepartmentsGrid(departments) {
  const grid = document.getElementById('departments-grid');
  const count = document.getElementById('departments-count');

  if (!departments.length) {
    grid.innerHTML = `<div class="text-center text-muted py-5 col-12">
      <i class="fa-solid fa-face-sad-tear fa-2x mb-2"></i>
      <p>No departments found.</p></div>`;
    count.textContent = '';
    return;
  }

  count.textContent = `${departments.length} department${departments.length !== 1 ? 's' : ''}`;

  grid.innerHTML = departments.map(dept => {
    const logoHtml = `<div class="club-logo-placeholder"><i class="fa-solid fa-user-group"></i><span>${escHtml(dept.name.charAt(0).toUpperCase())}</span></div>`;
    return `<div class="club-tile" data-department-id="${dept.id}" data-department-name="${escHtml(dept.name)}"
                 tabindex="0" role="button" aria-label="Login as department ${escHtml(dept.name)}">
      ${logoHtml}
      <div class="club-name">${escHtml(dept.name)}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.club-tile').forEach(tile => {
    tile.addEventListener('click', () => openDepartmentLoginModal(
      parseInt(tile.dataset.departmentId), tile.dataset.departmentName
    ));
    tile.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') tile.click();
    });
  });
}

// Club search/filter
document.getElementById('department-search').addEventListener('input', function () {
  const q = this.value.trim().toLowerCase();
  const filtered = q ? state.departments.filter(c => c.name.toLowerCase().includes(q)) : state.departments;
  renderDepartmentsGrid(filtered);
});

function openDepartmentLoginModal(deptId, deptName) {
  state.pendingLoginClub = { id: deptId, name: deptName };
  document.getElementById('clubLoginModalLabel').innerHTML =
    `<i class="fa-solid fa-lock me-2 text-primary"></i>Login – ${escHtml(deptName)}`;
  document.getElementById('club-modal-name').textContent =
    `Enter the password for ${deptName} to post events.`;
  document.getElementById('club-login-pw').value = '';
  hideAlert('club-login-msg');
  const modal = new bootstrap.Modal(document.getElementById('clubLoginModal'));
  modal.show();
}

document.getElementById('club-login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const pw = document.getElementById('club-login-pw').value;
  hideAlert('club-login-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Logging in…';

  const { ok, data } = await apiFetch('/api/auth/department', {
    method: 'POST',
    body: JSON.stringify({ department_id: state.pendingLoginClub.id, password: pw }),
  });

  btn.disabled = false;
  btn.textContent = 'Login';

  if (!ok) {
    showAlert('club-login-msg', data.error || 'Login failed');
    return;
  }

  // Store session. API may return `department` (new name) or `club` for legacy.
  const dept = data.department || data.club || null;
  state.loggedInClub = dept ? { ...dept, token: data.token } : { token: data.token };
  bootstrap.Modal.getInstance(document.getElementById('clubLoginModal')).hide();
  onClubLogin();
});

function onClubLogin() {
  const banner = document.getElementById('club-login-banner');
  // Show the logged-in department name if available
  document.getElementById('logged-club-name').textContent = state.loggedInClub?.name || '–';
  banner.classList.remove('d-none');
  document.getElementById('create-event-section').classList.remove('d-none');
  // If logged in as a department, restrict the departments grid to show only that department
  try {
    if (state.loggedInClub && state.loggedInClub.id) {
      renderDepartmentsGrid([ { id: state.loggedInClub.id, name: state.loggedInClub.name } ]);
      const sel = document.getElementById('dept-select');
      if (sel) {
        sel.value = String(state.loggedInClub.id);
        sel.disabled = true;
      }
    }
  } catch (e) {
    // ignore rendering errors
  }
  // Hide the department filter and the full grid while logged in
  const filterBar = document.querySelector('.clubs-filter');
  const gridEl = document.getElementById('departments-grid');
  if (filterBar) filterBar.classList.add('d-none');
  if (gridEl) gridEl.classList.add('d-none');
  // Populate locations for club create-event form
  (async () => {
    try {
      const locations = await fetchLocations();
      const sel = document.getElementById('ev-location');
      if (sel) {
        sel.innerHTML = `<option value="">– select location –</option>` +
          locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
      }
    } catch (e) {
      // ignore
    }
  })();
}

document.getElementById('btn-club-logout').addEventListener('click', () => {
  state.loggedInClub = null;
  document.getElementById('club-login-banner').classList.add('d-none');
  document.getElementById('create-event-section').classList.add('d-none');
  // Restore full departments list and re-enable the select
  (async () => {
    try {
      await loadDepartments();
      renderDepartmentsGrid(state.departments);
      const sel = document.getElementById('dept-select');
      if (sel) {
        sel.disabled = false;
        sel.value = '';
      }
    } catch (e) {
      // ignore
    }
  })();
  // Show the department filter and grid again after logout
  const filterBar = document.querySelector('.clubs-filter');
  const gridEl = document.getElementById('departments-grid');
  if (filterBar) filterBar.classList.remove('d-none');
  if (gridEl) gridEl.classList.remove('d-none');
});

document.getElementById('btn-change-pw').addEventListener('click', () => {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  hideAlert('change-pw-msg');
  new bootstrap.Modal(document.getElementById('changePwModal')).show();
});

document.getElementById('change-pw-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const current = document.getElementById('cp-current').value;
  const newPw   = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;

  if (newPw !== confirm) { showAlert('change-pw-msg', 'New passwords do not match'); return; }
  hideAlert('change-pw-msg');

  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Updating…';

  const { ok, data } = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: current, new_password: newPw }),
  });

  btn.disabled = false;
  btn.textContent = 'Update Password';

  if (!ok) { showAlert('change-pw-msg', data.error || 'Failed to change password'); return; }
  showAlert('change-pw-msg', 'Password changed successfully!', 'success');
  setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('changePwModal')).hide(), 1500);
});

// Create event (club user)
document.getElementById('create-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Creating…';

  // Location: either selected existing or new name
  let location_id = null;
  const sel = document.getElementById('ev-location');
  const newLoc = document.getElementById('ev-new-location')?.value.trim();
  if (newLoc) {
    try {
      location_id = await ensureLocation(newLoc);
    } catch (err) {
      showAlert('create-event-msg', err.message || 'Failed to create location');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
      return;
    }
  } else if (sel && sel.value) {
    location_id = parseInt(sel.value);
  }

  const payload = {
    title:          document.getElementById('ev-title').value.trim(),
    description:    document.getElementById('ev-desc').value.trim(),
    location_id,
    event_type:     document.getElementById('ev-type')?.value || null,
    start_datetime: document.getElementById('ev-start').value,
    end_datetime:   document.getElementById('ev-end').value,
  };

  const { ok, data } = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';

  if (!ok) { showAlert('create-event-msg', data.error || 'Failed to create event'); return; }

  showAlert('create-event-msg', 'Event created successfully!', 'success');
  this.reset();
});

/* =============================================================
   SENATE PAGE
   ============================================================= */
function renderSenatePage() {
  if (state.adminToken) {
    document.getElementById('senate-login').classList.add('d-none');
    document.getElementById('senate-panel').classList.remove('d-none');
    loadAdminData();
  } else {
    document.getElementById('senate-login').classList.remove('d-none');
    document.getElementById('senate-panel').classList.add('d-none');
  }
}

document.getElementById('admin-login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const pw = document.getElementById('admin-pw').value;
  hideAlert('admin-login-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Logging in…';

  const { ok, data } = await apiFetch('/api/auth/admin', {
    method: 'POST',
    body: JSON.stringify({ password: pw }),
  });

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-right-to-bracket me-1"></i>Login';

  if (!ok) { showAlert('admin-login-msg', data.error || 'Login failed'); return; }

  state.adminToken = data.token;
  document.getElementById('senate-login').classList.add('d-none');
  document.getElementById('senate-panel').classList.remove('d-none');
  loadAdminData();
});

document.getElementById('btn-admin-logout').addEventListener('click', () => {
  state.adminToken = null;
  document.getElementById('senate-panel').classList.add('d-none');
  document.getElementById('senate-login').classList.remove('d-none');
  document.getElementById('admin-pw').value = '';
});

async function loadAdminData() {
  // Load clubs for the dropdown + clubs list
  const { ok, data } = await apiFetch('/api/departments');
  const clubs = ok ? (data.departments || []) : [];

  // Populate club select
  const sel = document.getElementById('adm-ev-department');
  sel.innerHTML = `<option value="">– select club –</option>` +
    clubs.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');

  // Populate locations for admin event form
  try {
    const locations = await fetchLocations();
    const locSel = document.getElementById('adm-ev-location');
    if (locSel) {
      locSel.innerHTML = `<option value="">– select location –</option>` +
        locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
    }
  } catch (e) {
    // ignore errors; locations are optional
  }

  // Clubs list – use event delegation instead of inline onclick
  const clList = document.getElementById('admin-departments-list');
  if (clubs.length) {
    clList.innerHTML = clubs.map(c => `
      <div class="event-list-item">
        <div class="ev-info">
          <div class="ev-title-txt">${escHtml(c.name)}</div>
          <div class="ev-meta-txt">ID: ${c.id} · Created: ${new Date(c.created_at).toLocaleDateString()}</div>
        </div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-secondary" data-change-pw-dept="${c.id}">Change PW</button>
          <button class="btn btn-sm btn-outline-danger" data-delete-department="${c.id}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`).join('');

    clList.querySelectorAll('[data-delete-department]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteDepartment(parseInt(btn.dataset.deleteDepartment)));
    });
    clList.querySelectorAll('[data-change-pw-dept]').forEach(btn => {
      btn.addEventListener('click', () => adminChangeDepartmentPassword(parseInt(btn.dataset.changePwDept)));
    });
  } else {
    clList.innerHTML = '<p class="text-muted small">No departments yet.</p>';
  }

  // Events list
  loadAdminEvents();
}

async function loadAdminEvents() {
  const evList = document.getElementById('admin-events-list');
  const now = new Date();
  const { ok, data } = await apiFetch(`/api/events?start=${isoLocal(now)}`);
  const events = ok ? (data.events || []) : [];

  if (events.length) {
    evList.innerHTML = events.map(ev => `
      <div class="event-list-item">
        <div class="ev-info">
          <div class="ev-title-txt">${escHtml(ev.title)}</div>
          <div class="ev-meta-txt">${escHtml(ev.club_name)} · ${escHtml(parseLocalISO(ev.start_datetime).toLocaleString())}</div>
        </div>
        <button class="btn btn-sm btn-outline-danger" data-delete-event="${ev.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`).join('');

    evList.querySelectorAll('[data-delete-event]').forEach(btn => {
      btn.addEventListener('click', () => adminDeleteEvent(parseInt(btn.dataset.deleteEvent)));
    });
  } else {
    evList.innerHTML = '<p class="text-muted small">No upcoming events.</p>';
  }
}

// Create club (admin)
document.getElementById('create-department-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('create-department-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  const { ok, data } = await apiFetch('/api/departments', {
    method: 'POST',
    body: JSON.stringify({
      name:     document.getElementById('cl-name').value.trim(),
      password: document.getElementById('cl-pw').value,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Department';

  if (!ok) { showAlert('create-department-msg', data.error || 'Failed to create department'); return; }
  showAlert('create-department-msg', 'Department created!', 'success');
  this.reset();
  loadAdminData();
});

// Create event (admin)
document.getElementById('admin-create-event-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert('adm-create-event-msg');
  const btn = this.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';

  let location_id = null;
  const sel = document.getElementById('adm-ev-location');
  const newLoc = document.getElementById('adm-ev-new-location')?.value.trim();
  if (newLoc) {
    try {
      location_id = await ensureLocation(newLoc);
    } catch (err) {
      showAlert('adm-create-event-msg', err.message || 'Failed to create location');
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';
      return;
    }
  } else if (sel && sel.value) {
    location_id = parseInt(sel.value);
  }

  const { ok, data } = await apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({
  department_id:        parseInt(document.getElementById('adm-ev-department').value),
      title:          document.getElementById('adm-ev-title').value.trim(),
      description:    document.getElementById('adm-ev-desc').value.trim(),
      location_id,
      event_type:     document.getElementById('adm-ev-type')?.value || null,
      start_datetime: document.getElementById('adm-ev-start').value,
      end_datetime:   document.getElementById('adm-ev-end').value,
    }),
  });

  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus me-1"></i>Create Event';

  if (!ok) { showAlert('adm-create-event-msg', data.error || 'Failed to create event'); return; }
  showAlert('adm-create-event-msg', 'Event created!', 'success');
  this.reset();
  loadAdminEvents();
});

// Delete club (no longer needs to be on window – called via event delegation)
async function adminDeleteDepartment(id) {
  if (!confirm('Delete this department and all its events?')) return;
  const { ok, data } = await apiFetch(`/api/departments/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete department'); return; }
  loadAdminData();
}

async function adminChangeDepartmentPassword(id) {
  const pw = prompt('Enter a new password for this department (min 6 characters):');
  if (!pw || pw.length < 6) { alert('Password must be at least 6 characters'); return; }
  const { ok, data } = await apiFetch(`/api/departments/${id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password: pw }),
  });
  if (!ok) { alert(data.error || 'Failed to change password'); return; }
  alert('Password changed successfully');
}

// Delete event
async function adminDeleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  const { ok, data } = await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
  if (!ok) { alert(data.error || 'Failed to delete event'); return; }
  loadAdminEvents();
}

/* =============================================================
   INIT
   ============================================================= */
// Load departments and then navigate to home so the header select is populated immediately
loadDepartments().then(() => navigate('home')).catch(() => navigate('home'));
