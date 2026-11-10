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

function buildView(snap, s, now = new Date(), speaker = {}) {
	const warn = warnLevel(snap, s)
	let color = s.colorNormal
	if (s.whiteOnly) color = s.colorWhite
	else if (warn === 'AMBER') color = s.colorAmber
	else if (warn === 'RED' || warn === 'OVER') color = s.colorRed
	return {
		...snap,
		warn,
		color,
		timerText: formatTimer(snap, s),
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

module.exports = { buildView, warnLevel, formatTimer, formatClock }
