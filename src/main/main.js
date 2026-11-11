'use strict'
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain, screen, dialog, Menu, shell } = require('electron')
const fs = require('node:fs')
const { TimerEngine, parseTimeOfDay } = require('./timer')
const speakersLib = require('./speakers')
const { Settings } = require('./settings')
const { buildView } = require('./view')
const { NetworkServices } = require('./network')
const { COMPAT_VERSION } = require('./protocol')

const RENDERER = path.join(__dirname, '..', 'renderer')
const isMac = process.platform === 'darwin'

if (!app.requestSingleInstanceLock()) {
	app.quit()
	process.exit(0)
}

let settings
let engine
let net
let controlWin = null
let outputWin = null
let outputKey = '' // identifies the current output placement so we only rebuild when needed
let lastSoundSeconds = null
let quitting = false

const S = () => settings.data
const view = () => buildView(engine.snapshot(), S(), new Date(), speakerInfo())

function speakerInfo() {
	const list = S().speakers
	const cur = S().currentSpeaker
	const active = !!engine.label && cur >= 0 && cur < list.length && list[cur].name === engine.label
	const next = list[cur + 1]
	return { number: active ? cur + 1 : 0, count: list.length, nextName: next?.name || '', nextNumber: next ? cur + 2 : 0 }
}

// ------------------------------------------------------------------ windows
function createControlWindow() {
	controlWin = new BrowserWindow({
		width: 1180,
		height: 800,
		minWidth: 900,
		minHeight: 640,
		title: 'TinRoof Timer',
		backgroundColor: '#14161a',
		alwaysOnTop: !!S().alwaysOnTopControl,
		webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
	})
	controlWin.loadFile(path.join(RENDERER, 'control.html'))
	if (process.env.TINROOF_TIMER_DEBUG) controlWin.webContents.on('console-message', (e) => console.log('[control]', e.level, e.message, e.lineNumber))
	controlWin.on('close', (e) => {
		// Closing the control window quits the app (the output can't be operated without it)
		if (!quitting) {
			quitting = true
			app.quit()
		}
	})
	controlWin.on('closed', () => (controlWin = null))
}

function targetDisplay() {
	const s = S()
	if (s.hideDisplay || s.outputDisplay === 'none') return null
	const all = screen.getAllDisplays()
	const primary = screen.getPrimaryDisplay()
	if (s.outputDisplay !== 'auto') {
		const d = all.find((x) => String(x.id) === String(s.outputDisplay))
		if (d) return { display: d, fullscreen: true }
	}
	const secondary = all.find((x) => x.id !== primary.id)
	if (secondary) return { display: secondary, fullscreen: true }
	if (s.outputDisplay !== 'auto') {
		// explicitly chosen display (e.g. the primary) -> honour it
		const d = all.find((x) => String(x.id) === String(s.outputDisplay))
		if (d) return { display: d, fullscreen: true }
	}
	return { display: primary, fullscreen: false } // single screen: windowed output
}

function placeOutput(force = false) {
	const t = targetDisplay()
	const s = S()
	const key = t ? `${t.display.id}|${t.fullscreen}|${s.transparentBackground}|${JSON.stringify(t.display.bounds)}` : 'none'
	if (!force && key === outputKey && (outputWin || !t)) return
	outputKey = key
	if (outputWin) {
		outputWin.removeAllListeners('closed')
		outputWin.destroy()
		outputWin = null
	}
	if (!t) return
	const b = t.display.bounds
	const opts = {
		title: 'TinRoof Timer - Output',
		show: false,
		backgroundColor: s.transparentBackground ? '#00000000' : s.backgroundColor,
		transparent: !!s.transparentBackground,
		autoHideMenuBar: true,
		webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
	}
	if (t.fullscreen) {
		Object.assign(opts, { x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true })
	} else {
		Object.assign(opts, { width: 960, height: 540, x: b.x + 60, y: b.y + 60, frame: !s.transparentBackground })
	}
	outputWin = new BrowserWindow(opts)
	outputWin.loadFile(path.join(RENDERER, 'output.html'))
	outputWin.once('ready-to-show', () => {
		if (t.fullscreen) {
			// A borderless window covering the display at screen-saver level, which sits above
			// the menu bar and Dock on that display. Not setSimpleFullScreen on macOS: that hides
			// the menu bar and Dock app-wide, so they vanish on the main screen as well whenever
			// TinRoof Timer is the active app.
			outputWin.setAlwaysOnTop(true, 'screen-saver')
			outputWin.setBounds(b)
			outputWin.showInactive()
		} else outputWin.show()
		pushSettings()
	})
	outputWin.on('closed', () => {
		outputWin = null
		outputKey = ''
	})
}

