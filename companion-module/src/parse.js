// Pure parsing of the lines TinRoof Timer pushes after UPDATES ON:
//   STATE {json}     timer state (fields as in emptyState())
//   SPEAKERS [json]  speaker list [{ n, name, time, done }]

export const STATE_LABELS = { PLAYING: 'Running', PAUSED: 'Paused', STOPPED: 'Stopped' }

export function emptyState() {
	return {
		state: 'STOPPED',
		mode: 'TIMER',
		time: '00:00:00', // unsigned hh:mm:ss
		overtime: false,
		seconds: 0, // signed: negative = overtime
		elapsed: '',
		duration: '',
		end: '',
		warn: '',
		progress: 0,
		stopwatch: false,
		message: '',
		target: '',
		speaker: '',
		speakerNumber: 0,
		nextSpeaker: '',
		nextSpeakerNumber: 0,
		speakers: [],
	}
}

function json(line, prefix) {
	line = String(line)
	if (!line.startsWith(prefix)) return null
	try {
		return JSON.parse(line.slice(prefix.length))
	} catch {
		return null
	}
}

/** "STATE {json}" -> state fields, or null if the line isn't one. */
export function parseState(line) {
	const v = json(line, 'STATE ')
	return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

/** "SPEAKERS [json]" -> the list, or null if the line isn't one. */
export function parseSpeakers(line) {
	const v = json(line, 'SPEAKERS ')
	return Array.isArray(v) ? v : null
}

export function clock12(hms) {
	const [h, m] = String(hms || '').split(':')
	if (!h || m === undefined) return ''
	const hour = parseInt(h, 10)
	return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

/** Build the Companion variable values from a state object. */
export function variableValues(st, connected = true) {
	const [h = '00', m = '00', s = '00'] = st.time.split(':')
	const over = !!st.overtime
	const totalMin = parseInt(h, 10) * 60 + parseInt(m, 10)
	return {
		state: STATE_LABELS[st.state] ?? st.state,
		mode: st.mode,
		time: st.time,
		time_hm: `${h}:${m}`,
		time_h: h,
		time_m: m,
		time_s: s,
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
		message: st.message,
		stopwatch: !!st.stopwatch,
		target_time: st.target,
		countdown_to_time: !!st.target,
		speaker_name: st.speaker,
		speaker_number: st.speakerNumber,
		next_speaker_name: st.nextSpeaker,
		next_speaker_number: st.nextSpeakerNumber,
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
