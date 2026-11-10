'use strict'
const net = require('node:net')
const dgram = require('node:dgram')
const http = require('node:http')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { handleCommand, modeLine, speakersLine, splitLines, remoteDisplayPacket, hivePacket } = require('./protocol')

const RENDERER_DIR = path.join(__dirname, '..', 'renderer')
const STATIC = {
	'/display.js': ['display.js', 'text/javascript; charset=utf-8'],
	'/display.css': ['display.css', 'text/css; charset=utf-8'],
	'/web.js': ['web.js', 'text/javascript; charset=utf-8'],
}

function ipv4Interfaces() {
	const out = []
	for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
		for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask })
	}
	return out
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

class NetworkServices {
	/**
	 * @param {object} o
	 * @param {import('./timer').TimerEngine} o.engine
	 * @param {() => object} o.getSettings
	 * @param {() => object} o.getView  current view (engine snapshot + formatting)
	 * @param {(n:number)=>boolean} o.loadPreset
	 * @param {string} o.appVersion
	 * @param {(msg:string)=>void} o.log
	 */
	constructor(o) {
		Object.assign(this, o)
		this.clients = new Set()
		this.sseClients = new Set()
		this.udpSockets = []
		this.status = { tcp: 'stopped', web: 'stopped', udp: 'stopped', ssdp: 'stopped' }
		this.uuid = null
	}

	start() {
		const s = this.getSettings()
		this.startTcp(s.tcpPort)
		this.startHttp(s.webPort)
		this.startUdp()
		if (s.ssdp) this.startSsdp(s.webPort)
		this.tickTimer = setInterval(() => this.tick(), 100)
	}

	stop() {
		clearInterval(this.tickTimer)
		for (const c of this.clients) c.socket.destroy()
		this.clients.clear()
		for (const r of this.sseClients) r.end()
		this.sseClients.clear()
		this.tcpServer?.close()
		this.httpServer?.close()
		for (const u of this.udpSockets) u.close()
		this.udpSockets = []
		this.stopSsdp()
	}

	restart() {
		this.stop()
		this.start()
	}

	info() {
		const s = this.getSettings()
		return {
			addresses: ipv4Interfaces().map((i) => i.address),
			tcpPort: s.tcpPort,
			webPort: s.webPort,
			tcpClients: this.clients.size,
			webClients: this.sseClients.size,
			status: { ...this.status },
		}
	}

	// ---------------------------------------------------------------- TCP
	startTcp(port) {
		this.tcpServer = net.createServer((socket) => {
			socket.setNoDelay(true)
			const client = { socket, session: { updates: false, updateMode: 1, lastLine: null }, buf: '' }
			this.clients.add(client)
			this.log?.(`TCP client connected: ${socket.remoteAddress}`)
			this.onClientsChanged?.()
			socket.setEncoding('utf8')
			socket.on('data', (chunk) => {
				client.buf += chunk
				if (client.buf.length > 65536) client.buf = '' // garbage protection
				const [lines, rest] = splitLines(client.buf)
				client.buf = rest
				for (const line of lines) this.runLine(client, line)
			})
			const drop = () => {
				if (this.clients.delete(client)) {
					this.log?.(`TCP client disconnected: ${socket.remoteAddress}`)
					this.onClientsChanged?.()
				}
			}
			socket.on('close', drop)
			socket.on('error', drop)
		})
		this.tcpServer.on('error', (e) => {
			this.status.tcp = `error: ${e.code || e.message}`
			this.log?.(`Network command server could not start on port ${port}: ${e.message}`)
		})
		this.tcpServer.listen(port, () => {
			this.status.tcp = `listening :${port}`
		})
	}

	runLine(client, line) {
		const { reply, sendUpdate } = handleCommand(line, client.session, this.ctx())
		if (reply != null) this.write(client, reply)
		if (sendUpdate) this.sendUpdate(client, true)
	}

	ctx() {
		return {
			engine: this.engine,
			appVersion: this.appVersion,
			loadPreset: this.loadPreset,
			speaker: this.speaker,
		}
	}

	write(client, text) {
		if (!client.socket.destroyed) client.socket.write(text + '\r\n')
	}

	sendUpdate(client, force = false, view = this.getView(), spLine = null) {
		const ses = client.session
		if (ses.updateMode === 3) {
			const sl = spLine ?? this.speakersLine()
			if (force || sl !== ses.lastSpeakers) {
				ses.lastSpeakers = sl
				this.write(client, sl)
			}
		}
		const line = modeLine(view, ses.updateMode, { warn: view.warn })
		if (force || line !== ses.lastLine) {
			ses.lastLine = line
			this.write(client, line)
		}
	}

