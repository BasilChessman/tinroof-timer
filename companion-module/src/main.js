import { InstanceBase, InstanceStatus, TCPHelper, Regex, runEntrypoint } from '@companion-module/base'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { getPresets } from './presets.js'
import { getVariables, getSpeakerSlotVariables } from './variables.js'
import { emptyState, parseState, parseSpeakers, variableValues, speakerSlotValues } from './parse.js'

const MIN_SPEAKER_SLOTS = 20

class TinRoofTimerInstance extends InstanceBase {
	st = emptyState()
	pending = [] // commands sent and not yet answered (replies come back in order)
	speakerSlots = MIN_SPEAKER_SLOTS

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'Controls <b>TinRoof Timer</b> over TCP. Needs TinRoof Timer 1.5.0 or later.',
			},
			{ type: 'textinput', id: 'host', label: 'Target IP', width: 6, default: '127.0.0.1', regex: Regex.IP },
			{ type: 'number', id: 'port', label: 'TCP port', width: 3, default: 61002, min: 1, max: 65535 },
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
		this.pending = []
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
			this.pending = []
			this.raw('VERSION')
			this.raw('UPDATES ON')
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
		const st = parseState(line)
		if (st) {
			Object.assign(this.st, st)
			this.publish(true)
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
		// anything else is the reply to the oldest command we sent
		const cmd = this.pending.shift() ?? '?'
		if (line === 'ERROR') this.log('warn', `TinRoof Timer didn't understand "${cmd}"`)
		else if (line === 'IGNORED') this.log('info', `TinRoof Timer ignored "${cmd}" (doesn't apply right now)`)
		else if (line.startsWith('VERSION ')) this.log('info', `Connected to TinRoof Timer ${line.slice(8)}`)
		else if (line !== 'OK') this.log('debug', `${cmd}: ${line}`)
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
		this.pending.push(cmd)
		this.socket.send(cmd + '\r\n').catch((e) => this.log('debug', `send failed: ${e.message}`))
	}

	async send(cmd) {
		if (!this.socket?.isConnected) {
			this.log('warn', `Not connected, can't send ${cmd}`)
			return
		}
		this.log('debug', `sending ${cmd}`)
		this.pending.push(cmd)
		await this.socket.send(cmd + '\r\n')
	}
}

runEntrypoint(TinRoofTimerInstance, [])
