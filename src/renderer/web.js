'use strict'
// Web view: live display over Server-Sent Events. Add ?controls=1 for basic remote buttons.
const root = document.getElementById('root')
const status = document.getElementById('status')
const display = SpeakerDisplay.create(root)
let es
function connect() {
	es = new EventSource('/events')
	es.onopen = () => {
		status.textContent = 'Connected'
		status.className = ''
		setTimeout(() => (status.textContent = ''), 2000)
	}
	es.onmessage = (e) => {
		const { view, settings } = JSON.parse(e.data)
		display.update(view, settings)
	}
	es.onerror = () => {
		status.textContent = 'Connection lost — retrying…'
		status.className = 'err'
	}
}
connect()
document.addEventListener('dblclick', () => {
	if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
	else document.exitFullscreen?.()
})