	speakersLine() {
		const s = this.getSettings()
		return speakersLine(s.speakers || [], s.speakersDone || [])
	}

	/** Run a command from the HTTP API (stateless session). */
	httpCommand(text) {
		const session = { updates: false, updateMode: 2 }
		return handleCommand(text, session, this.ctx()).reply ?? 'OK'
	}

	// ---------------------------------------------------------------- tick
	tick() {
		const view = this.getView()
		let sl = null
		for (const c of this.clients) {
			if (!c.session.updates) continue
			if (c.session.updateMode === 3 && sl == null) sl = this.speakersLine()
			this.sendUpdate(c, false, view, sl)
		}
		this.broadcastUdp(view)
		if (this.sseClients.size) {
			const payload = `data: ${JSON.stringify(this.webPayload(view))}\n\n`
			for (const res of this.sseClients) res.write(payload)
		}
	}

	webPayload(view) {
		return { view, settings: this.publicSettings() }
	}

	publicSettings() {
		const s = this.getSettings()
		const { sounds, presets, ...rest } = s
		return rest
	}

	// ---------------------------------------------------------------- UDP
	startUdp() {
		const ifaces = ipv4Interfaces()
		const binds = ifaces.length ? ifaces.map((i) => i.address) : ['0.0.0.0']
		for (const address of binds) {
			const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
			sock.on('error', () => {
				sock.close()
				this.udpSockets = this.udpSockets.filter((x) => x !== sock)
			})
			sock.bind({ address, port: 0 }, () => {
				try {
					sock.setBroadcast(true)
				} catch {}
			})
			this.udpSockets.push(sock)
		}
		this.status.udp = `broadcasting on ${binds.length} interface(s)`
	}

	broadcastUdp(view) {
		const s = this.getSettings()
		if (!this.udpSockets.length) return
		const msgs = []
		if (s.udpBroadcast) msgs.push([Buffer.from(remoteDisplayPacket(view, s.udpId), 'ascii'), 61003])
		if (s.hiveBroadcast) msgs.push([hivePacket(view, view.warn), 36700])
		for (const sock of this.udpSockets) {
			for (const [buf, port] of msgs) {
				try {
					sock.send(buf, port, '255.255.255.255', () => {})
				} catch {}
			}
		}
	}

	// ---------------------------------------------------------------- HTTP
	startHttp(port) {
		this.httpServer = http.createServer((req, res) => this.handleHttp(req, res))
		this.httpServer.on('error', (e) => {
			this.status.web = `error: ${e.code || e.message}`
			this.log?.(`Web server could not start on port ${port}: ${e.message}`)
		})
		this.httpServer.listen(port, () => {
			this.status.web = `listening :${port}`
		})
	}

