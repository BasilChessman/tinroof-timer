'use strict'
// `api` is the global exposed by preload.js (contextBridge)
const $ = (id) => document.getElementById(id)
const isMac = navigator.platform.toUpperCase().includes('MAC')
$('modKey').textContent = isMac ? '⌘' : 'Ctrl'

const preview = SpeakerDisplay.create($('preview'))
let settings = null
let view = null

// ---------------------------------------------------------------- helpers
const pad = (n) => String(n).padStart(2, '0')
function fmtHMS(total) {
	const t = Math.abs(total)
	return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`
}
function fmtShort(total) {
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	if (h) return `${h}:${pad(m)}:${pad(s)}`
	return `${m}:${pad(s)}`
}
function fmtMMSS(secs) {
	const neg = secs < 0
	const a = Math.abs(secs)
	return `${neg ? '-' : ''}${Math.floor(a / 60)}:${pad(a % 60)}`
}
function parseMMSS(text) {
	const m = /^\s*(-)?\s*(\d+)(?::(\d{1,2}))?\s*$/.exec(text || '')
	if (!m) return null
	const v = (m[3] === undefined ? +m[2] * 60 : +m[2] * 60 + +m[3]) // "2" = 2 minutes; "1:30"
	return m[1] ? -v : v
}
function inputSeconds() {
	const h = Math.max(0, Math.min(99, parseInt($('inH').value, 10) || 0))
	const m = Math.max(0, Math.min(59, parseInt($('inM').value, 10) || 0))
	const s = Math.max(0, Math.min(59, parseInt($('inS').value, 10) || 0))
	return h * 3600 + m * 60 + s
}
function setInputs(total) {
	$('inH').value = Math.floor(total / 3600)
	$('inM').value = Math.floor((total % 3600) / 60)
	$('inS').value = total % 60
}
function typingInField(e) {
	const t = e.target
	return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

// ---------------------------------------------------------------- transport
$('btnGo').onclick = () => api.cmd('toggle')
$('btnReset').onclick = () => api.cmd('reset')
document.querySelectorAll('[data-jog]').forEach((b) => (b.onclick = () => api.cmd('jog', +b.dataset.jog)))
// ---- set time: Duration or Until time of day
let entryMode = 'duration'
function setEntryMode(m) {
	entryMode = m === 'until' ? 'until' : 'duration'
	$('entryMode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.entry === entryMode))
	$('entryDuration').hidden = entryMode !== 'duration'
	$('entryUntil').hidden = entryMode !== 'until'
	if (entryMode === 'until' && !$('inUntil').value) {
		const d = new Date(Date.now() + 15 * 60000) // sensible default: 15 minutes from now, rounded
		d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
		$('inUntil').value = `${pad(d.getHours())}:${pad(d.getMinutes())}:00`
	}
	updateUntilHint()
}
$('entryMode').querySelectorAll('button').forEach(
	(b) =>
		(b.onclick = () => {
			setEntryMode(b.dataset.entry)
			api.setSettings({ timeEntryMode: entryMode })
		}),
)
function untilValue() {
	const v = $('inUntil').value // "HH:MM" or "HH:MM:SS" (24h)
	return /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? v : null
}
function updateUntilHint() {
	const v = untilValue()
	if (!v) return ($('untilHint').textContent = '')
	const [h, m, s = 0] = v.split(':').map(Number)
	const d = new Date()
	d.setHours(h, m, s, 0)
	let tomorrow = false
	if (d.getTime() <= Date.now()) {
		d.setDate(d.getDate() + 1)
		tomorrow = true
	}
	const secs = Math.round((d.getTime() - Date.now()) / 1000)
	$('untilHint').textContent = `in ${fmtShort(secs)}${tomorrow ? ' (tomorrow)' : ''}`
}
$('inUntil').addEventListener('input', updateUntilHint)
setInterval(() => entryMode === 'until' && updateUntilHint(), 1000)
function applyEntry(start) {
	if (entryMode === 'until') {
		const v = untilValue()
		if (v) api.cmd(start ? 'startTarget' : 'target', v)
	} else api.cmd(start ? 'start' : 'reset', inputSeconds())
}
document.querySelectorAll('.btn-set').forEach((b) => (b.onclick = () => applyEntry(false)))
document.querySelectorAll('.btn-setgo').forEach((b) => (b.onclick = () => applyEntry(true)))
;['inH', 'inM', 'inS', 'inUntil'].forEach((id) =>
	$(id).addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			applyEntry(e.shiftKey)
		}
	}),
)

// ---- right column tabs
function setRightTab(t) {
	$('rightTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.rtab === t))
	document.querySelectorAll('.rtab').forEach((el) => (el.hidden = el.dataset.rtab !== t))
	try {
		localStorage.setItem('rightTab', t)
	} catch {}
}
$('rightTabs').querySelectorAll('button').forEach((b) => (b.onclick = () => setRightTab(b.dataset.rtab)))
$('modeSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => api.cmd('mode', b.dataset.mode)))

// ---------------------------------------------------------------- presets
function renderPresets() {
	const box = $('presets')
	box.innerHTML = ''
	settings.presets.forEach((p, i) => {
		const b = document.createElement('button')
		b.className = 'btn preset'
		b.title = `Preset ${i + 1} (key ${i + 1}) — ${isMac ? '⌘' : 'Ctrl'}-click to save the Set time value`
		b.innerHTML = `<span class="num">${i + 1}</span><span class="t"></span><span class="l"></span>`
		b.querySelector('.t').textContent = fmtShort(p.seconds)
		b.querySelector('.l').textContent = p.label || ' '
		b.onclick = (e) => clickPreset(i + 1, e.ctrlKey || e.metaKey, b)
		box.appendChild(b)
	})
	markActivePreset()
}
async function clickPreset(n, save, btn) {
	if (save) {
		// Saves what's typed in "Set time" (Duration), never the live timer, so it's safe while running
		if (entryMode !== 'duration') return toast('Presets store durations — switch Set time to “Duration” to save one.')
		const secs = inputSeconds()
		if (await api.cmd('savePreset', n, secs)) {
			btn?.classList.remove('saved')
			void btn?.offsetWidth
			btn?.classList.add('saved')
			toast(`Preset ${n} saved: ${fmtShort(secs)}`)
		}
	} else await api.cmd('loadPreset', n)
}
function toast(text, id = 'presetToast') {
	const t = $(id)
	t.textContent = text
	t.hidden = false
	clearTimeout(t.timer)
	t.timer = setTimeout(() => (t.hidden = true), 2500)
}
function markActivePreset() {
	if (!view || !settings) return
	const btns = $('presets').children
	const manual = !view.target && !view.speakerName
	settings.presets.forEach((p, i) => btns[i]?.classList.toggle('active', manual && p.seconds === view.durationSeconds))
}

// ---------------------------------------------------------------- message
const msgText = $('msgText')
msgText.addEventListener('input', () => ($('msgCount').textContent = `${msgText.value.length}/90`))
msgText.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault()
		sendMessage()
	}
})
function sendMessage() {
	const t = msgText.value.trim()
	if (t) api.cmd('message', t)
}
$('btnMsgSend').onclick = sendMessage
$('btnMsgClear').onclick = () => api.cmd('clearMessage')
$('btnMsgFlash').onclick = () => api.cmd('flashMessage')
const SAVED_MAX = 50
$('btnMsgSave').onclick = () => {
	const t = msgText.value.replace(/[\r\n]+/g, ' ').trim()
	if (!t) return toast('Type a message first, then press Save.', 'msgToast')
	const saved = settings.savedMessages || []
	if (saved.includes(t) || (settings.quickMessages || []).includes(t)) return toast('That message is already in the list.', 'msgToast')
	if (saved.length >= SAVED_MAX) return toast(`You can save up to ${SAVED_MAX} messages. Remove one first.`, 'msgToast')
	setSaved([...saved, t])
	toast('Message saved.', 'msgToast')
}
// Update locally first so quick successive saves/removals build on each other
function setSaved(list) {
	settings.savedMessages = list
	renderQuick()
	api.setSettings({ savedMessages: list })
}
function messageButton(q) {
	const b = document.createElement('button')
	b.className = 'btn'
	b.textContent = q
	b.title = 'Send this message (Shift-click to copy into the editor)'
	b.onclick = (e) => {
		if (e.shiftKey) {
			msgText.value = q
			msgText.dispatchEvent(new Event('input'))
			msgText.focus()
		} else api.cmd('message', q)
	}
	return b
}
function renderQuick() {
	const box = $('quickMsgs')
	box.innerHTML = ''
	for (const q of settings.quickMessages || []) if (q.trim()) box.appendChild(messageButton(q))
	const mine = $('savedMsgs')
	mine.innerHTML = ''
	;(settings.savedMessages || []).forEach((q, i) => {
		const b = messageButton(q)
		b.title = 'Your saved message. Click to send, Shift-click to copy into the editor, × to remove'
		const del = document.createElement('span')
		del.className = 'del'
		del.textContent = '×'
		del.title = 'Remove this saved message'
		del.onclick = (e) => {
			e.stopPropagation()
			const saved = [...settings.savedMessages]
			saved.splice(i, 1)
			setSaved(saved)
		}
		b.appendChild(del)
		mine.appendChild(b)
	})
}

// ---------------------------------------------------------------- footer
$('btnOutput').onclick = () => api.cmd('toggleOutput')
$('btnSettings').onclick = openSettings
$('btnAbout').onclick = openAbout
api.on('open-settings', openSettings)
api.on('open-about', openAbout)

async function refreshNet() {
	const n = await api.getNetInfo()
	const ip = n.addresses[0] || '127.0.0.1'
	const ok = (s) => String(s).startsWith('listening')
	$('netInfo').innerHTML =
		`<span class="dot ${ok(n.status.tcp) ? 'on' : ''}"></span>Control <code>${ip}:${n.tcpPort}</code> · ${n.tcpClients} client${n.tcpClients === 1 ? '' : 's'}` +
		` &nbsp; <span class="dot ${ok(n.status.web) ? 'on' : ''}"></span>Web view <code>http://${ip}:${n.webPort}/</code>`
	$('netDetail').innerHTML =
		`IP addresses: ${n.addresses.map((a) => `<code>${a}</code>`).join(', ') || 'none'}<br>` +
		`TCP: ${n.status.tcp} · Web: ${n.status.web} · UDP: ${n.status.udp} · SSDP: ${n.status.ssdp}<br>` +
		`In Companion add the <b>Irisdown: Countdown Timer</b> or <b>TinRoof Timer</b> module and enter this computer's IP address.`
}
api.on('net', refreshNet)
setInterval(refreshNet, 3000)

