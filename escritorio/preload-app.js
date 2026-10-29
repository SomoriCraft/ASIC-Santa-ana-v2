const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cdi', { guardarPDF: (html, nombre) => ipcRenderer.invoke('guardar-pdf', { html, nombre }) });