function toggleOutput() {
	settings.update({ hideDisplay: !S().hideDisplay })
	placeOutput()
	pushSettings()
}

// ------------------------------------------------------------------ broadcast to windows
function windows() {
	return [controlWin, outputWin].filter((w) => w && !w.isDestroyed())
}

function pushSettings() {
	for (const w of windows()) w.webContents.send('settings', S())
}

function pushView() {
	const v = view()
	for (const w of windows()) w.webContents.send('view', v)
	checkSounds(v)
}

function checkSounds(v) {
	const cur = v.stopwatch ? null : v.seconds
	const prev = lastSoundSeconds
	lastSoundSeconds = cur
	if (cur == null || prev == null || v.state !== 'PLAYING' || cur >= prev) return
	for (const snd of S().sounds) {
		if (!snd.enabled || !snd.file) continue
		const at = Number(snd.seconds)
		if (prev > at && cur <= at) controlWin?.webContents.send('play-sound', snd)
	}
}

// ------------------------------------------------------------------ actions
function loadPreset(n) {
	const p = S().presets[n - 1]
	if (!p) return false
	const ok = engine.reset(p.seconds * 1000)
	return ok
}

/**
 * Load speaker preset (sel = 1-based number, 'NEXT' or 'PREV') and optionally start it.
 */
function loadSpeaker(sel, start) {
	const list = S().speakers
	if (!list.length) return false
	const cur = S().currentSpeaker
	const idx = sel === 'NEXT' ? cur + 1 : sel === 'PREV' ? cur - 1 : Number(sel) - 1
	if (!(idx >= 0 && idx < list.length)) return false
	const sp = list[idx]
	let ok
	if (sp.type === 'until') {
		const t = parseTimeOfDay(sp.until, Date.now())
		ok = t != null && engine.setTarget(t)
	} else ok = engine.reset(sp.seconds * 1000)
	if (!ok) return false
	engine.setLabel(sp.name)
	settings.update({ currentSpeaker: idx })
	if (start) engine.go()
	pushSettings()
	return true
}

function markSpeakerDone() {
	const info = speakerInfo()
	if (!info.number) return
	const sp = S().speakers[info.number - 1]
	if (!S().speakersDone.includes(sp.id)) {
		settings.update({ speakersDone: [...S().speakersDone, sp.id] })
		pushSettings()
	}
}

/** Save a duration (seconds, from the Set time fields) into preset n. Does not touch the running timer. */
function savePreset(n, seconds) {
	const presets = structuredClone(S().presets)
	const secs = Math.round(Number(seconds))
	if (!presets[n - 1] || !(secs >= 0 && secs <= 359999)) return false
	presets[n - 1].seconds = secs
	settings.update({ presets })
	pushSettings()
	return true
}

const actions = {
	go: () => engine.go(),
	pause: () => engine.pause(),
	toggle: () => engine.togglePause(),
	reset: (secs) => engine.reset(secs == null ? undefined : secs * 1000),
	start: (secs) => engine.start(secs * 1000),
	jog: (secs) => engine.jog(secs * 1000),
	mode: (m) => engine.setMode(m),
	message: (text) => engine.setMessage(text),
	clearMessage: () => engine.clearMessage(),
	flashMessage: () => engine.flashMessage(),
	loadPreset: (n) => loadPreset(n),
	savePreset: (n, seconds) => savePreset(n, seconds),
	toggleOutput: () => toggleOutput(),
	reloadOutput: () => placeOutput(true),
	// time-of-day countdown: text "HH:MM[:SS]" (24h) or with am/pm
	target: (text) => {
		const t = parseTimeOfDay(text, Date.now())
		return t != null && engine.setTarget(t)
	},
	startTarget: (text) => {
		const t = parseTimeOfDay(text, Date.now())
		return t != null && engine.startTarget(t)
	},
	speaker: (n, start = true) => loadSpeaker(n, start),
	clearSpeakersDone: () => {
		settings.update({ speakersDone: [], currentSpeaker: -1 })
		pushSettings()
		return true
	},
}

