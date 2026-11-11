'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { TimerEngine, parseDuration } = require('../src/main/timer')
const { handleCommand, modeLine, splitLines, remoteDisplayPacket, hivePacket } = require('../src/main/protocol')
const { buildView, stageView } = require('../src/main/view')
const { DEFAULTS } = require('../src/main/settings')

function rig() {
	let t = 1_000_000
	const clock = { now: () => t, advance: (ms) => (t += ms) }
	const engine = new TimerEngine({ now: clock.now })
	const session = { updates: false, updateMode: 1 }
	const presets = { 3: 180 }
	const ctx = {
		engine,
		appVersion: '1.0.0',
		loadPreset: (n) => (presets[n] ? engine.reset(presets[n] * 1000) : false),
	}
	const cmd = (line) => handleCommand(line, session, ctx).reply
	return { clock, engine, session, cmd }
}

test('parseDuration matches Irisdown RESET syntax', () => {
	assert.equal(parseDuration('25'), 25 * 60000)
	assert.equal(parseDuration('01:30'), 90 * 60000)
	assert.equal(parseDuration('00:05:30'), 330000)
	assert.equal(parseDuration('99:59:59'), (99 * 3600 + 59 * 60 + 59) * 1000)
	assert.equal(parseDuration('00:60:00'), null)
	assert.equal(parseDuration('1:5'), null)
	assert.equal(parseDuration('abc'), null)
	assert.equal(parseDuration('6000'), null) // > 99:59:59
})

test('GO / PAUSE / TOGGLEPAUSE replies follow Irisdown context rules', () => {
	const { cmd, engine } = rig()
	assert.equal(cmd('PAUSE'), 'IGNORED') // pausing a stopped timer
	assert.equal(cmd('GO'), 'OK')
	assert.equal(cmd('GO'), 'IGNORED')
	assert.equal(cmd('pause'), 'OK') // case-insensitive
	assert.equal(engine.state, 'PAUSED')
	assert.equal(cmd('TOGGLEPAUSE'), 'OK')
	assert.equal(engine.state, 'PLAYING')
	assert.equal(cmd('TOGGLEPAUSE'), 'OK')
	assert.equal(engine.state, 'PAUSED')
	assert.equal(cmd('RESET'), 'OK')
	assert.equal(cmd('PLAY'), 'OK') // undocumented alias
})

test('RESET <time>, REMAINING, STATE', () => {
	const { cmd, clock } = rig()
	assert.equal(cmd('RESET 00:10:00'), 'OK')
	assert.equal(cmd('REMAINING'), '600')
	assert.equal(cmd('STATE'), 'STOPPED')
	cmd('GO')
	clock.advance(1500)
	assert.equal(cmd('REMAINING'), '599') // ceil(598.5)
	assert.equal(cmd('STATE'), 'PLAYING')
	assert.equal(cmd('RESET 61:00:00'), 'OK')
	assert.equal(cmd('RESET 00:99:00'), 'ERROR')
	assert.equal(cmd('RESET x'), 'ERROR')
	assert.equal(cmd('RESET 5'), 'OK')
	assert.equal(cmd('REMAINING'), '300')
})

test('JOG adjusts while running; refuses results <= 0 and out-of-range minutes', () => {
	const { cmd, clock } = rig()
	cmd('RESET 2')
	cmd('GO')
	clock.advance(30000)
	assert.equal(cmd('JOG 5'), 'OK')
	assert.equal(cmd('REMAINING'), String(90 + 300))
	assert.equal(cmd('JOG -10'), 'IGNORED') // would go below zero
	assert.equal(cmd('JOG -1'), 'OK')
	assert.equal(cmd('JOG 61'), 'ERROR')
	assert.equal(cmd('JOG'), 'ERROR')
	assert.equal(cmd('JOGSEC 15'), 'OK')
	assert.equal(cmd('REMAINING'), String(90 + 240 + 15))
})

