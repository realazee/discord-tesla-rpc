/**
 * Settings Panel — Renderer Process
 *
 * Handles UI interactions, persists config via IPC, and renders
 * the Discord preview + live data grid.
 */

/* ------------------------------------------------------------------ */
/*  DOM references                                                    */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const statusBar    = $('#statusBar');
const statusText   = $('#statusText');
const btnLogin     = $('#btnLogin');
const btnLogout    = $('#btnLogout');
const btnStart     = $('#btnStart');
const btnStop      = $('#btnStop');
const vehicleField = $('#vehicleField');
const vehicleSelect = $('#vehicleSelect');
const previewDetails = $('#previewDetails');
const previewState = $('#previewState');
const previewElapsed = $('#previewElapsed');
const dataCard     = $('#dataCard');
const dataGrid     = $('#dataGrid');
const appEl        = $('#app');

// Config inputs
const configInputs = {
  teslaClientId:     $('#teslaClientId'),
  teslaClientSecret: $('#teslaClientSecret'),
  teslaRegion:       $('#teslaRegion'),
  callbackDomain:    $('#callbackDomain'),
  discordClientId:   $('#discordClientId'),
  units:             $('#units'),
};

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */
let startTime = null;
let elapsedTimer = null;

/* ------------------------------------------------------------------ */
/*  Init                                                              */
/* ------------------------------------------------------------------ */
async function init() {
  // Load saved config
  const config = await window.api.getConfig();
  if (config) {
    for (const [key, el] of Object.entries(configInputs)) {
      if (config[key]) el.value = config[key];
    }
  }

  // Load saved toggles
  const toggles = await window.api.getToggles();
  if (toggles) {
    $$('.toggle-row').forEach((row) => {
      const metric = row.dataset.metric;
      const cb = row.querySelector('input[type="checkbox"]');
      if (metric in toggles) cb.checked = toggles[metric];
    });
  }

  // Check auth status
  const auth = await window.api.getAuthStatus();
  updateAuthUI(auth.authenticated);

  // If authenticated, fetch vehicles
  if (auth.authenticated) {
    await loadVehicles();
  }
}

/* ------------------------------------------------------------------ */
/*  Config persistence (debounced)                                    */
/* ------------------------------------------------------------------ */
let saveTimer = null;
function saveConfigDebounced(key, value) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.api.setConfig(key, value);
  }, 400);
}

for (const [key, el] of Object.entries(configInputs)) {
  el.addEventListener('input', () => saveConfigDebounced(key, el.value));
  el.addEventListener('change', () => saveConfigDebounced(key, el.value));
}

/* ------------------------------------------------------------------ */
/*  Toggle persistence                                                */
/* ------------------------------------------------------------------ */
$$('.toggle-row').forEach((row) => {
  const metric = row.dataset.metric;
  const cb = row.querySelector('input[type="checkbox"]');
  cb.addEventListener('change', () => {
    window.api.setToggle(metric, cb.checked);
  });
});

/* ------------------------------------------------------------------ */
/*  Auth                                                              */
/* ------------------------------------------------------------------ */
btnLogin.addEventListener('click', async () => {
  btnLogin.textContent = 'Signing in…';
  btnLogin.disabled = true;
  try {
    await window.api.login();
    updateAuthUI(true);
    await loadVehicles();
  } catch (err) {
    setStatus('error', `Login failed: ${err.message}`);
  }
  btnLogin.textContent = 'Sign in with Tesla';
  btnLogin.disabled = false;
});

btnLogout.addEventListener('click', async () => {
  await window.api.logout();
  updateAuthUI(false);
  vehicleField.style.display = 'none';
  vehicleSelect.innerHTML = '<option value="">Select a vehicle…</option>';
});

function updateAuthUI(authenticated) {
  if (authenticated) {
    btnLogin.style.display = 'none';
    btnLogout.style.display = '';
  } else {
    btnLogin.style.display = '';
    btnLogout.style.display = 'none';
  }
}

async function loadVehicles() {
  try {
    const vehicles = await window.api.getVehicles();
    vehicleSelect.innerHTML = '<option value="">Select a vehicle…</option>';
    const config = await window.api.getConfig();

    vehicles.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.vin;
      opt.textContent = `${v.display_name || v.vin} (${v.vin})`;
      if (v.vin === config.selectedVin) opt.selected = true;
      vehicleSelect.appendChild(opt);
    });

    vehicleField.style.display = 'block';
  } catch (err) {
    console.error('Failed to load vehicles:', err);
  }
}

vehicleSelect.addEventListener('change', () => {
  window.api.selectVehicle(vehicleSelect.value);
});

/* ------------------------------------------------------------------ */
/*  RPC control                                                       */
/* ------------------------------------------------------------------ */
btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  try {
    await window.api.startRPC();
    btnStop.disabled = false;
    appEl.classList.add('rpc-active');
    startTime = Date.now();
    startElapsedTimer();
  } catch (err) {
    setStatus('error', err.message);
    btnStart.disabled = false;
  }
});