// ---------------------------------------------------------------- live view
api.on('view', (v) => {
	view = v
	if (settings) preview.update(v, settings)
	// In overtime the box shows how far over the timer is, rather than a negative remaining time.
	$('stRemainingLabel').textContent = v.overtime ? 'Over by' : 'Remaining'
	$('stRemaining').textContent = (v.overtime ? '+' : '') + v.time
	$('stRemaining').style.color = v.color
	$('stElapsed').textContent = v.elapsed
	$('stEnd').textContent = v.endText || '—'
	$('stClock').textContent = v.clockText
	const pill = $('statePill')
	const label = v.overtime && v.state === 'PLAYING' ? 'OVERTIME' : v.state
	pill.textContent = v.stopwatch ? `${label} · STOPWATCH` : v.target ? `${label} · UNTIL ${v.targetText}` : label
	pill.className = 'state-pill ' + (v.overtime ? 'OVER' : v.state)
	const go = $('btnGo')
	const playing = v.state === 'PLAYING'
	go.textContent = playing ? '❚❚ PAUSE' : v.state === 'PAUSED' ? '▶ RESUME' : '▶ GO'
	go.classList.toggle('is-pause', playing)
	$('modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === v.mode))
	const live = $('msgLive')
	live.textContent = v.message ? `On screen: “${v.message}”` : 'No message on screen'
	live.classList.toggle('on', !!v.message)
	$('previewTag').textContent = settings?.hideDisplay ? 'PREVIEW (output hidden)' : 'OUTPUT'
	markActivePreset()
	markSpeakers()
	updateLiveLogRow()
})

// ---------------------------------------------------------------- sounds
const audioPool = new Map()
api.on('play-sound', async (snd) => {
	try {
		let a = audioPool.get(snd.file)
		if (!a) {
			a = new Audio(await api.soundUrl(snd.file))
			audioPool.set(snd.file, a)
		}
		a.volume = Math.max(0, Math.min(1, (snd.volume ?? 100) / 100))
		a.currentTime = 0
		await a.play()
	} catch (e) {
		console.warn('Sound failed', snd.file, e)
	}
})

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
	if (typingInField(e) || document.querySelector('dialog[open]')) return
	const mod = e.ctrlKey || e.metaKey
	if (e.key === ' ') {
		e.preventDefault()
		api.cmd('toggle')
	} else if (e.key === 'r' || e.key === 'R') api.cmd('reset')
	else if (/^[1-9]$/.test(e.key)) clickPreset(+e.key, mod, $('presets').children[+e.key - 1])
	else if (!mod && (e.key === 'n' || e.key === 'N')) api.cmd('speaker', 'NEXT', !e.shiftKey)
	else if (!mod && (e.key === 'p' || e.key === 'P')) api.cmd('speaker', 'PREV', !e.shiftKey)
	else if (e.key === '+' || e.key === '=') api.cmd('jog', 60)
	else if (e.key === '-' || e.key === '_') api.cmd('jog', -60)
	else if (!mod && (e.key === 't' || e.key === 'T')) api.cmd('mode', 'TIMER')
	else if (!mod && (e.key === 'c' || e.key === 'C')) api.cmd('mode', 'CLOCK')
	else if (!mod && (e.key === 'b' || e.key === 'B')) api.cmd('mode', 'BLACK')
	else if (e.key === 'm' || e.key === 'M') {
		e.preventDefault()
		msgText.focus()
	} else if (e.key === 'Escape') api.cmd('clearMessage')
})

