'use strict'
// Record of every timer run: who, when, planned time, how long it actually ran and the overtime.
// Kept in its own file (not settings.json) so loading default settings doesn't erase it.
// Entry: { id, label, speakerId, startedAt, endedAt, stopwatch, plannedSeconds, ranSeconds, overSeconds }

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MAX_ENTRIES = 1000

function hms(total) {
	const t = Math.max(0, Math.round(total))
	const p = (n) => String(n).padStart(2, '0')
	return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`
}

function localDate(ms) {
	const d = new Date(ms)
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function localTime(ms) {
	const d = new Date(ms)
	const p = (n) => String(n).padStart(2, '0')
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function toCsv(entries) {
	const esc = (s) => (/[",;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
	const rows = ['Speaker,Date,Started,Ended,Planned,Actual,Over']
	for (const e of entries) {
		rows.push(
			[
				esc(e.label || ''),
				localDate(e.startedAt),
				localTime(e.startedAt),
				localTime(e.endedAt),
				e.stopwatch ? '' : hms(e.plannedSeconds),
				hms(e.ranSeconds),
				e.stopwatch ? '' : hms(e.overSeconds),
			].join(',')
		)
	}
	return rows.join('\r\n') + '\r\n'
}

class RunLog {
	constructor(dir) {
		this.file = path.join(dir, 'runlog.json')
		this.entries = []
		try {
			const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
			if (Array.isArray(raw)) this.entries = raw
		} catch {
			/* none yet */
		}
	}
	add(rec) {
		const entry = {
			id: crypto.randomBytes(4).toString('hex'),
			label: String(rec.label || ''),
			speakerId: String(rec.tag || ''),
			startedAt: rec.startedAt,
			endedAt: rec.endedAt,
			stopwatch: !!rec.stopwatch,
			plannedSeconds: rec.plannedSeconds,
			ranSeconds: rec.ranSeconds,
			overSeconds: rec.overSeconds,
		}
		this.entries.push(entry)
		if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
		this.save()
		return entry
	}
	clear() {
		this.entries = []
		this.save()
	}
	save() {
		try {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			const tmp = this.file + '.tmp'
			fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 1))
			fs.renameSync(tmp, this.file)
		} catch (e) {
			console.error('Could not save run log:', e.message)
		}
	}
}

module.exports = { RunLog, toCsv, hms }
