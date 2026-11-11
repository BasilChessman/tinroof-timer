'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { TimerEngine, parseTimeOfDay } = require('../src/main/timer')
const { handleCommand, modeLine, speakersLine } = require('../src/main/protocol')
const { parseCsv, toCsv, parseSpeakerTime, normalizeList } = require('../src/main/speakers')

const at = (h, m, s = 0) => new Date(2026, 10, 10, h, m, s).getTime()

test('parseTimeOfDay: today, tomorrow, am/pm, invalid', () => {
	const now = at(9, 0)
	assert.equal(parseTimeOfDay('10:30', now), at(10, 30))
	assert.equal(parseTimeOfDay('10:30:15', now), at(10, 30, 15))
	assert.equal(parseTimeOfDay('2:30pm', now), at(14, 30))
	assert.equal(parseTimeOfDay('12:00 AM', now), at(0, 0) + 86400000) // midnight -> tomorrow
	assert.equal(parseTimeOfDay('08:00', now), at(8, 0) + 86400000) // already passed -> tomorrow
	assert.equal(parseTimeOfDay('24:00', now), null)
	assert.equal(parseTimeOfDay('10:61', now), null)
	assert.equal(parseTimeOfDay('soon', now), null)
})

test('time-of-day countdown follows the clock; pause freezes; resume re-syncs', () => {
	let t = at(9, 0)
	const e = new TimerEngine({ now: () => t })
	assert.ok(e.setTarget(at(9, 10)))
	assert.equal(e.snapshot().seconds, 600)
	t += 60000 // stopped but armed: still shows live time to the end time
	assert.equal(e.snapshot().seconds, 540)
	e.go()
	t += 60000
	assert.equal(e.snapshot().seconds, 480)
	assert.equal(e.endTime(), at(9, 10))
	e.pause()
	t += 120000
	assert.equal(e.snapshot().seconds, 480) // frozen while paused
	e.go()
	assert.equal(e.snapshot().seconds, 360) // back in sync with the clock
	assert.ok(e.jog(60000)) // jog moves the end time
	assert.equal(e.target, at(9, 11))
	assert.equal(e.snapshot().seconds, 420)
	t = at(9, 11, 30)
	const s = e.snapshot()
	assert.equal(s.overtime, true)
	assert.equal(s.seconds, -30)
	assert.ok(e.snapshot().elapsedSeconds > 0)
})

test('time-of-day with stop at zero; new duration leaves time-of-day mode', () => {
	let t = at(9, 0)
	const e = new TimerEngine({ now: () => t, stopAtZero: true })
	e.startTarget(at(9, 0, 5))
	t += 8000
	assert.equal(e.snapshot().seconds, 0)
	assert.equal(e.state, 'STOPPED')
	assert.equal(e.go(), false) // end time has passed
	e.reset(60000)
	assert.equal(e.target, null)
	assert.equal(e.snapshot().seconds, 60)
})

test('TARGET / TARGETSTART protocol commands and mode-3 fields', () => {
	let t = at(9, 0)
	const engine = new TimerEngine({ now: () => t })
	const session = { updates: false, updateMode: 1 }
	const cmd = (l) => handleCommand(l, session, { engine }).reply
	assert.equal(cmd('TARGET 09:30'), 'OK')
	assert.equal(engine.state, 'STOPPED')
	assert.equal(cmd('REMAINING'), '1800')
	assert.equal(cmd('TARGETSTART 10:00'), 'OK')
	assert.equal(engine.state, 'PLAYING')
	assert.equal(cmd('TARGET nonsense'), 'ERROR')
	const line = modeLine({ ...engine.snapshot(), speakerName: 'Ada & Co', speakerNumber: 2, nextSpeakerName: 'Bob', nextSpeakerNumber: 3 }, 3, { warn: 'GREEN' })
	assert.match(line, /&TARGET=10:00:00/)
	assert.match(line, /&SPEAKER=Ada%20%26%20Co&SPEAKERNUM=2&NEXTSPEAKER=Bob&NEXTSPEAKERNUM=3/)
	// mode 2 stays exactly Irisdown-shaped
	assert.equal(modeLine(engine.snapshot(), 2), 'TIME=+01:00:00&STATE=PLAYING&DISPLAY=TIMER&MESSAGE=FALSE')
})

test('SPEAKER / CUE protocol commands delegate to the app', () => {
	const engine = new TimerEngine()
	const calls = []
	const ctx = { engine, speaker: (sel, start) => (calls.push([sel, start]), sel !== 9) }
	const session = { updates: false, updateMode: 1 }
	const cmd = (l) => handleCommand(l, session, ctx).reply
	assert.equal(cmd('SPEAKER 2'), 'OK')
	assert.equal(cmd('CUE next'), 'OK')
	assert.equal(cmd('SPEAKER PREV'), 'OK')
	assert.equal(cmd('SPEAKER 9'), 'IGNORED')
	assert.equal(cmd('SPEAKER x'), 'ERROR')
	assert.deepEqual(calls, [[2, true], ['NEXT', false], ['PREV', true], [9, true]])
})