// ---------------------------------------------------------------- settings dialog
const dlg = $('dlgSettings')
$('tabs').querySelectorAll('button').forEach(
	(b) =>
		(b.onclick = () => {
			$('tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b))
			dlg.querySelectorAll('.tab').forEach((t) => (t.hidden = t.dataset.tab !== b.dataset.tab))
		}),
)

async function openSettings(tab) {
	if (typeof tab === 'string') $('tabs').querySelector(`[data-tab="${tab}"]`)?.click()
	const displays = await api.getDisplays()
	const sel = $('selDisplay')
	sel.innerHTML = '<option value="auto">Automatic (first non-primary display)</option>' + displays.map((d) => `<option value="${d.id}"></option>`).join('')
	displays.forEach((d, i) => (sel.options[i + 1].textContent = d.label))
	fillSettingsForm()
	refreshNet()
	if (!dlg.open) dlg.showModal()
}

function fillSettingsForm() {
	dlg.querySelectorAll('[data-k]').forEach((input) => {
		const k = input.dataset.k
		const v = settings[k]
		if (input.type === 'checkbox') input.checked = !!v
		else if (input.dataset.fmt === 'mmss') input.value = fmtMMSS(v)
		else input.value = v ?? ''
	})
	$('brightVal').textContent = settings.brightness + '%'
	renderPresetEdit()
	renderSpeakerEdit()
	$('quickEdit').value = (settings.quickMessages || []).join('\n')
	$('savedEdit').value = (settings.savedMessages || []).join('\n')
	renderSounds()
}

dlg.querySelectorAll('[data-k]').forEach((input) => {
	const ev = input.type === 'range' || input.type === 'color' ? 'input' : 'change'
	input.addEventListener(ev, () => {
		const k = input.dataset.k
		let v
		if (input.type === 'checkbox') v = input.checked
		else if (input.type === 'number' || input.type === 'range') v = Number(input.value)
		else if (input.dataset.fmt === 'mmss') {
			v = parseMMSS(input.value)
			if (v == null || v < 0) return (input.value = fmtMMSS(settings[k]))
		} else v = input.value
		if (k === 'brightness') $('brightVal').textContent = v + '%'
		if ((k === 'tcpPort' || k === 'webPort') && !(v >= 1 && v <= 65535)) return (input.value = settings[k])
		api.setSettings({ [k]: v })
	})
})

function renderPresetEdit() {
	const box = $('presetEdit')
	box.innerHTML = ''
	settings.presets.forEach((p, i) => {
		const n = document.createElement('span')
		n.className = 'n'
		n.textContent = i + 1
		const label = document.createElement('input')
		label.placeholder = 'Label (e.g. Keynote)'
		label.value = p.label || ''
		const time = document.createElement('input')
		time.value = fmtHMS(p.seconds)
		time.title = 'hh:mm:ss'
		const save = () => {
			const presets = structuredClone(settings.presets)
			presets[i].label = label.value.slice(0, 24)
			const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(time.value.trim()) || /^()(\d{1,2}):(\d{1,2})$/.exec(time.value.trim())
			if (m) presets[i].seconds = (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]
			time.value = fmtHMS(presets[i].seconds)
			api.setSettings({ presets })
		}
		label.onchange = save
		time.onchange = save
		box.append(n, label, time)
	})
}

$('quickEdit').addEventListener('change', () =>
	api.setSettings({ quickMessages: $('quickEdit').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 24) }),
)
$('savedEdit').addEventListener('change', () =>
	api.setSettings({ savedMessages: $('savedEdit').value.split('\n').map((s) => s.trim().slice(0, 90)).filter(Boolean).slice(0, SAVED_MAX) }),
)

