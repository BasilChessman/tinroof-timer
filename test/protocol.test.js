'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { TimerEngine, parseDuration } = require('../src/main/timer')
const { handleCommand, stateLine, stateJson, splitLines, remoteDisplayPacket } = require('../src/main/protocol')
const { buildView, stageView } = require('../src/main/view')
const { DEFAULTS } = require('../src/main/settings')

function rig() {
	let t = 1_000_000
	const clock = { now: () => t, advance: (ms) => (t += ms) }
	const engine = new TimerEngine({ now: clock.now })
	const session = { updates: false }
	const presets = { 3: 180 }
	const ctx = {
		engine,
		appVersion: '1.0.0',
		loadPreset: (n) => (presets[n] ? engine.reset(presets[n] * 1000) : false),
	}
	const cmd = (line) => handleCommand(line, session, ctx).reply
	return { clock, engine, session, cmd }
}

test('parseDuration accepts minutes, hh:mm and hh:mm:ss', () => {
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
	assert.equal(cmd('PLAY'), 'ERROR') // Irisdown's alias is gone
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

test('VERSION and APPVERSION report the app version', () => {
	const { cmd } = rig()
	assert.equal(cmd('VERSION'), 'VERSION 1.0.0')
	assert.equal(cmd('APPVERSION'), 'APPVERSION 1.0.0')
	assert.equal(cmd('UPDATEMODE 2'), 'ERROR') // Irisdown update modes are gone
})

test('replies keep coming while UPDATES is on', () => {
	const { cmd, engine, session } = rig()
	cmd('RESET 00:10:00')
	const r = handleCommand('UPDATES ON', session, { engine })
	assert.deepEqual(r, { reply: 'OK', sendUpdate: true })
	assert.equal(cmd('GO'), 'OK')
	assert.equal(cmd('GO'), 'IGNORED')
	assert.equal(cmd('STATE'), 'PLAYING')
	assert.equal(cmd('UPDATES OFF'), 'OK')
	assert.equal(session.updates, false)
})

test('STATE line is one line of JSON with the real (signed) time', () => {
	const { engine, clock } = rig()
	engine.reset(5000)
	engine.go()
	clock.advance(65000) // 60 s overtime
	engine.setMessage('Wrap up & go')
	const v = buildView(engine.snapshot(), { ...DEFAULTS, atZero: 'hold' })
	const line = stateLine({ ...v, speakerName: 'Ada', speakerNumber: 2, nextSpeakerName: 'Bob', nextSpeakerNumber: 3 })
	assert.ok(line.startsWith('STATE {'))
	assert.ok(!/[\r\n]/.test(line))
	const j = JSON.parse(line.slice(6))
	assert.deepEqual(
		{ state: j.state, mode: j.mode, time: j.time, overtime: j.overtime, seconds: j.seconds, warn: j.warn, progress: j.progress, message: j.message },
		{ state: 'PLAYING', mode: 'TIMER', time: '00:01:00', overtime: true, seconds: -60, warn: 'OVER', progress: 100, message: 'Wrap up & go' },
	)
	assert.deepEqual([j.speaker, j.speakerNumber, j.nextSpeaker, j.nextSpeakerNumber], ['Ada', 2, 'Bob', 3])
	assert.equal(stateJson(buildView(new TimerEngine().snapshot(), DEFAULTS)).end, '') // stopped: no end time
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

test('UDP remote-display packet follows the display colour and flash', () => {
	const { engine, clock } = rig()
	const s = { ...DEFAULTS }
	const pkt = (id, set = s) => remoteDisplayPacket(buildView(engine.snapshot(), set), id, set)
	engine.reset(600000)
	let p = pkt(10)
	assert.equal(p, 'IDCT:+000600AG0-----')
	assert.equal(p.length, 20)
	engine.go()
	clock.advance(500000) // 100 s left: amber
	assert.equal(pkt(0), 'IDCT:+0001000A0-----')
	clock.advance(50000) // 50 s left: red
	assert.equal(pkt(0), 'IDCT:+0000500R0-----')
	clock.advance(60000) // 10 s over: red, flashing
	assert.equal(pkt(0), 'IDCT:-0000100R1-----')
	assert.equal(pkt(0, { ...s, flashOvertime: false }), 'IDCT:-0000100R0-----')
	assert.equal(pkt(0, { ...s, whiteOnly: true }), 'IDCT:-0000100W1-----')
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
	assert.equal(stageView(v).seconds, 0)
	assert.equal(remoteDisplayPacket(v, 0, s), 'IDCT:+0000000R1-----') // held at zero, still flashing
	// before zero, and in the other modes, nothing is held
	assert.equal(buildView(e.snapshot(), { ...s, atZero: 'count' }).stageText, '-00:10')
	e.reset(3000)
	assert.equal(buildView(e.snapshot(), s).stageText, '00:03')
})
