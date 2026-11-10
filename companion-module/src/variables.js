export function getVariables() {
	return [
		{ variableId: 'state', name: 'State of timer (Running, Paused, Stopped)' },
		{ variableId: 'mode', name: 'Display mode (TIMER, CLOCK, BLACK, TEST)' },
		{ variableId: 'time', name: 'Time remaining (hh:mm:ss)' },
		{ variableId: 'time_hm', name: 'Time remaining (hh:mm)' },
		{ variableId: 'time_h', name: 'Time remaining (hours)' },
		{ variableId: 'time_m', name: 'Time remaining (minutes)' },
		{ variableId: 'time_s', name: 'Time remaining (seconds)' },
		{ variableId: 'state_raw', name: 'State (PLAYING, PAUSED, STOPPED)' },
		{ variableId: 'time_signed', name: 'Time remaining with sign (-hh:mm:ss in overtime)' },
		{ variableId: 'time_ms', name: 'Time remaining as total minutes:seconds (e.g. 75:00)' },
		{ variableId: 'time_short', name: 'Time remaining, compact (e.g. 4:59 or 1:02:03)' },
		{ variableId: 'remaining_seconds', name: 'Remaining seconds (negative = overtime)' },
		{ variableId: 'overtime', name: 'Overtime (true/false)' },
		{ variableId: 'elapsed', name: 'Elapsed time (hh:mm:ss) — TinRoof Timer' },
		{ variableId: 'duration', name: 'Set duration (hh:mm:ss) — TinRoof Timer' },
		{ variableId: 'end_time', name: 'Expected end time of day — TinRoof Timer' },
		{ variableId: 'warning', name: 'Warning level (GREEN, AMBER, RED, OVER)' },
		{ variableId: 'progress', name: 'Progress percent (0-100) — TinRoof Timer' },
		{ variableId: 'message_active', name: 'Message on screen (true/false)' },
		{ variableId: 'message', name: 'Message text — TinRoof Timer' },
		{ variableId: 'stopwatch', name: 'Stopwatch mode (true/false) — TinRoof Timer' },
		{ variableId: 'target_time', name: 'End time when counting down to a time of day (HH:MM:SS)' },
		{ variableId: 'countdown_to_time', name: 'Counting down to a time of day (true/false)' },
		{ variableId: 'speaker_name', name: 'Current speaker name' },
		{ variableId: 'speaker_number', name: 'Current speaker number (0 = none)' },
		{ variableId: 'next_speaker_name', name: 'Next speaker name' },
		{ variableId: 'next_speaker_number', name: 'Next speaker number' },
		{ variableId: 'speaker_count', name: 'Number of speakers in the list' },
		{ variableId: 'connected', name: 'Connected to timer (true/false)' },
	]
}

export function getSpeakerSlotVariables(slots) {
	const out = []
	for (let n = 1; n <= slots; n++) {
		out.push({ variableId: `speaker_${n}_name`, name: `Speaker ${n}: name` })
		out.push({ variableId: `speaker_${n}_time`, name: `Speaker ${n}: time` })
		out.push({ variableId: `speaker_${n}_done`, name: `Speaker ${n}: done (true/false)` })
	}
	return out
}
