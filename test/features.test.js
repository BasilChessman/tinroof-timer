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
