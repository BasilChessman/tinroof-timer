import test from 'node:test'
import assert from 'node:assert/strict'
import { parseState, parseSpeakers, speakerSlotValues, variableValues, emptyState, clock12 } from '../src/parse.js'

const stateLine = (o) => 'STATE ' + JSON.stringify({ ...emptyState(), speakers: undefined, ...o })

test('replies and junk are not state lines', () => {
	for (const l of ['OK', 'ERROR', 'IGNORED', 'PLAYING', 'VERSION 1.5.0', 'STATE {broken', 'STATE [1]']) {
		assert.equal(parseState(l), null)
		assert.equal(parseSpeakers(l), null)
	}
})

test('STATE line + variables', () => {
	const st = Object.assign(
		emptyState(),
		parseState(stateLine({ state: 'PAUSED', time: '01:02:03', seconds: 3723, elapsed: '00:10:00', duration: '01:12:03', end: '17:00:00', warn: 'GREEN', progress: 14, message: 'Wrap up & go' })),
	)
	const v = variableValues(st)
	assert.equal(v.state, 'Paused')
	assert.equal(v.time_hm, '01:02')
	assert.equal(v.time_ms, '62:03')
	assert.equal(v.time_short, '1:02:03')
	assert.equal(v.message, 'Wrap up & go')
	assert.equal(v.message_active, true)
	assert.equal(v.progress, 14)
	assert.equal(v.end_time, '17:00:00')
	assert.equal(v.end_time_hm, '5:00 PM')
	assert.equal(clock12('00:15:59'), '12:15 AM')
	assert.equal(clock12('12:30:00'), '12:30 PM')
	assert.equal(clock12('09:05:00'), '9:05 AM')
	assert.equal(variableValues(emptyState()).end_time_hm, '')
})

test('overtime', () => {
	const v = variableValues(Object.assign(emptyState(), parseState(stateLine({ state: 'PLAYING', time: '00:01:05', overtime: true, seconds: -65, warn: 'OVER' }))))
	assert.equal(v.overtime, true)
	assert.equal(v.time_signed, '-00:01:05')
	assert.equal(v.time_short, '-1:05')
	assert.equal(v.remaining_seconds, -65)
	assert.equal(v.warning, 'OVER')
})

test('speaker + target fields and SPEAKERS list', () => {
	const st = Object.assign(emptyState(), parseState(stateLine({ state: 'PLAYING', time: '00:05:00', target: '10:30:00', speaker: 'Ada Lovelace', speakerNumber: 2, nextSpeaker: 'Bob', nextSpeakerNumber: 3 })))
	const v = variableValues(st)
	assert.equal(v.speaker_name, 'Ada Lovelace')
	assert.equal(v.speaker_number, 2)
	assert.equal(v.next_speaker_name, 'Bob')
	assert.equal(v.next_speaker_number, 3)
	assert.equal(v.target_time, '10:30:00')
	assert.equal(v.countdown_to_time, true)
	const list = parseSpeakers('SPEAKERS ' + JSON.stringify([{ n: 1, name: 'A', time: '00:10:00', done: true }, { n: 2, name: 'B', time: '@10:30', done: false }]))
	assert.equal(list.length, 2)
	const slots = speakerSlotValues(list, 3)
	assert.equal(slots.speaker_1_done, true)
	assert.equal(slots.speaker_2_time, 'until 10:30')
	assert.equal(slots.speaker_3_name, '')
	assert.equal(parseSpeakers('STATE {}'), null)
})
