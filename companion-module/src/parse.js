// Pure parsing of the timer's UPDATES lines (mode 1, 2 and the TinRoof Timer mode 3).

export const STATE_LABELS = { PLAYING: 'Running', PAUSED: 'Paused', STOPPED: 'Stopped' }

export function emptyState() {
	return {
		time: '00:00:00',
		sign: '+',
		state: 'STOPPED',
		mode: 'TIMER',
		message: false,
		messageText: '',
		seconds: 0,
		elapsed: '',
		duration: '',
		end: '',
		warn: '',
		progress: 0,
		stopwatch: false,
		extended: false,
		target: '',
		speaker: '',
		speakerNum: 0,
		nextSpeaker: '',
		nextSpeakerNum: 0,
		speakers: [], // [{ n, name, time, done }]
	}
}

/** "SPEAKERS=<url-encoded JSON>" pushed by TinRoof Timer in UPDATEMODE 3. Returns the list or null. */
export function parseSpeakers(line) {
	if (!String(line).startsWith('SPEAKERS=')) return null
	try {
		const list = JSON.parse(decodeURIComponent(line.slice(9)))
		return Array.isArray(list) ? list : null
	} catch {
		return null
	}
}

/**
 * Parse one line. Returns a partial state object, or null if the line is not an update.
 *  mode 1: "00:10:00 STOPPED TIMER"
 *  mode 2: "TIME=+00:10:00&STATE=STOPPED&DISPLAY=TIMER&MESSAGE=FALSE"
 *  mode 3: mode 2 + "&SECONDS=600&ELAPSED=..&DURATION=..&END=..&WARN=..&PROGRESS=..&STOPWATCH=..&TEXT=.."
 */
export function parseUpdate(line) {
	line = String(line).trim()
	if (line.startsWith('TIME=')) {
		const f = {}
		for (const kv of line.split('&')) {
			const i = kv.indexOf('=')
			if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1)
		}
		const t = f.TIME || '+00:00:00'
		const sign = t[0] === '-' ? '-' : '+'
		const out = {
			sign,
			time: t.replace(/^[+-]/, ''),
			state: f.STATE || 'STOPPED',
			mode: f.DISPLAY || 'TIMER',
			message: f.MESSAGE === 'TRUE',
		}
		if ('SECONDS' in f) {
			Object.assign(out, {
				extended: true,
				seconds: parseInt(f.SECONDS, 10) || 0,
				elapsed: f.ELAPSED || '',
				duration: f.DURATION || '',
				end: f.END || '',
				warn: f.WARN || '',
				progress: parseInt(f.PROGRESS, 10) || 0,
				stopwatch: f.STOPWATCH === 'TRUE',
				messageText: safeDecode(f.TEXT || ''),
				target: f.TARGET || '',
				speaker: safeDecode(f.SPEAKER || ''),
				speakerNum: parseInt(f.SPEAKERNUM, 10) || 0,
				nextSpeaker: safeDecode(f.NEXTSPEAKER || ''),
				nextSpeakerNum: parseInt(f.NEXTSPEAKERNUM, 10) || 0,
			})
		} else {
			out.seconds = toSeconds(out.time) * (sign === '-' ? -1 : 1)
		}
		return out
	}
	const parts = line.split(' ')
	if (parts.length === 3 && /^\d{2}:\d{2}:\d{2}$/.test(parts[0])) {
		return { time: parts[0], sign: '+', state: parts[1], mode: parts[2], seconds: toSeconds(parts[0]) }
	}
	return null
}

function safeDecode(s) {
	try {
		return decodeURIComponent(s)
	} catch {
		return s
	}
}

export function toSeconds(hms) {
	const [h, m, s] = String(hms).split(':').map((x) => parseInt(x, 10) || 0)
	return h * 3600 + m * 60 + s
}

/** "17:05:30" -> "5:05 PM" (seconds dropped); empty in, empty out. */
export function clock12(hms) {
	const [h, m] = String(hms || '').split(':')
	if (!h || m === undefined) return ''
	const hour = parseInt(h, 10)
	return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

/** Build the Companion variable values from a state object. */
export function variableValues(st, connected = true) {
	const [h = '00', m = '00', s = '00'] = st.time.split(':')
	const over = st.sign === '-'
	const totalMin = parseInt(h, 10) * 60 + parseInt(m, 10)
	return {
		// --- same ids as the Irisdown module (drop-in replacement for button text) ---
		state: STATE_LABELS[st.state] ?? st.state,
		mode: st.mode,
		time: st.time,
		time_hm: `${h}:${m}`,
		time_h: h,
		time_m: m,
		time_s: s,
		// --- extras ---
		state_raw: st.state,
		time_signed: `${over ? '-' : ''}${st.time}`,
		time_ms: `${over ? '-' : ''}${String(totalMin).padStart(2, '0')}:${s}`,
		time_short: `${over ? '-' : ''}${parseInt(h, 10) > 0 ? `${parseInt(h, 10)}:${m}:${s}` : `${parseInt(m, 10)}:${s}`}`,
		remaining_seconds: st.seconds,
		overtime: over,
		elapsed: st.elapsed,
		duration: st.duration,
		end_time: st.end,
		end_time_hm: clock12(st.end),
		warning: st.warn,
		progress: st.progress,
		message_active: !!st.message,
		message: st.messageText,
		stopwatch: !!st.stopwatch,
		target_time: st.target,
		countdown_to_time: !!st.target,
		speaker_name: st.speaker,
		speaker_number: st.speakerNum,
		next_speaker_name: st.nextSpeaker,
		next_speaker_number: st.nextSpeakerNum,
		speaker_count: st.speakers.length,
		connected,
	}
}

/** Per-speaker variables speaker_<n>_name / _time / _done for n = 1..slots. */
export function speakerSlotValues(list, slots) {
	const v = {}
	for (let n = 1; n <= slots; n++) {
		const sp = list[n - 1]
		v[`speaker_${n}_name`] = sp ? sp.name : ''
		v[`speaker_${n}_time`] = sp ? String(sp.time).replace(/^@/, 'until ') : ''
		v[`speaker_${n}_done`] = sp ? !!sp.done : false
	}
	return v
}
