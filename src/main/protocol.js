'use strict'
// TinRoof Timer remote-control protocol (TCP 61002).
//
//  - Commands are one per line, space-separated and case-insensitive; EOL may be \r, \n or \r\n.
//  - Every command gets a reply line: "OK", "IGNORED" (doesn't apply right now), "ERROR"
//    (bad syntax) or a value (REMAINING, STATE, VERSION).
//  - After UPDATES ON the client is also pushed, whenever something changes:
//      STATE {json}     see stateJson() for the fields
//      SPEAKERS [json]  the speaker list [{n, name, time, done}]
//    Pushed lines start with STATE or SPEAKERS, so they can't be mistaken for replies.

const { parseDuration, parseTimeOfDay, hms } = require('./timer')
const { stageView } = require('./view')

function clock(d) {
	const p = (n) => String(n).padStart(2, '0')
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** "SPEAKERS [{n, name, time, done}]": time is hh:mm:ss, or "@" + end time. */
function speakersLine(list, doneIds = []) {
	const done = new Set(doneIds)
	const data = list.map((sp, i) => ({
		n: i + 1,
		name: sp.name,
		time: sp.type === 'until' ? '@' + sp.until : hms(sp.seconds),
		done: done.has(sp.id),
	}))
	return 'SPEAKERS ' + JSON.stringify(data)
}

/** Progress percent from whole seconds, so it changes at most once a second (one push per second). */
function wholeSecondProgress(v) {
	if (v.stopwatch || !(v.durationSeconds > 0)) return 0
	return Math.min(100, Math.max(0, Math.round(100 * (1 - v.seconds / v.durationSeconds))))
}

/** The state pushed to clients, from a buildView() view (real overtime, never held at zero). */
function stateJson(v) {
	return {
		state: v.state, // PLAYING | PAUSED | STOPPED
		mode: v.mode, // TIMER | CLOCK | BLACK | TEST
		time: v.time, // hh:mm:ss, unsigned (elapsed in stopwatch mode)
		overtime: !!v.overtime,
		seconds: v.seconds, // signed: negative = overtime
		elapsed: v.elapsed,
		duration: v.duration,
		end: v.endTime ? clock(new Date(v.endTime)) : '', // hh:mm:ss time of day
		warn: v.warn ?? '', // GREEN | AMBER | RED | OVER
		progress: wholeSecondProgress(v), // 0..100
		stopwatch: !!v.stopwatch,
		message: v.message || '',
		target: v.target ? clock(new Date(v.target)) : '', // end time when counting to a time of day
		speaker: v.speakerName ?? v.label ?? '',
		speakerNumber: v.speakerNumber ?? 0,
		nextSpeaker: v.nextSpeakerName ?? '',
		nextSpeakerNumber: v.nextSpeakerNumber ?? 0,
	}
}

function stateLine(v) {
	return 'STATE ' + JSON.stringify(stateJson(v))
}

/**
 * Handle one command line for a client session.
 * @param {string} raw - the line without EOL
 * @param {object} session - { updates: bool }
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
				session.lastSpeakers = null
				reply = 'OK'
				sendUpdate = true
			} else if (arg1 === 'OFF') {
				session.updates = false
				reply = 'OK'
			}
			break
		case 'VERSION':
		case 'APPVERSION':
			reply = `${cmd} ${ctx.appVersion || '0.0.0'}`
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
				'COMMANDS GO PAUSE TOGGLEPAUSE RESET [time] START <time> REMAINING STATE DISPLAY <TIMER|CLOCK|BLACK|TEST> ' +
				'UPDATES <ON|OFF> VERSION MESSAGE <text|CLEAR|FLASH> JOG <min> JOGSEC <sec> PRESET <1-9> ' +
				'TARGET <hh:mm[:ss]> TARGETSTART <hh:mm[:ss]> SPEAKER <n|NEXT|PREV> CUE <n|NEXT|PREV>'
			break
		default:
			reply = 'ERROR'
	}
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
 * Remote-display packet (UDP 61003), 20 ASCII chars:
 * "IDCT:" + sign + 6-digit seconds + hex timer id + colour + blink + "-----".
 * Follows the main display: colour G/A/R by warning level (W for white-only or the clock),
 * blink 1 while the main display flashes in overtime, and hold at zero applies.
 * In CLOCK mode the seconds field carries the time of day (h*3600 + m*60).
 * @param {object} view - from buildView()
 * @param {object} s - settings (whiteOnly, flashOvertime)
 */
function remoteDisplayPacket(view, id = 0, s = {}, now = new Date()) {
	const stage = stageView(view)
	let sign = stage.overtime ? '-' : '+'
	let secs = Math.abs(stage.seconds)
	let colour = s.whiteOnly ? 'W' : view.warn === 'AMBER' ? 'A' : view.warn === 'RED' || view.warn === 'OVER' ? 'R' : 'G'
	const blink = view.mode === 'TIMER' && view.overtime && s.flashOvertime ? '1' : '0'
	if (view.mode === 'CLOCK') {
		sign = '+'
		secs = now.getHours() * 3600 + now.getMinutes() * 60
		colour = 'W'
	}
	secs = Math.min(secs, 999999)
	const idHex = (id & 0xf).toString(16).toUpperCase()
	return `IDCT:${sign}${String(secs).padStart(6, '0')}${idHex}${colour}${blink}-----`
}

module.exports = { handleCommand, stateJson, stateLine, speakersLine, splitLines, remoteDisplayPacket, hms }