// ------------------------------------------------------------------ menu
function buildMenu() {
	const template = [
		...(isMac ? [{ role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => controlWin?.webContents.send('open-settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
		{
			label: 'File',
			submenu: [
				...(!isMac ? [{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => controlWin?.webContents.send('open-settings') }, { type: 'separator' }] : []),
				{
					label: 'Load default settings…',
					click: async () => {
						const r = await dialog.showMessageBox(controlWin, { type: 'question', buttons: ['Cancel', 'Load defaults'], defaultId: 0, message: 'Are you sure you want to delete current settings and load defaults?' })
						if (r.response === 1) {
							settings.resetToDefaults()
							engine.stopAtZero = S().stopAtZero
							applySystemSettings()
							net.restart()
							placeOutput(true)
							pushSettings()
						}
					},
				},
				{ type: 'separator' },
				isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
			],
		},
		{ role: 'editMenu' },
		{
			label: 'Output',
			submenu: [
				{ label: 'Show / Hide Output Display', accelerator: 'CmdOrCtrl+D', click: () => toggleOutput() },
				{ label: 'Rebuild Output Window', click: () => placeOutput(true) },
				{ type: 'separator' },
				{ label: 'Timer', accelerator: 'CmdOrCtrl+1', click: () => engine.setMode('TIMER') },
				{ label: 'Clock', accelerator: 'CmdOrCtrl+2', click: () => engine.setMode('CLOCK') },
				{ label: 'Black', accelerator: 'CmdOrCtrl+3', click: () => engine.setMode('BLACK') },
				{ label: 'Test Pattern', accelerator: 'CmdOrCtrl+4', click: () => engine.setMode('TEST') },
			],
		},
		{ role: 'viewMenu' },
		{ role: 'windowMenu' },
		{
			role: 'help',
			submenu: [
				{ label: 'About TinRoof Timer', click: () => controlWin?.webContents.send('open-about') },
				{ label: 'Open Web View', click: () => shell.openExternal(`http://127.0.0.1:${S().webPort}/`) },
			],
		},
	]
	Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function applySystemSettings() {
	try {
		const want = !!S().loadAtStartup
		if (app.getLoginItemSettings().openAtLogin !== want) app.setLoginItemSettings({ openAtLogin: want })
	} catch {}
	controlWin?.setAlwaysOnTop(!!S().alwaysOnTopControl)
}

// ------------------------------------------------------------------ IPC
function registerIpc() {
	ipcMain.handle('cmd', (_e, action, ...args) => {
		const fn = actions[action]
		if (!fn) return false
		const r = fn(...args)
		pushView()
		return r
	})
	ipcMain.handle('settings:get', () => S())
	ipcMain.handle('settings:set', (_e, patch) => {
		const before = { ...S() }
		if (patch && 'speakers' in patch) {
			patch = { ...patch, speakers: speakersLib.normalizeList(patch.speakers) }
			const ids = new Set(patch.speakers.map((x) => x.id))
			patch.speakersDone = S().speakersDone.filter((id) => ids.has(id))
			// keep the cursor on the same speaker if it moved; drop it if deleted
			const curId = S().speakers[S().currentSpeaker]?.id
			patch.currentSpeaker = curId ? patch.speakers.findIndex((x) => x.id === curId) : -1
		}
		const changed = settings.update(patch)
		if ('stopAtZero' in changed) engine.stopAtZero = !!S().stopAtZero
		if ('loadAtStartup' in changed || 'alwaysOnTopControl' in changed) applySystemSettings()
		if (['tcpPort', 'webPort', 'ssdp'].some((k) => k in changed && changed[k] !== before[k])) net.restart()
		if (['outputDisplay', 'hideDisplay', 'transparentBackground'].some((k) => k in changed)) placeOutput()
		if ('backgroundColor' in changed && outputWin && !S().transparentBackground) outputWin.setBackgroundColor(S().backgroundColor)
		pushSettings()
		pushView()
		return S()
	})
	ipcMain.handle('settings:reset', () => {
		settings.resetToDefaults()
		engine.stopAtZero = S().stopAtZero
		applySystemSettings()
		net.restart()
		placeOutput(true)
		pushSettings()
		return S()
	})
	ipcMain.handle('displays', () => {
		const primary = screen.getPrimaryDisplay().id
		return screen.getAllDisplays().map((d, i) => ({
			id: String(d.id),
			label: `${d.label || 'Display ' + (i + 1)} — ${d.size.width}×${d.size.height}${d.id === primary ? ' (primary)' : ''}`,
		}))
	})
	ipcMain.handle('net:info', () => net.info())
	ipcMain.handle('speakers:import', async () => {
		const r = await dialog.showOpenDialog(controlWin, { title: 'Import speakers (CSV: name, time)', properties: ['openFile'], filters: [{ name: 'CSV / text', extensions: ['csv', 'txt', 'tsv'] }] })
		if (r.canceled) return null
		try {
			return speakersLib.parseCsv(fs.readFileSync(r.filePaths[0], 'utf8'))
		} catch (e) {
			return { speakers: [], errors: [], error: e.message }
		}
	})
	ipcMain.handle('speakers:export', async () => {
		const r = await dialog.showSaveDialog(controlWin, { title: 'Export speakers', defaultPath: 'speakers.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
		if (r.canceled || !r.filePath) return false
		fs.writeFileSync(r.filePath, speakersLib.toCsv(S().speakers))
		return true
	})
	ipcMain.handle('sound:pick', async () => {
		const r = await dialog.showOpenDialog(controlWin, { title: 'Select an audio file', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'] }] })
		return r.canceled ? null : r.filePaths[0]
	})
	ipcMain.handle('sound:url', (_e, file) => pathToFileURL(file).href)
	ipcMain.handle('app:info', () => ({ version: app.getVersion(), compat: COMPAT_VERSION, electron: process.versions.electron, platform: process.platform }))
	ipcMain.handle('open:external', (_e, url) => {
		if (/^https?:\/\//.test(url)) shell.openExternal(url)
	})
	ipcMain.on('focus:control', () => {
		if (!controlWin) return
		if (controlWin.isMinimized()) controlWin.restore()
		controlWin.show()
		controlWin.focus()
	})
}

// ------------------------------------------------------------------ lifecycle
app.on('second-instance', () => {
	if (controlWin) {
		if (controlWin.isMinimized()) controlWin.restore()
		controlWin.focus()
	}
})

/** The app was renamed from "Speaker Timer": carry its settings over on first launch. */
function migrateOldSettings() {
	try {
		const dest = path.join(app.getPath('userData'), 'settings.json')
		const old = path.join(app.getPath('appData'), 'Speaker Timer', 'settings.json')
		if (!fs.existsSync(dest) && fs.existsSync(old)) {
			fs.mkdirSync(path.dirname(dest), { recursive: true })
			fs.copyFileSync(old, dest)
		}
	} catch (e) {
		console.error('Settings migration failed:', e.message)
	}
}

app.whenReady().then(() => {
	migrateOldSettings()
	settings = new Settings(app.getPath('userData'))
	engine = new TimerEngine({ stopAtZero: !!S().stopAtZero })
	engine.reset(S().duration * 1000)
	engine.on('change', (why) => {
		if (why === 'go') markSpeakerDone()
		if ((why === 'reset' || why === 'jog') && engine.target == null) {
			const d = Math.round(engine.duration / 1000)
			if (d !== S().duration) settings.update({ duration: d })
		}
		setImmediate(pushView)
	})

	net = new NetworkServices({
		engine,
		getSettings: S,
		getView: view,
		loadPreset,
		speaker: (sel, start) => loadSpeaker(sel, start),
		appVersion: app.getVersion(),
		log: (m) => console.log(m),
		onClientsChanged: () => controlWin?.webContents.send('net', net.info()),
	})
	net.start()

	registerIpc()
	buildMenu()
	applySystemSettings()
	createControlWindow()
	placeOutput(true)

	screen.on('display-added', () => placeOutput())
	screen.on('display-removed', () => placeOutput())
	screen.on('display-metrics-changed', () => placeOutput())

	setInterval(pushView, 100)

	// Test hook: TINROOF_TIMER_SNAPSHOT=<dir> captures both windows to PNG then quits.
	if (process.env.TINROOF_TIMER_SNAPSHOT) snapshotAndQuit(process.env.TINROOF_TIMER_SNAPSHOT)
})

async function snapshotAndQuit(dir) {
	const fs = require('node:fs')
	const script = process.env.TINROOF_TIMER_SNAPSHOT_SCRIPT || ''
	await new Promise((r) => setTimeout(r, 1500))
	for (const step of script.split(';').filter(Boolean)) {
		const [action, ...args] = step.split(':')
		if (action === 'wait') await new Promise((r) => setTimeout(r, +args[0]))
		else if (action === 'settings') controlWin.webContents.send('open-settings')
		else if (action === 'js') await controlWin.webContents.executeJavaScript(decodeURIComponent(args.join(':')))
		else if (action === 'set') (settings.update(JSON.parse(args.join(':'))), pushSettings())
		else actions[action]?.(...args.map((a) => (/^-?\d+$/.test(a) ? +a : a)))
	}
	await new Promise((r) => setTimeout(r, 800))
	for (const [name, w] of [['control', controlWin], ['output', outputWin]]) {
		if (!w) continue
		const img = await w.webContents.capturePage()
		fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG())
	}
	quitting = true
	app.quit()
}

app.on('before-quit', () => {
	quitting = true
	net?.stop()
	if (outputWin && !outputWin.isDestroyed()) outputWin.destroy()
})

app.on('window-all-closed', () => app.quit())