test('DISPLAY modes', () => {
	const { cmd, engine } = rig()
	for (const m of ['CLOCK', 'BLACK', 'TEST', 'TIMER']) {
		assert.equal(cmd(`DISPLAY ${m.toLowerCase()}`), 'OK')
		assert.equal(engine.mode, m)
	}
	assert.equal(cmd('DISPLAY FOO'), 'ERROR')
})

test('MESSAGE strips one pair of quotes, CLEAR works, 90-char limit', () => {
	const { cmd, engine } = rig()
	assert.equal(cmd('MESSAGE "Wrap up please"'), 'OK')
	assert.equal(engine.message, 'Wrap up please')
	assert.equal(cmd("MESSAGE 'single'"), 'OK')
	assert.equal(engine.message, 'single')
	assert.equal(cmd('MESSAGE no quotes here'), 'OK')
	assert.equal(engine.message, 'no quotes here')
	cmd('MESSAGE ' + 'x'.repeat(200))
	assert.equal(engine.message.length, 90)
	assert.equal(cmd('MESSAGE CLEAR'), 'OK')
	assert.equal(engine.message, '')
	assert.equal(cmd('MESSAGE'), 'ERROR')
})

test('VERSION satisfies the Companion module UPDATEMODE 2 check', () => {
	const { cmd } = rig()
	const reply = cmd('VERSION')
	const parts = reply.split(' ')
	assert.equal(parts.length, 2)
	assert.equal(parts[0], 'VERSION')
	// companion-module-irisdown-countdowntimer: compareVersion(v, '2.0.9.3') > 0
	const v = parts[1].split('.').map(Number)
	assert.ok(v[0] > 2 || (v[0] === 2 && (v[1] > 0 || v[2] > 9 || (v[2] === 9 && v[3] > 3))))
})

test('UPDATES suppresses other replies; mode 1 and mode 2 formats', () => {
	const { cmd, engine, session } = rig()
	cmd('RESET 00:10:00')
	assert.equal(cmd('UPDATEMODE 2'), 'OK')
	assert.equal(cmd('UPDATES ON'), null)
	assert.equal(cmd('GO'), null)
	assert.equal(engine.state, 'PLAYING')
	assert.equal(session.updates, true)
	engine.pause()
	const snap = engine.snapshot()
	assert.equal(modeLine(snap, 1), '00:10:00 PAUSED TIMER')
	assert.equal(modeLine(snap, 2), 'TIME=+00:10:00&STATE=PAUSED&DISPLAY=TIMER&MESSAGE=FALSE')
	cmd('UPDATES OFF')
	assert.equal(cmd('STATE'), 'PAUSED')
})

test('mode lines parse exactly like the Irisdown Companion module does', () => {
	const { engine, clock } = rig()
	engine.reset(5000)
	engine.go()
	clock.advance(65000) // 60 s overtime
	engine.setMessage('hi')
	const line2 = modeLine(engine.snapshot(), 2)
	assert.equal(line2, 'TIME=-00:01:00&STATE=PLAYING&DISPLAY=TIMER&MESSAGE=TRUE')
	// replicate the module's mode-2 parsing
	const info = line2.split(/ /)
	assert.ok(info[0].match('MESSAGE'))
	const f = info[0].split('&')
	assert.equal(f[0].slice(f[0].indexOf('=') + 2), '00:01:00')
	assert.equal(f[1].slice(f[1].indexOf('=') + 1), 'PLAYING')
	assert.equal(f[2].slice(f[2].indexOf('=') + 1), 'TIMER')
	assert.equal(f[3].slice(f[3].indexOf('=') + 1), 'TRUE')
	// mode 1 = 3 space-separated tokens
	assert.equal(modeLine(engine.snapshot(), 1).split(/ /).length, 3)
})

test('mode 3 extension keeps the mode 2 prefix', () => {
	const { engine } = rig()
	const l3 = modeLine(engine.snapshot(), 3, { warn: 'GREEN' })
	assert.ok(l3.startsWith('TIME=+00:05:00&STATE=STOPPED&DISPLAY=TIMER&MESSAGE=FALSE&SECONDS=300'))
	assert.match(l3, /&WARN=GREEN/)
})

