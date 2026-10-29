const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', { crearAdmin: d => ipcRenderer.invoke('crear-admin', d) });