test('speaker time cells and CSV round trip', () => {
	assert.deepEqual(parseSpeakerTime('15'), { type: 'duration', seconds: 900, until: '' })
	assert.deepEqual(parseSpeakerTime('5:30'), { type: 'duration', seconds: 330, until: '' })
	assert.deepEqual(parseSpeakerTime('1:05:00'), { type: 'duration', seconds: 3900, until: '' })
	assert.deepEqual(parseSpeakerTime('@10:30'), { type: 'until', seconds: 0, until: '10:30' })
	assert.deepEqual(parseSpeakerTime('until 2:15pm'), { type: 'until', seconds: 0, until: '2:15pm' })
	assert.equal(parseSpeakerTime('abc'), null)

	const { speakers, errors } = parseCsv('Name,Time\r\nAlice Smith,10\n"Bob, Jr.",00:07:30\nKeynote;@10:45\nBad row,xx\n\n')
	assert.deepEqual(errors, [5])
	assert.deepEqual(speakers.map((s) => [s.name, s.type, s.seconds, s.until]), [
		['Alice Smith', 'duration', 600, ''],
		['Bob, Jr.', 'duration', 450, ''],
		['Keynote', 'until', 0, '10:45'],
	])
	const again = parseCsv(toCsv(speakers)).speakers
	assert.deepEqual(again.map((s) => [s.name, s.type, s.seconds, s.until]), speakers.map((s) => [s.name, s.type, s.seconds, s.until]))
})

test('speakersLine lists speakers with done flags', () => {
	const list = normalizeList([{ id: 'a', name: 'Alice', seconds: 600 }, { id: 'b', name: 'Bob', type: 'until', until: '10:30' }])
	const line = speakersLine(list, ['a'])
	assert.ok(line.startsWith('SPEAKERS='))
	assert.deepEqual(JSON.parse(decodeURIComponent(line.slice(9))), [
		{ n: 1, name: 'Alice', time: '00:10:00', done: true },
		{ n: 2, name: 'Bob', time: '@10:30', done: false },
	])
})

test('run records: actual time excludes pauses and includes overtime', () => {
	let t = at(9, 0)
	const e = new TimerEngine({ now: () => t })
	const runs = []
	e.on('run', (r) => runs.push(r))
	e.reset(300000)
	e.setLabel('Alice', 'a1')
	e.go()
	t += 60000
	e.pause()
	t += 30000 // paused time is not counted
	e.go()
	t += 300000 // 6 minutes running in total: 1 minute over
	assert.equal(runs.length, 0)
	e.reset(600000) // next speaker's time ends Alice's run
	assert.equal(runs.length, 1)
	assert.deepEqual(
		{ ...runs[0] },
		{ label: 'Alice', tag: 'a1', startedAt: at(9, 0), endedAt: at(9, 6, 30), stopwatch: false, plannedSeconds: 300, ranSeconds: 360, overSeconds: 60 }
	)
	// finishing early: no overtime, planned is still the full time (including jogs)
	e.go()
	t += 120000
	e.jog(60000)
	t += 60000
	e.reset()
	assert.equal(runs.length, 2)
	assert.equal(runs[1].label, '')
	assert.equal(runs[1].plannedSeconds, 660)
	assert.equal(runs[1].ranSeconds, 180)
	assert.equal(runs[1].overSeconds, 0)
	// reset with nothing run, or an instant start/stop, records nothing
	e.reset()
	e.go()
	e.reset()
	assert.equal(runs.length, 2)
})

test('run records: stop at zero ends the run at the planned time', () => {
	let t = at(9, 0)
	const e = new TimerEngine({ now: () => t, stopAtZero: true })
	const runs = []
	e.on('run', (r) => runs.push(r))
	e.start(5000)
	t += 9000
	e.snapshot()
	assert.equal(runs.length, 1)
	assert.equal(runs[0].ranSeconds, 5)
	assert.equal(runs[0].plannedSeconds, 5)
	assert.equal(runs[0].overSeconds, 0)
	e.reset()
	assert.equal(runs.length, 1)
})

test('run records: time-of-day overtime, and stopwatch runs', () => {
	let t = at(9, 0)
	const e = new TimerEngine({ now: () => t })
	const runs = []
	e.on('run', (r) => runs.push(r))
	e.startTarget(at(9, 10))
	t = at(9, 12, 15)
	e.endRun()
	assert.equal(runs[0].plannedSeconds, 600)
	assert.equal(runs[0].ranSeconds, 735)
	assert.equal(runs[0].overSeconds, 135)
	e.endRun() // already ended: no duplicate
	e.start(0)
	t += 42000
	e.reset()
	assert.equal(runs.length, 2)
	assert.equal(runs[1].stopwatch, true)
	assert.equal(runs[1].ranSeconds, 42)
	assert.equal(runs[1].overSeconds, 0)
})

test('run log CSV', () => {
	const { toCsv } = require('../src/main/runlog')
	const csv = toCsv([{ label: 'Smith, Jane', startedAt: at(9, 0), endedAt: at(9, 6, 30), plannedSeconds: 300, ranSeconds: 360, overSeconds: 60 }])
	assert.equal(csv, 'Speaker,Date,Started,Ended,Planned,Actual,Over\r\n"Smith, Jane",2026-11-10,09:00:00,09:06:30,00:05:00,00:06:00,00:01:00\r\n')
})

test('settings: old stopAtZero migrates to atZero', () => {
	const fs = require('node:fs')
	const os = require('node:os')
	const path = require('node:path')
	const { Settings } = require('../src/main/settings')
	for (const [old, want] of [[true, 'stop'], [false, 'count']]) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'))
		fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 1, stopAtZero: old, zeroMessage: 'Time is up' }))
		const s = new Settings(dir)
		assert.equal(s.data.atZero, want)
		assert.equal('stopAtZero' in s.data, false)
		assert.equal(s.data.zeroMessageEnabled, true)
		assert.equal(s.data.zeroMessage, 'Time is up')
		fs.rmSync(dir, { recursive: true })
	}
})