function renderSounds() {
	const box = $('soundList')
	box.innerHTML = ''
	if (!settings.sounds.length) box.innerHTML = '<div class="note">No sounds configured.</div>'
	settings.sounds.forEach((snd, i) => {
		const row = document.createElement('div')
		row.className = 'sound'
		const en = document.createElement('input')
		en.type = 'checkbox'
		en.checked = !!snd.enabled
		en.title = 'Enabled'
		const file = document.createElement('span')
		file.className = 'file'
		file.textContent = snd.file ? snd.file.split(/[\\/]/).pop() : '<choose file>'
		file.title = snd.file || 'Click to choose an audio file'
		const vol = document.createElement('input')
		vol.type = 'range'
		vol.min = 0
		vol.max = 100
		vol.value = snd.volume ?? 100
		vol.title = 'Volume'
		const at = document.createElement('input')
		at.value = fmtMMSS(snd.seconds)
		at.title = 'Trigger at remaining time (m:ss, negative = overtime)'
		const play = document.createElement('button')
		play.type = 'button'
		play.className = 'btn btn-small'
		play.textContent = '▶'
		play.title = 'Preview'
		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'btn btn-small'
		del.textContent = '✕'
		del.title = 'Delete'
		const save = (patch) => {
			const sounds = structuredClone(settings.sounds)
			Object.assign(sounds[i], patch)
			api.setSettings({ sounds })
		}
		en.onchange = () => save({ enabled: en.checked })
		vol.onchange = () => save({ volume: +vol.value })
		at.onchange = () => {
			const v = parseMMSS(at.value)
			if (v == null) return (at.value = fmtMMSS(snd.seconds))
			save({ seconds: v })
		}
		file.onclick = async () => {
			const f = await api.pickSound()
			if (f) save({ file: f })
		}
		play.onclick = async () => {
			if (!snd.file) return
			const a = new Audio(await api.soundUrl(snd.file))
			a.volume = (+vol.value || 0) / 100
			a.play().catch(() => {})
		}
		del.onclick = () => api.setSettings({ sounds: settings.sounds.filter((_, j) => j !== i) })
		row.append(en, file, vol, at, play, del)
		box.appendChild(row)
	})
}
$('btnSoundAdd').onclick = async () => {
	const f = await api.pickSound()
	if (!f) return
	api.setSettings({ sounds: [...settings.sounds, { enabled: true, file: f, volume: 100, seconds: 0 }] })
}
$('btnDefaults').onclick = async () => {
	if (confirm('Are you sure you want to delete current settings and load defaults?')) {
		settings = await api.resetSettings()
		fillSettingsForm()
	}
}

