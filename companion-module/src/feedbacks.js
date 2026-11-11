import { combineRgb } from '@companion-module/base'
import { MODE_CHOICES } from './actions.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function getFeedbacks(self) {
	return {
		state_color: {
			type: 'advanced',
			name: 'Change colors from state',
			description: 'Change the colors of a button according to the timer state',
			options: [
				{ type: 'colorpicker', label: 'Running: Foreground color', id: 'run_fg', default: WHITE },
				{ type: 'colorpicker', label: 'Running: Background color', id: 'run_bg', default: combineRgb(0, 153, 0) },
				{ type: 'colorpicker', label: 'Paused: Foreground color', id: 'pause_fg', default: WHITE },
				{ type: 'colorpicker', label: 'Paused: Background color', id: 'pause_bg', default: combineRgb(204, 122, 0) },
			],
			callback: (fb) => {
				if (self.st.state === 'PLAYING') return { color: fb.options.run_fg, bgcolor: fb.options.run_bg }
				if (self.st.state === 'PAUSED') return { color: fb.options.pause_fg, bgcolor: fb.options.pause_bg }
				return {}
			},
		},
		state_is: {
			type: 'boolean',
			name: 'Timer state is…',
			options: [
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					default: 'PLAYING',
					choices: [
						{ id: 'PLAYING', label: 'Running' },
						{ id: 'PAUSED', label: 'Paused' },
						{ id: 'STOPPED', label: 'Stopped' },
					],
				},
			],
			defaultStyle: { color: WHITE, bgcolor: combineRgb(0, 153, 0) },
			callback: (fb) => self.st.state === fb.options.state,
		},
		mode_color: {
			type: 'boolean',
			name: 'Display mode is…',
			options: [{ type: 'dropdown', id: 'mode', label: 'Mode', default: 'TIMER', choices: MODE_CHOICES }],
			defaultStyle: { color: WHITE, bgcolor: combineRgb(255, 0, 0) },
			callback: (fb) => self.st.mode === fb.options.mode,
		},
		message_on: {
			type: 'boolean',
			name: 'Message is on screen',
			options: [],
			defaultStyle: { color: BLACK, bgcolor: combineRgb(255, 209, 102) },
			callback: () => !!self.st.message,
		},
		warning: {
			type: 'boolean',
			name: 'Warning level is…',
			options: [
				{
					type: 'dropdown',
					id: 'level',
					label: 'Level',
					default: 'AMBER',
					choices: [
						{ id: 'GREEN', label: 'Normal' },
						{ id: 'AMBER', label: 'Amber' },
						{ id: 'RED', label: 'Red' },
						{ id: 'OVER', label: 'Overtime' },
					],
				},
			],
			defaultStyle: { color: BLACK, bgcolor: combineRgb(255, 176, 0) },
			callback: (fb) => self.st.warn === fb.options.level,
		},
		warning_colors: {
			type: 'advanced',
			name: 'Color by warning level (traffic light)',
			description: 'Green / amber / red / flashing-free overtime colors, like the stage display',
			options: [
				{ type: 'colorpicker', label: 'Normal background', id: 'g', default: combineRgb(0, 120, 0) },
				{ type: 'colorpicker', label: 'Amber background', id: 'a', default: combineRgb(230, 150, 0) },
				{ type: 'colorpicker', label: 'Red background', id: 'r', default: combineRgb(200, 0, 0) },
				{ type: 'colorpicker', label: 'Overtime background', id: 'o', default: combineRgb(120, 0, 0) },
				{ type: 'checkbox', label: 'Only while running/paused', id: 'onlyActive', default: true },
			],
			callback: (fb) => {
				if (fb.options.onlyActive && self.st.state === 'STOPPED') return {}
				const map = { GREEN: fb.options.g, AMBER: fb.options.a, RED: fb.options.r, OVER: fb.options.o }
				const bg = map[self.st.warn]
				return bg === undefined ? {} : { bgcolor: bg, color: WHITE }
			},
		},
		speaker_live: {
			type: 'boolean',
			name: 'Speaker is current',
			description: 'True when this speaker is loaded (on the clock)',
			options: [{ type: 'number', id: 'n', label: 'Speaker number', default: 1, min: 1, max: 200 }],
			defaultStyle: { color: WHITE, bgcolor: combineRgb(0, 120, 0) },
			callback: (fb) => self.st.speakerNumber === fb.options.n,
		},
		speaker_done: {
			type: 'boolean',
			name: 'Speaker has been started (✓)',
			options: [{ type: 'number', id: 'n', label: 'Speaker number', default: 1, min: 1, max: 200 }],
			defaultStyle: { color: combineRgb(150, 150, 150), bgcolor: combineRgb(25, 25, 25) },
			callback: (fb) => !!self.st.speakers[fb.options.n - 1]?.done,
		},
		speaker_next: {
			type: 'boolean',
			name: 'Speaker is next',
			options: [{ type: 'number', id: 'n', label: 'Speaker number', default: 1, min: 1, max: 200 }],
			defaultStyle: { color: WHITE, bgcolor: combineRgb(40, 60, 110) },
			callback: (fb) => self.st.nextSpeakerNumber === fb.options.n,
		},
		countdown_to_time: {
			type: 'boolean',
			name: 'Counting down to a time of day',
			options: [],
			defaultStyle: { color: WHITE, bgcolor: combineRgb(47, 124, 246) },
			callback: () => !!self.st.target,
		},
		overtime: {
			type: 'boolean',
			name: 'Timer is in overtime',
			options: [],
			defaultStyle: { color: WHITE, bgcolor: combineRgb(200, 0, 0) },
			callback: () => !!self.st.overtime,
		},
	}
}
