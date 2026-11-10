import { combineRgb } from '@companion-module/base'

const W = combineRgb(255, 255, 255)
const B = combineRgb(0, 0, 0)
const GREY = combineRgb(40, 40, 40)

function btn(category, name, text, actions, feedbacks = [], style = {}) {
	return {
		type: 'button',
		category,
		name,
		style: { text, size: 'auto', color: W, bgcolor: GREY, ...style },
		steps: [{ down: actions.map(([actionId, options = {}]) => ({ actionId, options })), up: [] }],
		feedbacks,
	}
}

export function getPresets(speakerSlots = 20) {
	const p = {}
	p.toggle = btn('Transport', 'Go / Pause', 'GO\\nPAUSE', [['togglePause']], [{ feedbackId: 'state_color', options: {} }])
	p.go = btn('Transport', 'Go', 'GO', [['go']], [{ feedbackId: 'state_is', options: { state: 'PLAYING' }, style: { bgcolor: combineRgb(0, 153, 0) } }])
	p.pause = btn('Transport', 'Pause', 'PAUSE', [['pause']], [{ feedbackId: 'state_is', options: { state: 'PAUSED' }, style: { bgcolor: combineRgb(204, 122, 0) } }])
	p.reset = btn('Transport', 'Reset', 'RESET', [['reset']])
	for (const m of [1, 5]) {
		p[`jog_p${m}`] = btn('Transport', `+${m} min`, `+${m} MIN`, [['jog', { minutes: m }]])
		p[`jog_m${m}`] = btn('Transport', `-${m} min`, `-${m} MIN`, [['jog', { minutes: -m }]])
	}
	p.jog_p10s = btn('Transport', '+10 s', '+10 SEC', [['jogSeconds', { seconds: 10 }]])
	p.jog_m10s = btn('Transport', '-10 s', '-10 SEC', [['jogSeconds', { seconds: -10 }]])

	for (const m of [1, 2, 3, 5, 10, 15, 20, 30, 45, 60]) {
		const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`
		p[`set_${m}`] = btn('Set time', `Set ${m} min`, `SET\\n${m} MIN`, [['resetT', { time: t }]])
		p[`start_${m}`] = btn('Set & start', `Start ${m} min`, `START\\n${m} MIN`, [['start', { time: t }]], [], { bgcolor: combineRgb(0, 70, 0) })
	}
	for (let n = 1; n <= 9; n++) p[`preset_${n}`] = btn('Set time', `Preset ${n}`, `PRESET\\n${n}`, [['preset', { n }]])

	for (const [id, label] of [['TIMER', 'TIMER'], ['CLOCK', 'CLOCK'], ['BLACK', 'BLACK'], ['TEST', 'TEST']]) {
		p[`mode_${id}`] = btn('Display', label, label, [['displayM', { mode: id }]], [{ feedbackId: 'mode_color', options: { mode: id }, style: { bgcolor: combineRgb(47, 124, 246), color: W } }])
	}

	p.time = btn('Status', 'Time remaining (traffic light)', '$(tinroof-timer:time_signed)', [['togglePause']], [{ feedbackId: 'warning_colors', options: { onlyActive: false } }], { size: '14' })
	p.time_short = btn('Status', 'Time remaining (compact)', '$(tinroof-timer:time_short)', [['togglePause']], [{ feedbackId: 'warning_colors', options: { onlyActive: false } }], { size: '24' })
	p.time_h = btn('Status', 'Hours', '$(tinroof-timer:time_h)\\nHRS', [], [{ feedbackId: 'state_color', options: {} }])
	p.time_m = btn('Status', 'Minutes', '$(tinroof-timer:time_m)\\nMIN', [], [{ feedbackId: 'state_color', options: {} }])
	p.time_s = btn('Status', 'Seconds', '$(tinroof-timer:time_s)\\nSEC', [], [{ feedbackId: 'state_color', options: {} }])
	p.elapsed = btn('Status', 'Elapsed', 'ELAPSED\\n$(tinroof-timer:elapsed)', [], [], { size: '14' })
	p.end = btn('Status', 'Ends at', 'ENDS\\n$(tinroof-timer:end_time)', [], [], { size: '14' })
	p.state = btn('Status', 'State', '$(tinroof-timer:state)', [], [{ feedbackId: 'state_color', options: {} }])

	// --- speakers
	p.spk_next = btn('Speakers', 'Next speaker', 'NEXT\n$(tinroof-timer:next_speaker_name)', [['speakerNext', { start: true }]], [], { size: '14', bgcolor: combineRgb(0, 70, 0) })
	p.spk_prev = btn('Speakers', 'Previous speaker', 'PREV\nSPEAKER', [['speakerPrev', { start: true }]], [], { size: '14' })
	p.spk_now = btn('Speakers', 'Current speaker + time', '$(tinroof-timer:speaker_name)\n$(tinroof-timer:time_short)', [['togglePause']], [{ feedbackId: 'warning_colors', options: { onlyActive: true } }], { size: '14' })
	for (let n = 1; n <= speakerSlots; n++) {
		p[`spk_${n}`] = btn(
			'Speakers',
			`Speaker ${n}`,
			`$(tinroof-timer:speaker_${n}_name)\n$(tinroof-timer:speaker_${n}_time)`,
			[['speakerStart', { n: String(n), start: true }]],
			[
				{ feedbackId: 'speaker_done', options: { n } },
				{ feedbackId: 'speaker_next', options: { n } },
				{ feedbackId: 'speaker_live', options: { n } },
			],
			{ size: '14' },
		)
	}

	// --- time of day
	for (const t of ['09:00', '10:00', '12:00', '13:00', '17:00']) {
		p[`until_${t}`] = btn('Count to time of day', `Until ${t}`, `UNTIL\n${t}`, [['countToTime', { time: t, start: true }]], [{ feedbackId: 'countdown_to_time', options: {} }])
	}
	p.until_status = btn('Count to time of day', 'Target time', 'UNTIL\n$(tinroof-timer:target_time)', [], [{ feedbackId: 'countdown_to_time', options: {} }], { size: '14' })

	for (const [i, msg] of ['Please wrap up', '5 minutes left', 'Time is up', 'Take questions now'].entries()) {
		p[`msg_${i}`] = btn('Messages', msg, msg.toUpperCase(), [['message', { message: msg }]], [], { size: '14' })
	}
	p.msg_clear = btn('Messages', 'Clear message', 'CLEAR\\nMSG', [['messageClear']], [{ feedbackId: 'message_on', options: {}, style: { bgcolor: combineRgb(255, 209, 102), color: B } }])
	p.msg_flash = btn('Messages', 'Flash message', 'FLASH\\nMSG', [['messageFlash']], [{ feedbackId: 'message_on', options: {}, style: { bgcolor: combineRgb(255, 209, 102), color: B } }])
	return p
}