async function openAbout() {
	const i = await api.appInfo()
	$('aboutVersion').textContent = `Version ${i.version} · protocol level ${i.compat} · Electron ${i.electron}`
	$('dlgAbout').showModal()
}

// ---------------------------------------------------------------- speakers
function speakerTimeText(sp) {
	return sp.type === 'until' ? `until ${sp.until}` : fmtShort(sp.seconds)
}
function renderSpeakers() {
	const box = $('spkList')
	const list = settings.speakers
	$('spkCount').textContent = list.length ? `(${list.length})` : ''
	box.innerHTML = ''
	if (!list.length) {
		box.innerHTML = '<div class="spk-empty">No speakers yet.<br>Add your running order with <b>Edit list…</b></div>'
	}
	const done = new Set(settings.speakersDone)
	list.forEach((sp, i) => {
		const b = document.createElement('button')
		b.className = 'spk'
		b.dataset.idx = i
		b.title = `Click: start ${sp.name} · Shift-click: load without starting`
		b.innerHTML = '<span class="spk-n"></span><span class="spk-name"></span><span class="spk-time"></span><span class="spk-done"></span>'
		b.querySelector('.spk-n').textContent = i + 1
		b.querySelector('.spk-name').textContent = sp.name
		const timeEl = b.querySelector('.spk-time')
		timeEl.textContent = speakerTimeText(sp)
		const last = lastRunBySpeaker.get(sp.id)
		if (last && done.has(sp.id)) {
			const a = document.createElement('span')
			a.className = 'spk-actual' + (last.overSeconds > 0 ? ' over' : '')
			a.textContent = `ran ${fmtShort(last.ranSeconds)}` + (last.overSeconds > 0 ? ` · +${fmtShort(last.overSeconds)} over` : '')
			timeEl.appendChild(a)
		}
		b.querySelector('.spk-done').textContent = done.has(sp.id) ? '✓' : ''
		b.classList.toggle('done', done.has(sp.id))
		b.onclick = (e) => api.cmd('speaker', i + 1, !e.shiftKey)
		box.appendChild(b)
	})
	markSpeakers()
}
let lastLiveIdx = -2
function markSpeakers() {
	if (!view || !settings) return
	const live = view.speakerNumber ? view.speakerNumber - 1 : -1
	const nextIdx = view.nextSpeakerNumber ? view.nextSpeakerNumber - 1 : -1
	for (const b of $('spkList').children) {
		const i = +b.dataset.idx
		b.classList.toggle('live', i === live)
		b.classList.toggle('running', i === live && view.state === 'PLAYING')
		b.classList.toggle('next', i === nextIdx)
	}
	if (live !== lastLiveIdx) {
		lastLiveIdx = live
		$('spkList').children[live]?.scrollIntoView({ block: 'nearest' })
	}
	$('btnSpkNext').textContent = view.nextSpeakerName ? `Next: ${view.nextSpeakerName} ▶` : 'Next ▶'
	$('btnSpkNext').disabled = !view.nextSpeakerNumber
}
$('btnSpkNext').onclick = (e) => api.cmd('speaker', 'NEXT', !e.shiftKey)
$('btnSpkPrev').onclick = (e) => api.cmd('speaker', 'PREV', !e.shiftKey)
$('btnSpkClear').onclick = () => api.cmd('clearSpeakersDone')
$('btnSpkEdit').onclick = () => openSettings('speakers')

