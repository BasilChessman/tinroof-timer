'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
	cmd: (action, ...args) => ipcRenderer.invoke('cmd', action, ...args),
	getSettings: () => ipcRenderer.invoke('settings:get'),
	setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
	resetSettings: () => ipcRenderer.invoke('settings:reset'),
	getDisplays: () => ipcRenderer.invoke('displays'),
	getNetInfo: () => ipcRenderer.invoke('net:info'),
	importSpeakers: () => ipcRenderer.invoke('speakers:import'),
	exportSpeakers: () => ipcRenderer.invoke('speakers:export'),
	pickSound: () => ipcRenderer.invoke('sound:pick'),
	soundUrl: (file) => ipcRenderer.invoke('sound:url', file),
	appInfo: () => ipcRenderer.invoke('app:info'),
	openExternal: (url) => ipcRenderer.invoke('open:external', url),
	focusControl: () => ipcRenderer.send('focus:control'),
	on: (channel, fn) => {
		const allowed = ['view', 'settings', 'play-sound', 'net', 'open-settings', 'open-about']
		if (!allowed.includes(channel)) return
		ipcRenderer.on(channel, (_e, data) => fn(data))
	},
})