btnStop.addEventListener('click', async () => {
  await window.api.stopRPC();
  btnStart.disabled = false;
  btnStop.disabled = true;
  appEl.classList.remove('rpc-active');
  stopElapsedTimer();
  previewDetails.textContent = 'Waiting for data…';
  previewState.textContent = '';
  dataCard.style.display = 'none';
});

/* ------------------------------------------------------------------ */
/*  Elapsed timer                                                     */
/* ------------------------------------------------------------------ */
function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const hrs = Math.floor(elapsed / 3600);
    previewElapsed.textContent = hrs > 0
      ? `${hrs}:${mins}:${secs} elapsed`
      : `${mins}:${secs} elapsed`;
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  previewElapsed.textContent = '00:00 elapsed';
}

/* ------------------------------------------------------------------ */
/*  Status updates from main process                                  */
/* ------------------------------------------------------------------ */
window.api.onStatusChange((status) => {
  setStatus(status.type, status.message);
});

function setStatus(type, message) {
  statusBar.className = `status-bar ${type}`;
  statusText.textContent = message;
}

/* ------------------------------------------------------------------ */
/*  Vehicle data updates from main process                            */
/* ------------------------------------------------------------------ */
window.api.onVehicleData(({ vehicleData, geoData, isDriving }) => {
  updatePreview(vehicleData, geoData, isDriving);
  updateDataGrid(vehicleData, geoData);
});

function updatePreview(data, geo, isDriving) {
  const ds = data.drive_state || {};
  const cs = data.charge_state || {};
  const units = configInputs.units.value;

  // Build details line (mirrors Discord RPC logic)
  const line1 = [];
  const line2 = [];

  // Read current toggle states from DOM
  const getToggle = (m) => {
    const row = document.querySelector(`.toggle-row[data-metric="${m}"]`);
    return row ? row.querySelector('input').checked : false;
  };

  if (getToggle('speed') && ds.speed != null) {
    line1.push(units === 'metric' ? `${Math.round(ds.speed * 1.60934)} km/h` : `${ds.speed} mph`);
  }
  if (getToggle('gear')) {
    const gearMap = { D: 'Drive', R: 'Reverse', N: 'Neutral', P: 'Parked' };
    line1.push(gearMap[ds.shift_state] || 'Parked');
  }
  if (getToggle('street') && geo.street) {
    line1.push(`on ${geo.street}`);
  }
  if (getToggle('location') && geo.city) {
    line1.push(geo.state ? `${geo.city}, ${geo.state}` : geo.city);
  }

  if (getToggle('battery') && cs.battery_level != null) {
    line2.push(`🔋 ${cs.battery_level}%`);
  }
  if (getToggle('range') && cs.battery_range != null) {
    const r = units === 'metric' ? `${Math.round(cs.battery_range * 1.60934)} km` : `${Math.round(cs.battery_range)} mi`;
    line2.push(`⚡ ${r}`);
  }

  previewDetails.textContent = line1.join(' · ') || 'Connected';
  previewState.textContent = line2.join(' · ');

  // Update small icon
  const smallIcon = document.querySelector('.preview-image .small-icon');
  if (isDriving) smallIcon.textContent = '🚗';
  else if (cs.charging_state === 'Charging') smallIcon.textContent = '⚡';
  else smallIcon.textContent = '🅿️';
}

function updateDataGrid(data, geo) {
  const ds = data.drive_state || {};
  const cs = data.charge_state || {};
  const cl = data.climate_state || {};
  const vs = data.vehicle_state || {};
  const units = configInputs.units.value;

  const items = [
    { label: 'Speed', value: ds.speed != null ? (units === 'metric' ? `${Math.round(ds.speed * 1.60934)} km/h` : `${ds.speed} mph`) : '—' },
    { label: 'Gear', value: { D: 'Drive', R: 'Reverse', N: 'Neutral', P: 'Park' }[ds.shift_state] || 'Park' },
    { label: 'Battery', value: cs.battery_level != null ? `${cs.battery_level}%` : '—' },
    { label: 'Range', value: cs.battery_range != null ? (units === 'metric' ? `${Math.round(cs.battery_range * 1.60934)} km` : `${Math.round(cs.battery_range)} mi`) : '—' },
    { label: 'Inside', value: cl.inside_temp != null ? (units === 'metric' ? `${Math.round(cl.inside_temp)}°C` : `${Math.round(cl.inside_temp * 9 / 5 + 32)}°F`) : '—' },
    { label: 'Outside', value: cl.outside_temp != null ? (units === 'metric' ? `${Math.round(cl.outside_temp)}°C` : `${Math.round(cl.outside_temp * 9 / 5 + 32)}°F`) : '—' },
    { label: 'Street', value: geo.street || '—' },
    { label: 'Location', value: geo.city ? (geo.state ? `${geo.city}, ${geo.state}` : geo.city) : '—' },
  ];

  dataGrid.innerHTML = items.map((item) =>
    `<div class="data-cell"><div class="label">${item.label}</div><div class="value">${item.value}</div></div>`
  ).join('');

  dataCard.style.display = '';
}

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */
init();