// ---------------------------------------------------------------- run log
let runLog = []
let lastRunBySpeaker = new Map()
function fmtClockTime(ms) {
	const d = new Date(ms)
	const today = new Date().toDateString() === d.toDateString()
	const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	return today ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`
}
function logCell(tr, text, cls) {
	const td = document.createElement('td')
	td.textContent = text
	if (cls) td.className = cls
	tr.appendChild(td)
	return td
}
function renderRunLog(entries) {
	runLog = entries || []
	lastRunBySpeaker = new Map()
	for (const e of runLog) if (e.speakerId) lastRunBySpeaker.set(e.speakerId, e)
	const body = $('logBody')
	body.innerHTML = ''
	// the run in progress (filled in by updateLiveLogRow), then the newest first
	const live = document.createElement('tr')
	live.className = 'live'
	live.id = 'logLive'
	live.hidden = true
	body.appendChild(live)
	for (let i = runLog.length - 1; i >= 0; i--) {
		const e = runLog[i]
		const tr = document.createElement('tr')
		logCell(tr, e.label || (e.stopwatch ? 'Stopwatch' : 'Timer'), e.label ? '' : 'muted')
		logCell(tr, fmtClockTime(e.startedAt))
		logCell(tr, e.stopwatch ? '—' : fmtShort(e.plannedSeconds))
		logCell(tr, fmtShort(e.ranSeconds))
		logCell(tr, e.overSeconds > 0 ? '+' + fmtShort(e.overSeconds) : '—', e.overSeconds > 0 ? 'over' : 'muted')
		body.appendChild(tr)
	}
	$('logEmpty').hidden = runLog.length > 0
	$('logCount').textContent = runLog.length ? `(${runLog.length})` : ''
	const overs = runLog.filter((e) => e.overSeconds > 0)
	$('logTotal').textContent = overs.length
		? `${overs.length} of ${runLog.length} ran over · ${fmtShort(overs.reduce((a, e) => a + e.overSeconds, 0))} in total`
		: ''
	if (settings) renderSpeakers()
	updateLiveLogRow()
}
function updateLiveLogRow() {
	const row = $('logLive')
	if (!row || !view) return
	// a run is in progress once the timer has been started and not yet reset
	const running = view.state !== 'STOPPED' && view.elapsedSeconds > 0
	row.hidden = !running
	if (!running) return
	row.innerHTML = ''
	logCell(row, view.speakerName || (view.stopwatch ? 'Stopwatch' : 'Timer'))
	logCell(row, '')
	logCell(row, view.stopwatch ? '—' : fmtShort(view.elapsedSeconds + view.seconds))
	logCell(row, fmtShort(view.elapsedSeconds))
	logCell(row, view.overtime ? '+' + fmtShort(-view.seconds) : '—', view.overtime ? 'over' : 'muted')
	$('logEmpty').hidden = true
}
api.on('runlog', renderRunLog)
api.getRunLog().then(renderRunLog)
$('btnLogExport').onclick = () => api.exportRunLog()
$('btnLogClear').onclick = () => api.clearRunLog()

// ---- editor (Settings → Speakers)
function parseHMS(text) {
	const t = String(text).trim()
	if (/^\d+$/.test(t)) return +t * 60 // plain number = minutes
	const p = t.split(':')
	if (p.length < 2 || p.length > 3 || p.some((x) => !/^\d+$/.test(x))) return null
	const n = p.map(Number)
	return p.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2]
}
function saveSpeakers(list) {
	api.setSettings({ speakers: list })
}
function renderSpeakerEdit() {
	const box = $('spkEdit')
	box.innerHTML = ''
	const list = settings.speakers
	if (!list.length) box.innerHTML = '<div class="note">No speakers. Click “+ Add speaker” or import a CSV.</div>'
	list.forEach((sp, i) => {
		const row = document.createElement('div')
		row.className = 'spk-row'
		const n = document.createElement('span')
		n.className = 'n'
		n.textContent = i + 1
		const name = document.createElement('input')
		name.value = sp.name
		name.placeholder = 'Speaker name'
		name.maxLength = 60
		const type = document.createElement('select')
		type.innerHTML = '<option value="duration">Duration</option><option value="until">Ends at</option>'
		type.value = sp.type
		const time = document.createElement('input')
		const showTime = () => {
			if (type.value === 'until') {
				time.type = 'time'
				time.step = 1
				time.value = sp.until && /^\d{1,2}:\d{2}/.test(sp.until) ? sp.until.padStart(5, '0') : ''
				time.title = 'End time of day'
			} else {
				time.type = 'text'
				time.value = fmtHMS(sp.seconds)
				time.title = 'Duration (h:mm:ss, m:ss, or minutes)'
			}
		}
		showTime()
		const up = document.createElement('button')
		up.type = 'button'
		up.className = 'btn btn-small'
		up.textContent = '▲'
		up.title = 'Move up'
		up.disabled = i === 0
		const down = document.createElement('button')
		down.type = 'button'
		down.className = 'btn btn-small'
		down.textContent = '▼'
		down.title = 'Move down'
		down.disabled = i === list.length - 1
		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'btn btn-small'
		del.textContent = '✕'
		del.title = 'Delete'
		const actions = document.createElement('span')
		actions.className = 'spk-row-actions'
		actions.append(up, down, del)

		const update = (patch) => {
			const next = structuredClone(settings.speakers)
			Object.assign(next[i], patch)
			Object.assign(sp, patch)
			saveSpeakers(next)
		}
		name.onchange = () => update({ name: name.value.trim() || 'Speaker' })
		type.onchange = () => {
			sp.type = type.value
			if (type.value === 'until' && !sp.until) {
				const d = new Date(Date.now() + 30 * 60000)
				sp.until = `${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / 5) * 5)}`
			}
			showTime()
			update({ type: sp.type, until: sp.until })
		}
		time.onchange = () => {
			if (type.value === 'until') {
				if (time.value) update({ until: time.value })
			} else {
				const v = parseHMS(time.value)
				if (v == null) return showTime()
				update({ seconds: v })
				time.value = fmtHMS(v)
			}
		}
		const move = (d) => {
			const next = structuredClone(settings.speakers)
			const [x] = next.splice(i, 1)
			next.splice(i + d, 0, x)
			saveSpeakers(next)
		}
		up.onclick = () => move(-1)
		down.onclick = () => move(1)
		del.onclick = () => saveSpeakers(settings.speakers.filter((_, j) => j !== i))
		row.append(n, name, type, time, actions)
		box.appendChild(row)
	})
}
$('btnSpkAdd').onclick = () => {
	const last = settings.speakers[settings.speakers.length - 1]
	saveSpeakers([...settings.speakers, { name: `Speaker ${settings.speakers.length + 1}`, type: 'duration', seconds: last?.type === 'duration' ? last.seconds : 600, until: '' }])
	setTimeout(() => {
		const inputs = $('spkEdit').querySelectorAll('.spk-row input:first-of-type')
		const el = inputs[inputs.length - 1]
		el?.focus()
		el?.select()
	}, 150)
}
$('btnSpkImport').onclick = async () => {
	const r = await api.importSpeakers()
	if (!r) return
	if (r.error) return alert('Could not read file: ' + r.error)
	if (!r.speakers.length) return alert('No speakers found. Expected one "name, time" per line.')
	let list = r.speakers
	if (settings.speakers.length && !confirm(`Import ${list.length} speaker(s).\n\nOK = replace the current list\nCancel = add to the end`)) {
		list = [...settings.speakers, ...list]
	}
	saveSpeakers(list)
	if (r.errors.length) alert(`Skipped line(s) ${r.errors.join(', ')}: time not recognised.`)
}
$('btnSpkExport').onclick = () => api.exportSpeakers()
$('btnSpkDeleteAll').onclick = () => {
	if (settings.speakers.length && confirm('Delete all speakers?')) saveSpeakers([])
}

// ---------------------------------------------------------------- settings sync
function applySettings(s) {
	const presetsChanged = !settings || JSON.stringify(settings.presets) !== JSON.stringify(s.presets)
	const quickChanged =
		!settings || JSON.stringify([settings.quickMessages, settings.savedMessages]) !== JSON.stringify([s.quickMessages, s.savedMessages])
	const soundsChanged = !settings || JSON.stringify(settings.sounds) !== JSON.stringify(s.sounds)
	const speakersChanged =
		!settings ||
		JSON.stringify([settings.speakers, settings.speakersDone, settings.currentSpeaker]) !== JSON.stringify([s.speakers, s.speakersDone, s.currentSpeaker])
	// only rebuild the editor when rows were added/removed/reordered (not while typing in a field)
	const speakerRowsChanged = !settings || settings.speakers.map((x) => x.id).join() !== s.speakers.map((x) => x.id).join()
	settings = s
	if (presetsChanged) {
		renderPresets()
		if (dlg.open) renderPresetEdit()
	}
	if (quickChanged) {
		renderQuick()
		if (dlg.open && document.activeElement !== $('savedEdit')) $('savedEdit').value = (s.savedMessages || []).join('\n')
	}
	if (soundsChanged && dlg.open) renderSounds()
	if (speakersChanged) renderSpeakers()
	if (speakerRowsChanged && dlg.open) renderSpeakerEdit()
	$('btnOutput').textContent = s.hideDisplay ? 'Show output' : 'Hide output'
}
api.on('settings', applySettings)
api.getSettings().then((s) => {
	applySettings(s)
	setInputs(s.duration)
	setEntryMode(s.timeEntryMode)
	let tab = null
	try {
		tab = localStorage.getItem('rightTab')
	} catch {}
	setRightTab(tab || (s.speakers.length ? 'speakers' : 'time'))
	refreshNet()
})
