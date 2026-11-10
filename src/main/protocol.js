'use strict'
// Irisdown Countdown Timer 2.0 remote-control protocol (TCP 61002), reimplemented
// from the published protocol PDF and the shipped 2.0.17 binary's command parser.
//
// Compatibility notes (verified against Countdown Timer 2.0.17's ParsePacket):
//  - Commands are space-separated, case-insensitive; EOL may be \r, \n or \r\n.
//  - Replies: "OK", "IGNORED" (out of context) or "ERROR" (bad syntax), CRLF terminated.
//  - "PLAY" is an undocumented alias of GO.
//  - While UPDATES is ON, every other reply is suppressed.
//  - MESSAGE strips one pair of surrounding "double" or 'single' quotes.
//  - JOG accepts integer minutes in -60..60 and is IGNORED if the result would be <= 0.
//
// Extensions (do not affect Irisdown clients):
//  - UPDATEMODE 3: mode-2 fields plus extra fields for richer Companion variables.
//  - JOGSEC <seconds>, START <time>, PRESET <1-9>, MESSAGE FLASH, APPVERSION, HELP.
//  - TARGET <hh:mm[:ss]> / TARGETSTART <hh:mm[:ss]>: count down to a time of day.
//  - SPEAKER <n|NEXT|PREV> loads and starts a speaker preset; CUE <n|NEXT|PREV> loads only.
//  - In UPDATEMODE 3 the speaker list is pushed as "SPEAKERS=<url-encoded JSON>" when it changes.

const { parseDuration, parseTimeOfDay, hms } = require('./timer')

// Reported by VERSION. The Companion module enables UPDATEMODE 2 only when the
// reported version is > 2.0.9.3, so we report an Irisdown-compatible level.
const COMPAT_VERSION = '2.0.17.0'

