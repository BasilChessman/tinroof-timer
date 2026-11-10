'use strict'
// Speaker presets: a running order of speakers, each with a duration or an end time of day.
// Speaker: { id, name, type: 'duration' | 'until', seconds, until: 'HH:MM[:SS]' }

const crypto = require('node:crypto')

const MAX_SPEAKERS = 200

function newId() {
	return crypto.randomBytes(4).toString('hex')
}

function hms(total) {
	const t = Math.max(0, Math.round(total))
	const p = (n) => String(n).padStart(2, '0')
	return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`
}

/**
 * Parse a speaker time cell: "15" = minutes, "5:30" = m:ss, "1:05:00" = h:mm:ss,
 * "@10:30" or "until 10:30" = end time of day. Returns {type, seconds, until} or null.
 */
function parseSpeakerTime(text) {
	const t = String(text ?? '').trim()
	const until = /^(?:@|until\s+)(.+)$/i.exec(t)
	if (until) {
		const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(until[1].trim())
		if (!m) return null
		return { type: 'until', seconds: 0, until: until[1].trim() }
	}
	if (/^\d+(\.\d+)?$/.test(t)) return { type: 'duration', seconds: Math.round(parseFloat(t) * 60), until: '' }
	const parts = t.split(':')
	if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null
	const n = parts.map(Number)
	const secs = parts.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2]
	return { type: 'duration', seconds: secs, until: '' }
}

function normalize(sp) {
	const type = sp?.type === 'until' ? 'until' : 'duration'
	return {
		id: typeof sp?.id === 'string' && sp.id ? sp.id : newId(),
		name: String(sp?.name ?? '').trim().slice(0, 60) || 'Speaker',
		type,
		seconds: Math.max(0, Math.min(359999, Math.round(Number(sp?.seconds) || 0))),
		until: type === 'until' ? String(sp?.until ?? '').trim() : '',
	}
}

function normalizeList(list) {
	return (Array.isArray(list) ? list : []).slice(0, MAX_SPEAKERS).map(normalize)
}

/** Split one CSV line, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line) {
	const out = []
	let cur = ''
	let q = false
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (q) {
			if (c === '"' && line[i + 1] === '"') {
				cur += '"'
				i++
			} else if (c === '"') q = false
			else cur += c
		} else if (c === '"') q = true
		else if (c === ',' || c === ';' || c === '\t') {
			out.push(cur)
			cur = ''
		} else cur += c
	}
	out.push(cur)
	return out.map((s) => s.trim())
}

/**
 * Parse CSV text: "name,time" per line (header row optional).
 * Returns { speakers, errors: [lineNumber, ...] }.
 */
function parseCsv(text) {
	const speakers = []
	const errors = []
	const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/)
	lines.forEach((line, i) => {
		if (!line.trim()) return
		const [name, time] = splitCsvLine(line)
		const t = parseSpeakerTime(time)
		if (!t) {
			if (i === 0) return // header row
			errors.push(i + 1)
			return
		}
		if (speakers.length < MAX_SPEAKERS) speakers.push(normalize({ name, ...t }))
	})
	return { speakers, errors }
}

function toCsv(list) {
	const esc = (s) => (/[",;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
	const rows = ['Name,Time']
	for (const sp of normalizeList(list)) rows.push(`${esc(sp.name)},${sp.type === 'until' ? '@' + sp.until : hms(sp.seconds)}`)
	return rows.join('\r\n') + '\r\n'
}

module.exports = { parseSpeakerTime, parseCsv, toCsv, normalize, normalizeList, newId, hms, MAX_SPEAKERS }
