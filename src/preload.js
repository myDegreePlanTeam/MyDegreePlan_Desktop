// preload.js: the only bridge between the page and the main process. It exposes data and four update actions,
// never a capability to reach the file system, a shell or the network.
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mdpDesktop', Object.freeze({
  isDesktop: true,
  version: () => ipcRenderer.invoke('mdp:version'),
  updates: Object.freeze({
    state: () => ipcRenderer.invoke('mdp:updates:get'),
    check: () => ipcRenderer.invoke('mdp:updates:check'),
    download: () => ipcRenderer.invoke('mdp:updates:download'),
    install: () => ipcRenderer.invoke('mdp:updates:install'),
    // Calls back with each new state; returns a function that stops listening.
    onChange: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('mdp:updates:state', listener)
      return () => ipcRenderer.removeListener('mdp:updates:state', listener)
    },
  }),
}))