	handleHttp(req, res) {
		const url = new URL(req.url, 'http://x')
		const p = url.pathname
		const send = (code, type, body, extra = {}) => {
			res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra })
			res.end(body)
		}
		try {
			if (p === '/' || p === '/index.html') {
				return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(RENDERER_DIR, 'web.html')))
			}
			if (STATIC[p]) {
				const [file, type] = STATIC[p]
				return send(200, type, fs.readFileSync(path.join(RENDERER_DIR, file)))
			}
			if (p === '/timer.txt') {
				// Irisdown-compatible fragment: <span style="color:#RRGGBB;">text</span>
				const v = this.getView()
				let text = v.timerText
				let color = v.color
				if (v.mode === 'CLOCK') {
					text = v.clockText
					color = this.getSettings().colorWhite
				} else if (v.mode === 'BLACK' || v.mode === 'TEST') text = ''
				return send(200, 'text/html; charset=utf-8', `<span style="color:#${color.replace('#', '')};">${escapeHtml(text)}</span>`)
			}
			if (p === '/api/state') {
				return send(200, 'application/json', JSON.stringify(this.getView()))
			}
			if (p === '/api/command') {
				const run = (cmd) => send(200, 'text/plain; charset=utf-8', this.httpCommand(cmd || ''))
				if (req.method === 'POST') {
					let body = ''
					req.on('data', (d) => {
						body += d
						if (body.length > 4096) req.destroy()
					})
					req.on('end', () => run(url.searchParams.get('cmd') || body.trim()))
					return
				}
				return run(url.searchParams.get('cmd'))
			}
			if (p === '/events') {
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-store',
					Connection: 'keep-alive',
					'Access-Control-Allow-Origin': '*',
				})
				res.write(`data: ${JSON.stringify(this.webPayload(this.getView()))}\n\n`)
				this.sseClients.add(res)
				req.on('close', () => this.sseClients.delete(res))
				return
			}
			if (p === '/description.xml') {
				return send(200, 'text/xml; charset=utf-8', this.ssdpDescription(req.socket.localAddress))
			}
			send(404, 'text/plain', 'Not found')
		} catch (e) {
			send(500, 'text/plain', 'Error: ' + e.message)
		}
	}

	// ---------------------------------------------------------------- SSDP / UPnP
	// Advertises the web view so it appears in Windows "Network" (like Irisdown).
	deviceUuid() {
		if (!this.uuid) {
			const h = crypto.createHash('sha1').update('tinroof-timer:' + os.hostname()).digest('hex')
			this.uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
		}
		return this.uuid
	}

	ssdpDescription(localAddress) {
		const host = String(localAddress || '').replace(/^::ffff:/, '')
		const port = this.getSettings().webPort
		return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
    <friendlyName>TinRoof Timer (${escapeHtml(os.hostname())})</friendlyName>
    <manufacturer>TinRoof Timer</manufacturer>
    <modelName>TinRoof Timer</modelName>
    <modelNumber>${escapeHtml(this.appVersion)}</modelNumber>
    <UDN>uuid:${this.deviceUuid()}</UDN>
    <presentationURL>http://${host}:${port}/</presentationURL>
  </device>
</root>`
	}

	startSsdp(webPort) {
		const MCAST = '239.255.255.250'
		const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		this.ssdpSock = sock
		const usn = `uuid:${this.deviceUuid()}`
		const types = ['upnp:rootdevice', usn, 'urn:schemas-upnp-org:device:Basic:1']
		const location = (addr) => `http://${addr}:${webPort}/description.xml`
		const pickAddr = (remote) => {
			const ifs = ipv4Interfaces()
			// choose the interface on the same subnet as the requester
			const toInt = (ip) => ip.split('.').reduce((a, b) => (a << 8) + +b, 0) >>> 0
			for (const i of ifs) if (((toInt(i.address) ^ toInt(remote)) & toInt(i.netmask)) === 0) return i.address
			return ifs[0]?.address || '127.0.0.1'
		}
		sock.on('error', (e) => {
			this.status.ssdp = `error: ${e.code || e.message}`
		})
		sock.on('message', (msg, rinfo) => {
			const text = msg.toString()
			if (!text.startsWith('M-SEARCH')) return
			const st = (/^ST:\s*(.+)$/im.exec(text) || [])[1]?.trim()
			if (!st) return
			const matches = st === 'ssdp:all' ? types : types.filter((t) => t === st)
			for (const t of matches) {
				const resp =
					'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nEXT:\r\n' +
					`LOCATION: ${location(pickAddr(rinfo.address))}\r\nSERVER: Node/${process.versions.node} UPnP/1.0 TinRoofTimer/${this.appVersion}\r\n` +
					`ST: ${t}\r\nUSN: ${t === usn ? usn : `${usn}::${t}`}\r\n\r\n`
				sock.send(resp, rinfo.port, rinfo.address)
			}
		})
		const notify = () => {
			for (const i of ipv4Interfaces()) {
				for (const t of types) {
					const m =
						`NOTIFY * HTTP/1.1\r\nHOST: ${MCAST}:1900\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: ${location(i.address)}\r\n` +
						`NT: ${t}\r\nNTS: ssdp:alive\r\nSERVER: Node/${process.versions.node} UPnP/1.0 TinRoofTimer/${this.appVersion}\r\n` +
						`USN: ${t === usn ? usn : `${usn}::${t}`}\r\n\r\n`
					try {
						sock.setMulticastInterface(i.address)
						sock.send(m, 1900, MCAST)
					} catch {}
				}
			}
		}
		sock.bind(1900, () => {
			for (const i of ipv4Interfaces()) {
				try {
					sock.addMembership(MCAST, i.address)
				} catch {}
			}
			this.status.ssdp = 'advertising'
			notify()
			this.ssdpTimer = setInterval(notify, 60000)
		})
	}

	stopSsdp() {
		clearInterval(this.ssdpTimer)
		try {
			this.ssdpSock?.close()
		} catch {}
		this.ssdpSock = null
		this.status.ssdp = 'stopped'
	}
}

module.exports = { NetworkServices, ipv4Interfaces }
