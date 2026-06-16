/**
 * Electron Preload — secure IPC bridge
 *
 * Exposes a safe `window.api` object to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- Config ---
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // --- Auth ---
  login: () => ipcRenderer.invoke('tesla-login'),
  logout: () => ipcRenderer.invoke('tesla-logout'),
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),

  // --- Vehicles ---
  getVehicles: () => ipcRenderer.invoke('get-vehicles'),
  selectVehicle: (vin) => ipcRenderer.invoke('select-vehicle', vin),

  // --- RPC control ---
  startRPC: () => ipcRenderer.invoke('start-rpc'),
  stopRPC: () => ipcRenderer.invoke('stop-rpc'),

  // --- Toggles ---
  setToggle: (metric, enabled) => ipcRenderer.invoke('set-toggle', metric, enabled),
  getToggles: () => ipcRenderer.invoke('get-toggles'),

  // --- Events from main ---
  onVehicleData: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('vehicle-data', handler);
    return () => ipcRenderer.removeListener('vehicle-data', handler);
  },
  onStatusChange: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('status-change', handler);
    return () => ipcRenderer.removeListener('status-change', handler);
  },
});
