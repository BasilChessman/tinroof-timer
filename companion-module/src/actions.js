// Action ids go/pause/togglePause/reset/resetT/jog/message/messageClear/displayM match the
// Irisdown module so existing button configs translate 1:1.
const MODE_CHOICES = [
	{ id: 'TIMER', label: 'Timer' },
	{ id: 'CLOCK', label: 'Clock' },
	{ id: 'BLACK', label: 'Black' },
	{ id: 'TEST', label: 'Test pattern' },
]
export { MODE_CHOICES }

function cleanTime(t) {
	return String(t ?? '').trim().replace(/\s+/g, '')
}

export function getActions(self) {
	const simple = (name, cmd) => ({ name, options: [], callback: async () => self.send(cmd) })
	return {
		go: simple('Start timer with current duration or resume', 'GO'),
		pause: simple('Pause timer', 'PAUSE'),
		togglePause: simple('Toggle pause (start / pause / resume)', 'TOGGLEPAUSE'),
		reset: simple('Reset timer to last duration', 'RESET'),
		resetT: {
			name: 'Reset timer with new duration',
			options: [
				{ type: 'textinput', id: 'time', label: 'Time: minutes (e.g. 25) or hh:mm:ss (e.g. 00:05:30)', default: '00:05:00', useVariables: true },
			],
			callback: async (a, ctx) => self.send(`RESET ${cleanTime(await ctx.parseVariablesInString(a.options.time))}`),
		},
		start: {
			name: 'Set duration and start (TinRoof Timer)',
			options: [
				{ type: 'textinput', id: 'time', label: 'Time: minutes or hh:mm:ss', default: '00:05:00', useVariables: true },
			],
			callback: async (a, ctx) => {
				const t = cleanTime(await ctx.parseVariablesInString(a.options.time))
				if (self.isTinRoofTimer) await self.send(`START ${t}`)
				else {
					await self.send(`RESET ${t}`)
					await self.send('GO')
				}
			},
		},
		jog: {
			name: 'Jog timer up/down (minutes)',
			options: [{ type: 'number', id: 'minutes', label: 'Minutes (negative to subtract)', default: 1, min: -60, max: 60 }],
			callback: async (a) => self.send(`JOG ${Math.trunc(Number(a.options.minutes) || 0)}`),
		},
		jogSeconds: {
			name: 'Jog timer up/down (seconds, TinRoof Timer)',
			options: [{ type: 'number', id: 'seconds', label: 'Seconds (negative to subtract)', default: 10, min: -3600, max: 3600 }],
			callback: async (a) => self.send(`JOGSEC ${Math.trunc(Number(a.options.seconds) || 0)}`),
		},
		preset: {
			name: 'Load preset 1-9 (TinRoof Timer)',
			options: [{ type: 'number', id: 'n', label: 'Preset', default: 1, min: 1, max: 9 }],
			callback: async (a) => self.send(`PRESET ${a.options.n}`),
		},
		message: {
			name: 'Show message',
			options: [{ type: 'textinput', id: 'message', label: 'Message (max 90 characters)', useVariables: true }],
			callback: async (a, ctx) => {
				const m = (await ctx.parseVariablesInString(a.options.message)).replace(/[\r\n]+/g, ' ')
				await self.send(`MESSAGE "${m}"`)
			},
		},
		messageClear: simple('Clear message', 'MESSAGE CLEAR'),
		messageFlash: simple('Flash current message again (TinRoof Timer)', 'MESSAGE FLASH'),
		displayM: {
			name: 'Change display mode',
			options: [{ type: 'dropdown', id: 'mode', label: 'Display mode', default: 'TIMER', choices: MODE_CHOICES }],
			callback: async (a) => self.send(`DISPLAY ${a.options.mode}`),
		},
		countToTime: {
			name: 'Count down to a time of day (TinRoof Timer)',
			options: [
				{ type: 'textinput', id: 'time', label: 'End time (e.g. 14:30, 14:30:00 or 2:30pm)', default: '12:00', useVariables: true },
				{ type: 'checkbox', id: 'start', label: 'Start immediately', default: true },
			],
			callback: async (a, ctx) => {
				const t = (await ctx.parseVariablesInString(a.options.time)).trim()
				await self.send(`${a.options.start ? 'TARGETSTART' : 'TARGET'} ${t}`)
			},
		},
		speakerStart: {
			name: 'Speaker: start speaker by number (TinRoof Timer)',
			options: [
				{ type: 'textinput', id: 'n', label: 'Speaker number (1 = first in the list)', default: '1', useVariables: true },
				{ type: 'checkbox', id: 'start', label: 'Start the countdown (unticked = cue only)', default: true },
			],
			callback: async (a, ctx) => {
				const n = parseInt(await ctx.parseVariablesInString(String(a.options.n)), 10)
				if (n >= 1) await self.send(`${a.options.start ? 'SPEAKER' : 'CUE'} ${n}`)
			},
		},
		speakerNext: {
			name: 'Speaker: next (TinRoof Timer)',
			options: [{ type: 'checkbox', id: 'start', label: 'Start the countdown (unticked = cue only)', default: true }],
			callback: async (a) => self.send(`${a.options.start ? 'SPEAKER' : 'CUE'} NEXT`),
		},
		speakerPrev: {
			name: 'Speaker: previous (TinRoof Timer)',
			options: [{ type: 'checkbox', id: 'start', label: 'Start the countdown (unticked = cue only)', default: true }],
			callback: async (a) => self.send(`${a.options.start ? 'SPEAKER' : 'CUE'} PREV`),
		},
		custom: {
			name: 'Send custom command',
			options: [{ type: 'textinput', id: 'cmd', label: 'Command', default: 'GO', useVariables: true }],
			callback: async (a, ctx) => self.send(await ctx.parseVariablesInString(a.options.cmd)),
		},
	}
}
