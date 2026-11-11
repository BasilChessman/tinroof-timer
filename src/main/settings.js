'use strict'
const fs = require('node:fs')
const path = require('node:path')

const SETTINGS_VERSION = 1

function defaultPresets() {
	const mins = [1, 2, 3, 5, 10, 15, 20, 30, 45]
	return mins.map((m) => ({ label: '', seconds: m * 60 }))
}

const DEFAULTS = Object.freeze({
	settingsVersion: SETTINGS_VERSION,
	// Timer
	duration: 300,
	presets: defaultPresets(),
	alwaysShowHours: false,
	stopAtZero: false,
	amberSeconds: 120, // Irisdown "Amber Time (mins)" — stored in seconds for finer control
	redSeconds: 60,
	overtimeSign: '-', // '-', '+', or '' shown before overtime on the display
	whiteOnly: false,
	colorNormal: '#00A800', // Irisdown's green
	colorAmber: '#FFB000',
	colorRed: '#FF2020',
	colorWhite: '#FFFFFF',
	flashOvertime: true,
	// Display
	outputDisplay: 'auto', // 'auto' (first non-primary), 'none', or a display id
	hideDisplay: false,
	backgroundColor: '#000000',
	transparentBackground: false,
	brightness: 100, // 10..100 %
	showProgressBar: true,
	showClockWithTimer: false,
	clock24h: true,
	clockSeconds: true,
	showEndTime: false,
	fontFamily: 'system',
	messageFlash: true,
	quickMessages: ['Please wrap up', '5 minutes left', 'Time is up', 'Take questions now', 'Speak up please', 'Look at the camera'],
	savedMessages: [], // the user's own messages, shown after the quick messages
	showSpeakerName: true,
	showNextSpeaker: false,
	// Speaker presets: [{ id, name, type: 'duration'|'until', seconds, until }]
	speakers: [],
	currentSpeaker: -1, // index of the last loaded speaker (cursor for NEXT / PREV)
	speakersDone: [], // ids of speakers that have been started
	timeEntryMode: 'duration', // control UI: 'duration' or 'until'
	// Sounds: { enabled, file, volume (0-100), seconds (trigger at remaining; negative = overtime) }
	sounds: [],
	// Network
	tcpPort: 61002,
	webPort: 8181,
	udpBroadcast: true,
	udpId: 0,
	hiveBroadcast: false,
	ssdp: true,
	// Misc
	loadAtStartup: false,
	alwaysOnTopControl: false,
})

class Settings {
	constructor(dir) {
		this.file = path.join(dir, 'settings.json')
		this.data = structuredClone(DEFAULTS)
		this.load()
	}
	load() {
		try {
			const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
			if (raw && raw.settingsVersion === SETTINGS_VERSION) {
				this.data = { ...structuredClone(DEFAULTS), ...raw }
				if (!Array.isArray(this.data.presets) || this.data.presets.length !== 9) this.data.presets = defaultPresets()
			}
		} catch {
			/* first run or unreadable -> defaults */
		}
		return this.data
	}
	save() {
		try {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			const tmp = this.file + '.tmp'
			fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
			fs.renameSync(tmp, this.file)
		} catch (e) {
			console.error('Could not save settings:', e.message)
		}
	}
	update(patch) {
		const clean = {}
		for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULTS) clean[k] = v
		Object.assign(this.data, clean)
		this.save()
		return clean
	}
	resetToDefaults() {
		this.data = structuredClone(DEFAULTS)
		this.save()
	}
}

module.exports = { Settings, DEFAULTS }
