import { InstanceBase, InstanceStatus, TCPHelper, Regex, runEntrypoint } from '@companion-module/base'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { getPresets } from './presets.js'
import { getVariables, getSpeakerSlotVariables } from './variables.js'
import { emptyState, parseUpdate, parseSpeakers, variableValues, speakerSlotValues } from './parse.js'

const MIN_SPEAKER_SLOTS = 20

class TinRoofTimerInstance extends InstanceBase {
	st = emptyState()
	isTinRoofTimer = false
	speakerSlots = MIN_SPEAKER_SLOTS

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value:
					'Controls <b>TinRoof Timer</b> over TCP. Also works with Irisdown Countdown Timer 2.0 (with fewer variables).',
			},
			{ type: 'textinput', id: 'host', label: 'Target IP', width: 6, default: '127.0.0.1', regex: Regex.IP },
			{ type: 'number', id: 'port', label: 'TCP port', width: 3, default: 61002, min: 1, max: 65535 },
			{
				type: 'number',
				id: 'amber',
				label: 'Amber warning (seconds) — only used with Irisdown',
				width: 6,
				default: 120,
				min: 0,
				max: 36000,
			},
			{
				type: 'number',
				id: 'red',
				label: 'Red warning (seconds) — only used with Irisdown',
				width: 6,
				default: 60,
				min: 0,
				max: 36000,
			},
		]
	}

	async init(config) {
		this.config = config
		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.defineVariables()
		this.setPresetDefinitions(getPresets(MIN_SPEAKER_SLOTS))
		this.publish(false)
		this.setVariableValues(speakerSlotValues([], this.speakerSlots))
		this.connect()
	}

	async configUpdated(config) {
		this.config = config
		this.connect()
	}

	async destroy() {
		this.socket?.destroy()
		delete this.socket
	}

	connect() {
		this.socket?.destroy()
		delete this.socket
		this.st = emptyState()
		this.isTinRoofTimer = false
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		const sock = new TCPHelper(this.config.host, this.config.port || 61002, { reconnect: true })
		this.socket = sock
		let buf = ''
		sock.on('status_change', (status, message) => this.updateStatus(status, message))
		sock.on('error', (err) => this.log('debug', `Network error: ${err.message}`))
		sock.on('connect', () => {
			buf = ''
			this.isTinRoofTimer = false
			// APPVERSION identifies TinRoof Timer (Irisdown answers ERROR) -> choose update mode
			this.raw('APPVERSION')
			this.raw('VERSION')
		})
		sock.on('end', () => this.publish(false))
		sock.on('data', (chunk) => {
			buf += chunk.toString('utf8')
			const lines = buf.split(/\r\n|\r|\n/)
			buf = lines.pop()
			for (const l of lines) this.onLine(l)
		})
	}

	onLine(line) {
		if (!line) return
		if (line.startsWith('APPVERSION ')) {
			this.isTinRoofTimer = true
			this.log('info', `Connected to TinRoof Timer ${line.slice(11)}`)
			return
		}
		if (line.startsWith('VERSION ')) {
			if (!this.isTinRoofTimer) this.log('info', `Connected to Irisdown-compatible timer ${line.slice(8)}`)
			this.raw(`UPDATEMODE ${this.isTinRoofTimer ? 3 : 2}`)
			this.raw('UPDATES ON')
			return
		}
		const list = parseSpeakers(line)
		if (list) {
			this.st.speakers = list
			const slots = Math.max(MIN_SPEAKER_SLOTS, list.length)
			if (slots !== this.speakerSlots) {
				this.speakerSlots = slots
				this.defineVariables()
			}
			this.setVariableValues(speakerSlotValues(list, this.speakerSlots))
			this.publish(true)
			return
		}
		const u = parseUpdate(line)
		if (!u) return
		Object.assign(this.st, u)
		if (!this.st.extended) {
			const s = this.st.seconds
			this.st.warn =
				this.st.sign === '-' ? 'OVER' : s <= (this.config.red ?? 60) ? 'RED' : s <= (this.config.amber ?? 120) ? 'AMBER' : 'GREEN'
		}
		this.publish(true)
	}

	defineVariables() {
		this.setVariableDefinitions([...getVariables(), ...getSpeakerSlotVariables(this.speakerSlots)])
	}

	publish(connected) {
		this.setVariableValues(variableValues(this.st, connected))
		this.checkFeedbacks()
	}

	raw(cmd) {
		if (!this.socket?.isConnected) return
		this.socket.send(cmd + '\r\n').catch((e) => this.log('debug', `send failed: ${e.message}`))
	}

	async send(cmd) {
		if (!this.socket?.isConnected) {
			this.log('warn', `Not connected, can't send ${cmd}`)
			return
		}
		this.log('debug', `sending ${cmd}`)
		await this.socket.send(cmd + '\r\n')
	}
}

runEntrypoint(TinRoofTimerInstance, [])
