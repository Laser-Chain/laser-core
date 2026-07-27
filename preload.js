const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('laser', {
  startup: () => ipcRenderer.invoke('laser:startup'),
  status: () => ipcRenderer.invoke('laser:status'),
  peers: () => ipcRenderer.invoke('laser:peers'),
  walletList: () => ipcRenderer.invoke('laser:wallet-list'),
  walletOpen: (name, passphrase) =>
    ipcRenderer.invoke('laser:wallet-open', name, passphrase),
  walletCreate: (name, passphrase) =>
    ipcRenderer.invoke('laser:wallet-create', name, passphrase),
  walletRestore: (name) => ipcRenderer.invoke('laser:wallet-restore', name),
  walletExists: (name) => ipcRenderer.invoke('laser:wallet-exists', name),
  walletUnlocked: (name) => ipcRenderer.invoke('laser:wallet-unlocked', name),
  walletLock: (name) => ipcRenderer.invoke('laser:wallet-lock', name),
  copyAddress: (address) => ipcRenderer.invoke('laser:copy-address', address),
  minerMetrics: (wallet) => ipcRenderer.invoke('laser:miner-metrics', wallet),
  mine: (wallet, count) => ipcRenderer.invoke('laser:mine', wallet, count),
  mineStart: (wallet, intervalMs) => ipcRenderer.invoke('laser:mine-start', wallet, intervalMs),
  mineStop: () => ipcRenderer.invoke('laser:mine-stop'),
  mineStatus: () => ipcRenderer.invoke('laser:mine-status'),
  send: (from, to, amount, fee) => ipcRenderer.invoke('laser:send', from, to, amount, fee),
  config: () => ipcRenderer.invoke('laser:config'),
  onBlockMined: (cb) => ipcRenderer.on('mine:block-mined', (_e, state) => cb(state)),
  onMineError: (cb) => ipcRenderer.on('mine:error', (_e, msg, state) => cb(msg, state))
});
