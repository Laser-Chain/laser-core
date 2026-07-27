const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('laserSplash', {
  identity: () => ipcRenderer.invoke('splash:identity'),
  onStatus: (callback) => {
    ipcRenderer.on('splash:status', (_event, status) => callback(status));
  }
});
