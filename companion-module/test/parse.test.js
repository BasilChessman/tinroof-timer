import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUpdate, parseSpeakers, speakerSlotValues, variableValues, emptyState } from '../src/parse.js'

test('mode 1', () => {
	assert.deepEqual(parseUpdate('00:10:00 STOPPED TIMER'), { time: '00:10:00', sign: '+', state: 'STOPPED', mode: 'TIMER', seconds: 600 })
	assert.equal(parseUpdate('OK'), null)
})
test('mode 2 overtime', () => {
	const u = parseUpdate('TIME=-00:01:05&STATE=PLAYING&DISPLAY=CLOCK&MESSAGE=TRUE')
	assert.equal(u.time, '00:01:05')
	assert.equal(u.sign, '-')
	assert.equal(u.seconds, -65)
	assert.equal(u.message, true)
	assert.equal(u.mode, 'CLOCK')
})
test('mode 3 + variables', () => {
	const st = Object.assign(emptyState(), parseUpdate('TIME=+01:02:03&STATE=PAUSED&DISPLAY=TIMER&MESSAGE=TRUE&SECONDS=3723&ELAPSED=00:10:00&DURATION=01:12:03&END=17:00:00&WARN=GREEN&PROGRESS=14&STOPWATCH=FALSE&TEXT=Wrap%20up%20%26%20go'))
	const v = variableValues(st)
	assert.equal(v.state, 'Paused')
	assert.equal(v.time_hm, '01:02')
	assert.equal(v.time_ms, '62:03')
	assert.equal(v.time_short, '1:02:03')
	assert.equal(v.message, 'Wrap up & go')
	assert.equal(v.progress, 14)
	assert.equal(v.end_time, '17:00:00')
})

test('mode 3 speaker + target fields and SPEAKERS list', () => {
	const st = Object.assign(emptyState(), parseUpdate('TIME=+00:05:00&STATE=PLAYING&DISPLAY=TIMER&MESSAGE=FALSE&SECONDS=300&ELAPSED=00:00:00&DURATION=00:05:00&END=10:30:00&WARN=GREEN&PROGRESS=0&STOPWATCH=FALSE&TEXT=&TARGET=10:30:00&SPEAKER=Ada%20Lovelace&SPEAKERNUM=2&NEXTSPEAKER=Bob&NEXTSPEAKERNUM=3'))
	const v = variableValues(st)
	assert.equal(v.speaker_name, 'Ada Lovelace')
	assert.equal(v.speaker_number, 2)
	assert.equal(v.next_speaker_name, 'Bob')
	assert.equal(v.target_time, '10:30:00')
	assert.equal(v.countdown_to_time, true)
	const list = parseSpeakers('SPEAKERS=' + encodeURIComponent(JSON.stringify([{ n: 1, name: 'A', time: '00:10:00', done: true }, { n: 2, name: 'B', time: '@10:30', done: false }])))
	assert.equal(list.length, 2)
	const slots = speakerSlotValues(list, 3)
	assert.equal(slots.speaker_1_done, true)
	assert.equal(slots.speaker_2_time, 'until 10:30')
	assert.equal(slots.speaker_3_name, '')
	assert.equal(parseSpeakers('TIME=+00:00:00'), null)
})