function clock(d) {
	const p = (n) => String(n).padStart(2, '0')
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Mode-3 speaker list line: SPEAKERS=<url-encoded JSON [{n,name,time,done}]> */
function speakersLine(list, doneIds = []) {
	const done = new Set(doneIds)
	const data = list.map((sp, i) => ({
		n: i + 1,
		name: sp.name,
		time: sp.type === 'until' ? '@' + sp.until : hms(sp.seconds),
		done: done.has(sp.id),
	}))
	return 'SPEAKERS=' + encodeURIComponent(JSON.stringify(data))
}

function modeLine(snap, updateMode, extra = {}) {
	if (updateMode === 1) return `${snap.time} ${snap.state} ${snap.mode}`
	let line =
		`TIME=${snap.sign}${snap.time}&STATE=${snap.state}&DISPLAY=${snap.mode}` +
		`&MESSAGE=${snap.message ? 'TRUE' : 'FALSE'}`
	if (updateMode === 3) {
		const endStr = snap.endTime ? clock(new Date(snap.endTime)) : ''
		line +=
			`&SECONDS=${snap.seconds}` +
			`&ELAPSED=${snap.elapsed}` +
			`&DURATION=${snap.duration}` +
			`&END=${endStr}` +
			`&WARN=${extra.warn ?? ''}` +
			`&PROGRESS=${Math.round(snap.progress * 100)}` +
			`&STOPWATCH=${snap.stopwatch ? 'TRUE' : 'FALSE'}` +
			`&TEXT=${encodeURIComponent(snap.message)}` +
			`&TARGET=${snap.target ? clock(new Date(snap.target)) : ''}` +
			`&SPEAKER=${encodeURIComponent(snap.speakerName ?? snap.label ?? '')}` +
			`&SPEAKERNUM=${snap.speakerNumber ?? 0}` +
			`&NEXTSPEAKER=${encodeURIComponent(snap.nextSpeakerName ?? '')}` +
			`&NEXTSPEAKERNUM=${snap.nextSpeakerNumber ?? 0}`
	}
	return line
}

/**
 * Handle one command line for a client session.
 * @param {string} raw - the line without EOL
 * @param {object} session - { updates: bool, updateMode: 1|2|3 }
 * @param {object} ctx - { engine, appVersion, warn(): string, loadPreset(n): bool }
 * @returns {{reply: string|null, sendUpdate: boolean}}
 */
function handleCommand(raw, session, ctx) {
	const { engine } = ctx
	const line = String(raw).trim()
	if (!line) return { reply: null, sendUpdate: false }
	const parts = line.split(/ +/)
	const cmd = parts[0].toUpperCase()
	const arg1 = parts[1] !== undefined ? parts[1].toUpperCase() : undefined
	let reply = 'ERROR'
	let sendUpdate = false

	switch (cmd) {
		case 'GO':
		case 'PLAY':
			reply = engine.go() ? 'OK' : 'IGNORED'
			break
		case 'PAUSE':
			reply = engine.pause() ? 'OK' : 'IGNORED'
			break
		case 'TOGGLEPAUSE':
			reply = engine.togglePause() ? 'OK' : 'IGNORED'
			break
		case 'RESET':
			if (parts.length === 1) {
				reply = engine.reset() ? 'OK' : 'ERROR'
			} else {
				const ms = parseDuration(parts[1])
				reply = ms != null && engine.reset(ms) ? 'OK' : 'ERROR'
			}
			break
		case 'START': {
			const ms = parts.length > 1 ? parseDuration(parts[1]) : null
			reply = ms != null && engine.start(ms) ? 'OK' : 'ERROR'
			break
		}
		case 'REMAINING':
			reply = String(Math.ceil(engine.remainingMs() / 1000) || 0)
			break
		case 'STATE':
			reply = engine.state
			break
		case 'DISPLAY':
			reply = arg1 && engine.setMode(arg1) ? 'OK' : 'ERROR'
			break
		case 'UPDATES':
			if (arg1 === 'ON') {
				session.updates = true
				session.lastLine = null
				reply = 'OK'
				sendUpdate = true
			} else if (arg1 === 'OFF') {
				session.updates = false
				reply = 'OK'
			}
			break
		case 'UPDATEMODE':
			if (arg1 === '1' || arg1 === '2' || arg1 === '3') {
				session.updateMode = +arg1
				session.lastLine = null
				reply = 'OK'
				sendUpdate = session.updates
			}
			break
		case 'VERSION':
			reply = `VERSION ${COMPAT_VERSION}`
			break
		case 'APPVERSION':
			reply = `APPVERSION ${ctx.appVersion || '0.0.0'}`
			break
		case 'MESSAGE': {
			if (parts.length === 1) break // ERROR
			if (arg1 === 'CLEAR' && parts.length === 2) {
				engine.clearMessage()
				reply = 'OK'
				break
			}
			if (arg1 === 'FLASH' && parts.length === 2) {
				reply = engine.flashMessage() ? 'OK' : 'IGNORED'
				break
			}
			let text = line.slice(7).trim()
			if (text.length >= 2 && ((text[0] === '"' && text.endsWith('"')) || (text[0] === "'" && text.endsWith("'")))) {
				text = text.slice(1, -1)
			}
			reply = text.length ? (engine.setMessage(text), 'OK') : 'IGNORED'
			break
		}
		case 'JOG': {
			if (!/^-?\d+$/.test(parts[1] ?? '')) break
			const min = parseInt(parts[1], 10)
			if (min < -60 || min > 60) break
			reply = min !== 0 && engine.jog(min * 60000) ? 'OK' : 'IGNORED'
			break
		}
		case 'JOGSEC': {
			if (!/^-?\d+$/.test(parts[1] ?? '')) break
			const s = parseInt(parts[1], 10)
			if (Math.abs(s) > 3600) break
			reply = s !== 0 && engine.jog(s * 1000) ? 'OK' : 'IGNORED'
			break
		}
		case 'TARGET':
		case 'TARGETSTART': {
			const t = parseTimeOfDay(parts.slice(1).join(' '), engine.now())
			if (t == null) break
			const ok = cmd === 'TARGET' ? engine.setTarget(t) : engine.startTarget(t)
			reply = ok ? 'OK' : 'IGNORED'
			break
		}
		case 'SPEAKER':
		case 'CUE': {
			const sel = arg1 === 'NEXT' || arg1 === 'PREV' ? arg1 : parseInt(parts[1], 10)
			if (sel !== 'NEXT' && sel !== 'PREV' && !(sel >= 1)) break
			reply = ctx.speaker && ctx.speaker(sel, cmd === 'SPEAKER') ? 'OK' : 'IGNORED'
			break
		}
		case 'PRESET': {
			const n = parseInt(parts[1], 10)
			if (!(n >= 1 && n <= 9)) break
			reply = ctx.loadPreset && ctx.loadPreset(n) ? 'OK' : 'IGNORED'
			break
		}
		case 'HELP':
			reply =
				'COMMANDS GO PLAY PAUSE TOGGLEPAUSE RESET [time] START <time> REMAINING STATE DISPLAY <TIMER|CLOCK|BLACK|TEST> ' +
				'UPDATES <ON|OFF> UPDATEMODE <1|2|3> VERSION APPVERSION MESSAGE <text|CLEAR|FLASH> JOG <min> JOGSEC <sec> PRESET <1-9> ' +
				'TARGET <hh:mm[:ss]> TARGETSTART <hh:mm[:ss]> SPEAKER <n|NEXT|PREV> CUE <n|NEXT|PREV>'
			break
		default:
			reply = 'ERROR'
	}

	// While UPDATES is on, Irisdown suppresses all other replies.
	if (session.updates) reply = null
	return { reply, sendUpdate }
}

/**
 * Split an incoming byte stream into command lines (EOL = \r, \n or \r\n).
 * Returns [lines, remainder].
 */
function splitLines(buffer) {
	const lines = buffer.split(/\r\n|\r|\n/)
	const rest = lines.pop()
	return [lines, rest]
}

// ---- UDP broadcast payloads ---------------------------------------------

/**
 * Irisdown "remote display" packet (UDP 61003), 20 ASCII chars:
 * "IDCT:" + sign + 6-digit seconds + hex timer id + colour 'G' + blink '0' + "-----".
 * In CLOCK mode the seconds field carries the time of day (h*3600 + m*60).
 */
function remoteDisplayPacket(snap, id = 0, now = new Date()) {
	let sign = snap.overtime ? '-' : '+'
	let secs = Math.abs(snap.seconds)
	if (snap.mode === 'CLOCK') {
		sign = '+'
		secs = now.getHours() * 3600 + now.getMinutes() * 60
	}
	secs = Math.min(secs, 999999)
	const idHex = (id & 0xf).toString(16).toUpperCase()
	return `IDCT:${sign}${String(secs).padStart(6, '0')}${idHex}G0-----`
}

function bcd(n) {
	return ((Math.floor(n / 10) & 0xf) << 4) + (n % 10)
}

/**
 * Interspace/Hive CDEther receiver packet (UDP 36700), 3 bytes:
 * [BCD minutes, BCD seconds, flags]. Mirrors Countdown Timer 2.0.17 UDPSend_Hive.
 * flags: 1 = green, 3 = amber, 2 = red, 0 = blank (BLACK mode).
 */
function hivePacket(snap, warn, now = new Date()) {
	let b0
	let b1
	let flags
	if (snap.mode === 'CLOCK') {
		b0 = bcd(now.getHours())
		b1 = bcd(now.getMinutes())
		flags = 1
	} else {
		let s = snap.seconds
		if (s > 5999) s = 5999
		if (s < -599) s = -599
		const a = Math.abs(s)
		const min = Math.floor(a / 60)
		b0 = bcd(min)
		if (s < 0 && min < 10) b0 |= 10 // as shipped
		b1 = bcd(a % 60)
		flags = warn === 'AMBER' ? 3 : warn === 'RED' || warn === 'OVER' ? 2 : 1
		if (snap.mode === 'BLACK') flags = 0
	}
	return Buffer.from([b0 & 0xff, b1 & 0xff, flags])
}

module.exports = { handleCommand, modeLine, speakersLine, splitLines, remoteDisplayPacket, hivePacket, COMPAT_VERSION, hms }
