'use strict'
// Turns an engine snapshot + settings into what every output shows:
// the formatted timer text, its colour and the warning level.
const { pad2 } = require('./timer')

function warnLevel(snap, s) {
	if (snap.stopwatch) return 'GREEN'
	if (snap.overtime) return 'OVER'
	if (snap.seconds <= s.redSeconds) return 'RED'
	if (snap.seconds <= s.amberSeconds) return 'AMBER'
	return 'GREEN'
}

function formatTimer(snap, s) {
	const t = Math.abs(snap.seconds)
	const h = Math.floor(t / 3600)
	const m = Math.floor((t % 3600) / 60)
	const sec = t % 60
	const body = s.alwaysShowHours || h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`
	return snap.overtime ? `${s.overtimeSign || ''}${body}` : body
}

function formatClock(date, s, withSeconds = s.clockSeconds) {
	let h = date.getHours()
	let suffix = ''
	if (!s.clock24h) {
		suffix = h >= 12 ? ' PM' : ' AM'
		h = h % 12 || 12
	}
	const hh = s.clock24h ? pad2(h) : String(h)
	return `${hh}:${pad2(date.getMinutes())}${withSeconds ? ':' + pad2(date.getSeconds()) : ''}${suffix}`
}

/**
 * With "hold at zero" the stage outputs show 00:00 in overtime while the engine keeps
 * counting, so the control window, run log and Companion still see the real overtime.
 */
function heldAtZero(snap, s) {
	return s.atZero === 'hold' && snap.overtime
}

/** The view as the stage outputs (display, web view, UDP displays) should show it. */
function stageView(v) {
	return v.held ? { ...v, seconds: 0, overtime: false, sign: '+', time: '00:00:00' } : v
}

function buildView(snap, s, now = new Date(), speaker = {}) {
	const warn = warnLevel(snap, s)
	const held = heldAtZero(snap, s)
	const timerText = formatTimer(snap, s)
	let color = s.colorNormal
	if (s.whiteOnly) color = s.colorWhite
	else if (warn === 'AMBER') color = s.colorAmber
	else if (warn === 'RED' || warn === 'OVER') color = s.colorRed
	return {
		...snap,
		warn,
		color,
		timerText,
		held,
		stageText: held ? formatTimer({ ...snap, seconds: 0, overtime: false }, s) : timerText,
		clockText: formatClock(now, s),
		endText: snap.endTime ? formatClock(new Date(snap.endTime), s) : '',
		targetText: snap.target ? formatClock(new Date(snap.target), s) : '',
		nowMs: now.getTime(),
		speakerName: snap.label || '',
		speakerNumber: speaker.number || 0,
		speakerCount: speaker.count || 0,
		nextSpeakerName: speaker.nextName || '',
		nextSpeakerNumber: speaker.nextNumber || 0,
	}
}

module.exports = { buildView, stageView, warnLevel, formatTimer, formatClock }
