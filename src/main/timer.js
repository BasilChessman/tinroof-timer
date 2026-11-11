'use strict'
// Core countdown engine. Pure logic, no Electron/network dependencies.
// Time is injected (now()) so it can be unit-tested deterministically.

const { EventEmitter } = require('node:events')

const MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000 // 99:59:59, same ceiling as Irisdown
const STATES = Object.freeze({ STOPPED: 'STOPPED', PLAYING: 'PLAYING', PAUSED: 'PAUSED' })
const MODES = Object.freeze(['TIMER', 'CLOCK', 'BLACK', 'TEST'])
const MESSAGE_MAX = 90 // Irisdown truncates messages over 90 characters

function pad2(n) {
	return String(n).padStart(2, '0')
}

/** Whole seconds shown for a remaining-ms value (counts "up" through each second like a stage clock). */
function displaySeconds(ms) {
	const s = Math.ceil(ms / 1000)
	return s === 0 ? 0 : s // normalise -0
}

/** hh:mm:ss of an absolute number of seconds. */
function hms(totalSeconds) {
	const t = Math.abs(totalSeconds)
	return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`
}

/**
 * Parse a duration the way Irisdown's RESET does: integer minutes ("25"),
 * hh:mm ("01:30") or hh:mm:ss ("00:05:30"). Returns ms or null when invalid.
 */
function parseDuration(text) {
	if (text == null) return null
	const str = String(text).trim()
	const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str)
	if (m) {
		const h = +m[1]
		const mi = +m[2]
		const s = m[3] === undefined ? 0 : +m[3]
		if (h >= 100 || mi >= 60 || s >= 60) return null
		return (h * 3600 + mi * 60 + s) * 1000
	}
	if (/^\d+$/.test(str)) {
		const ms = +str * 60000
		return ms <= MAX_MS ? ms : null
	}
	return null
}

/**
 * Parse a time of day ("14:30", "14:30:15", "2:30pm", "2:30 PM") into the next
 * occurrence as epoch ms (today, or tomorrow if that time has already passed).
 */
function parseTimeOfDay(text, nowMs = Date.now()) {
	if (text == null) return null
	const m = /^\s*(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?\s*$/i.exec(String(text))
	if (!m) return null
	let h = +m[1]
	const mi = +m[2]
	const s = m[3] === undefined ? 0 : +m[3]
	if (mi >= 60 || s >= 60) return null
	if (m[4]) {
		if (h < 1 || h > 12) return null
		const pm = m[4][0].toLowerCase() === 'p'
		h = (h % 12) + (pm ? 12 : 0)
	} else if (h > 23) return null
	const d = new Date(nowMs)
	d.setHours(h, mi, s, 0)
	if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1)
	return d.getTime()
}

class TimerEngine extends EventEmitter {
	constructor({ now = () => Date.now(), stopAtZero = false } = {}) {
		super()
		this.now = now
		this.stopAtZero = stopAtZero
		this.state = STATES.STOPPED
		this.duration = 5 * 60000 // last set duration
		this.remainingAtAnchor = this.duration // remaining ms at anchor time
		this.anchor = 0 // now() when last started/resumed
		this.elapsedAtAnchor = 0
		this.mode = 'TIMER'
		this.message = ''
		this.messageSeq = 0 // increments every time a message is (re)sent, used to trigger flash
		this.messageFlashSeq = 0 // increments only on an explicit flash request (always flashes)
		this.finished = false // reached zero with stopAtZero
		this.target = null // epoch ms when counting down to a time of day
		this.label = '' // e.g. current speaker name
		this.tag = '' // caller's id for the label (e.g. speaker id), copied into run records
		this.run = null // the run in progress: set by go() from stopped, ended by reset/finish
	}

	// ---- derived values -------------------------------------------------
	get stopwatch() {
		return this.target == null && this.duration === 0
	}

	remainingMs() {
		if (this.target != null) {
			// Time-of-day mode: remaining follows the wall clock, except while paused (frozen)
			if (this.state === STATES.PAUSED || this.finished) return this.remainingAtAnchor
			const r = this.target - this.now()
			if (this.state === STATES.PLAYING && this.stopAtZero && r <= 0) {
				this._finish()
				return 0
			}
			return r
		}
		if (this.state === STATES.PLAYING) {
			const r = this.remainingAtAnchor - (this.now() - this.anchor)
			if (this.stopAtZero && !this.stopwatch && r <= 0) {
				this._finish()
				return 0
			}
			return r
		}
		return this.remainingAtAnchor
	}

	elapsedMs() {
		if (this.state === STATES.PLAYING) return this.elapsedAtAnchor + (this.now() - this.anchor)
		return this.elapsedAtAnchor
	}

	/** Seconds remaining as integer (negative = overtime). In stopwatch mode, elapsed seconds (positive). */
	seconds() {
		if (this.stopwatch) return Math.floor(this.elapsedMs() / 1000)
		return displaySeconds(this.remainingMs())
	}

	overtime() {
		return !this.stopwatch && this.seconds() < 0
	}

	/** End time of day (ms epoch) if running/paused, else null. */
	endTime() {
		if (this.target != null) return this.target
		if (this.stopwatch || this.state === STATES.STOPPED) return null
		return this.now() + this.remainingMs()
	}

	// ---- control --------------------------------------------------------
	_finish() {
		// ran until zero: elapsed grows by the time that was left at the last anchor
		const left = this.target != null ? Math.max(0, this.target - this.anchor) : this.remainingAtAnchor
		this.state = STATES.STOPPED
		this.elapsedAtAnchor += left
		this.remainingAtAnchor = 0
		this.finished = true
		this._endRun()
		this.emit('change', 'finished')
	}

	/**
	 * Close the current run (start from stopped until reset, new time, or stop-at-zero) and
	 * emit a 'run' record: how long the timer actually ran, excluding pauses, and the overtime.
	 */
	_endRun() {
		if (!this.run) return
		const remaining = this.remainingMs() // may hit stop-at-zero, which ends the run itself
		if (!this.run) return
		const run = this.run
		this.run = null
		const elapsed = this.elapsedMs()
		if (elapsed < 1000) return // started and stopped straight away: not worth recording
		const ran = Math.floor(elapsed / 1000)
		const rem = this.stopwatch ? 0 : displaySeconds(remaining)
		this.emit('run', {
			label: run.label,
			tag: run.tag,
			startedAt: run.startedAt,
			endedAt: this.now(),
			stopwatch: this.stopwatch,
			plannedSeconds: this.stopwatch ? 0 : Math.max(0, ran + rem),
			ranSeconds: ran,
			overSeconds: Math.max(0, -rem),
		})
	}

	/** End the current run now (e.g. when quitting) without changing the timer. */
	endRun() {
		this._endRun()
	}

	go() {
		if (this.state === STATES.PLAYING) return false
		if (this.target != null && this.finished) return false // end time already reached
		if (this.state === STATES.STOPPED && this.finished) {
			// Starting again after stop-at-zero restarts with last duration
			this.remainingAtAnchor = this.duration
			this.elapsedAtAnchor = 0
			this.finished = false
		}
		this.anchor = this.now()
		if (!this.run) this.run = { label: this.label, tag: this.tag, startedAt: this.anchor }
		this.state = STATES.PLAYING
		this.emit('change', 'go')
		return true
	}

	pause() {
		if (this.state !== STATES.PLAYING) return false
		const r = this.remainingMs()
		if (this.state !== STATES.PLAYING) return false // stopAtZero fired
		this.elapsedAtAnchor = this.elapsedMs()
		this.remainingAtAnchor = r
		this.state = STATES.PAUSED
		this.emit('change', 'pause')
		return true
	}

	togglePause() {
		return this.state === STATES.PLAYING ? this.pause() : this.go()
	}

	/**
	 * Stop and load a duration. Without an argument reloads the last duration
	 * (or, in time-of-day mode, re-arms the same end time). A new duration leaves
	 * time-of-day mode and clears the label.
	 */
	reset(ms) {
		if (ms != null && (!Number.isFinite(ms) || ms < 0 || ms > MAX_MS)) return false
		this._endRun()
		if (ms != null) {
			this.duration = Math.round(ms)
			this.target = null
			this.label = ''
			this.tag = ''
		}
		this.state = STATES.STOPPED
		this.elapsedAtAnchor = 0
		this.finished = false
		if (this.target != null) {
			this.duration = Math.max(0, this.target - this.now())
			this.remainingAtAnchor = this.target - this.now()
		} else this.remainingAtAnchor = this.duration
		this.emit('change', 'reset')
		return true
	}

	/** Set duration and start immediately. */
	start(ms) {
		if (!this.reset(ms)) return false
		return this.go()
	}

	/** Count down to a time of day (epoch ms). Stops the timer; call go() to run. */
	setTarget(epochMs) {
		const left = epochMs - this.now()
		if (!Number.isFinite(epochMs) || left <= 0 || left > MAX_MS) return false
		this._endRun()
		this.target = epochMs
		this.label = ''
		this.tag = ''
		this.duration = left
		this.remainingAtAnchor = left
		this.elapsedAtAnchor = 0
		this.state = STATES.STOPPED
		this.finished = false
		this.emit('change', 'target')
		return true
	}

	startTarget(epochMs) {
		return this.setTarget(epochMs) && this.go()
	}

	setLabel(text, tag = '') {
		this.label = String(text ?? '').slice(0, 60)
		this.tag = String(tag ?? '')
		this.emit('change', 'label')
		return true
	}

	/**
	 * Add (or remove) time from the remaining time. Mirrors Irisdown's JOG:
	 * result must stay > 0 and <= 99:59:59, otherwise the jog is ignored.
	 */
	jog(deltaMs) {
		if (this.stopwatch && this.state === STATES.STOPPED) return false
		const r = this.remainingMs()
		const next = r + deltaMs
		if (this.stopwatch) {
			// in stopwatch mode jog moves elapsed instead
			const e = this.elapsedMs() + deltaMs
			if (e < 0 || e > MAX_MS) return false
			this.elapsedAtAnchor = e
			this.anchor = this.now()
			this.emit('change', 'jog')
			return true
		}
		if (next <= 0 || next > MAX_MS) return false
		if (this.target != null) {
			// time-of-day mode: jog moves the end time
			this.target += deltaMs
			this.duration = Math.max(0, this.duration + deltaMs)
			if (this.state !== STATES.PLAYING) this.remainingAtAnchor = next
			this.finished = false
			this.emit('change', 'jog')
			return true
		}
		if (this.state === STATES.PLAYING) {
			this.remainingAtAnchor = next
			this.elapsedAtAnchor = this.elapsedMs()
			this.anchor = this.now()
		} else {
			this.remainingAtAnchor = next
			if (this.state === STATES.STOPPED) {
				this.duration = next
				this.finished = false
			}
		}
		this.emit('change', 'jog')
		return true
	}

	setMode(mode) {
		mode = String(mode).toUpperCase()
		if (!MODES.includes(mode)) return false
		this.mode = mode
		this.emit('change', 'mode')
		return true
	}

	setMessage(text) {
		text = String(text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, MESSAGE_MAX)
		this.message = text
		this.messageSeq++
		this.emit('change', 'message')
		return true
	}

	clearMessage() {
		this.message = ''
		this.emit('change', 'message')
		return true
	}

	/** Re-trigger the flash on the current message. */
	flashMessage() {
		if (!this.message) return false
		this.messageFlashSeq++
		this.emit('change', 'message')
		return true
	}

	// ---- serialisable snapshot -----------------------------------------
	snapshot() {
		const remaining = this.remainingMs() // may trigger stop-at-zero first
		const secs = this.seconds()
		const elapsedS = Math.floor(this.elapsedMs() / 1000)
		const end = this.endTime()
		const durationS = Math.round(this.duration / 1000)
		let progress = 0
		if (!this.stopwatch && this.duration > 0) {
			progress = Math.min(1, Math.max(0, 1 - remaining / this.duration))
		}
		return {
			state: this.state,
			mode: this.mode,
			stopwatch: this.stopwatch,
			seconds: secs, // signed: negative = overtime (countdown); elapsed (stopwatch)
			remainingMs: remaining,
			overtime: !this.stopwatch && secs < 0,
			time: hms(secs), // hh:mm:ss, unsigned
			sign: !this.stopwatch && secs < 0 ? '-' : '+',
			elapsedSeconds: elapsedS,
			elapsed: hms(elapsedS),
			durationSeconds: durationS,
			duration: hms(durationS),
			endTime: end,
			progress,
			message: this.message,
			messageSeq: this.messageSeq,
			messageFlashSeq: this.messageFlashSeq,
			finished: this.finished,
			target: this.target, // epoch ms in time-of-day mode, else null
			label: this.label,
		}
	}
}

module.exports = { TimerEngine, STATES, MODES, MAX_MS, MESSAGE_MAX, parseDuration, parseTimeOfDay, hms, pad2, displaySeconds }
