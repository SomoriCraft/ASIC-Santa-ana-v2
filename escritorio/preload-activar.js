const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('activar', { enviar: v => ipcRenderer.invoke('activar-enviar', String(v)), cancelar: () => ipcRenderer.invoke('activar-cancelar') });