test('PRESET extension', () => {
	const { cmd, engine } = rig()
	assert.equal(cmd('PRESET 3'), 'OK')
	assert.equal(engine.duration, 180000)
	assert.equal(cmd('PRESET 4'), 'IGNORED')
	assert.equal(cmd('PRESET 0'), 'ERROR')
})

test('splitLines accepts \\r, \\n and \\r\\n', () => {
	assert.deepEqual(splitLines('GO\rPAUSE\nRESET\r\nVER'), [['GO', 'PAUSE', 'RESET'], 'VER'])
})

test('UDP remote-display packet is 20 chars in the IDCT format', () => {
	const { engine, clock } = rig()
	engine.reset(125000)
	let p = remoteDisplayPacket(engine.snapshot(), 10)
	assert.equal(p, 'IDCT:+000125AG0-----')
	assert.equal(p.length, 20)
	engine.go()
	clock.advance(135000)
	p = remoteDisplayPacket(engine.snapshot(), 0)
	assert.equal(p, 'IDCT:-0000100G0-----')
})

test('Hive packet is BCD mm, ss, flags', () => {
	const { engine } = rig()
	engine.reset((12 * 60 + 34) * 1000)
	assert.deepEqual([...hivePacket(engine.snapshot(), 'GREEN')], [0x12, 0x34, 1])
	assert.deepEqual([...hivePacket(engine.snapshot(), 'AMBER')], [0x12, 0x34, 3])
})

test('stop at zero, stopwatch and overtime', () => {
	let t = 0
	const e = new TimerEngine({ now: () => t, stopAtZero: true })
	e.reset(3000)
	e.go()
	t += 5000
	assert.equal(e.snapshot().seconds, 0)
	assert.equal(e.state, 'STOPPED')
	e.go() // restarts from last duration
	assert.equal(e.snapshot().seconds, 3)

	const w = new TimerEngine({ now: () => t })
	w.reset(0)
	w.go()
	t += 61500
	const s = w.snapshot()
	assert.equal(s.stopwatch, true)
	assert.equal(s.time, '00:01:01')
	assert.equal(s.overtime, false)
})

test('view warning levels and formatting', () => {
	let t = 0
	const e = new TimerEngine({ now: () => t })
	const s = { ...DEFAULTS }
	e.reset(600000)
	assert.equal(buildView(e.snapshot(), s).warn, 'GREEN')
	assert.equal(buildView(e.snapshot(), s).timerText, '10:00')
	e.go()
	t += 600000 - 100000
	assert.equal(buildView(e.snapshot(), s).warn, 'AMBER')
	t += 50000
	assert.equal(buildView(e.snapshot(), s).warn, 'RED')
	t += 60000
	const v = buildView(e.snapshot(), s)
	assert.equal(v.warn, 'OVER')
	assert.equal(v.timerText, '-00:10')
	assert.equal(buildView(e.snapshot(), { ...s, alwaysShowHours: true, overtimeSign: '+' }).timerText, '+00:00:10')
})

test('hold at zero: stage shows 00:00, engine keeps counting overtime', () => {
	let t = 0
	const e = new TimerEngine({ now: () => t })
	const s = { ...DEFAULTS, atZero: 'hold' }
	e.reset(3000)
	e.go()
	t += 13000
	const v = buildView(e.snapshot(), s)
	assert.equal(e.state, 'PLAYING')
	assert.equal(v.seconds, -10) // real overtime for the control window / Companion
	assert.equal(v.overtime, true)
	assert.equal(v.timerText, '-00:10')
	assert.equal(v.held, true)
	assert.equal(v.stageText, '00:00')
	assert.equal(v.stageOvertime, false)
	assert.equal(remoteDisplayPacket(stageView(v)), 'IDCT:+0000000G0-----')
	// before zero, and in the other modes, nothing is held
	assert.equal(buildView(e.snapshot(), { ...s, atZero: 'count' }).stageText, '-00:10')
	e.reset(3000)
	assert.equal(buildView(e.snapshot(), s).stageText, '00:03')
})
