'use strict'
const display = SpeakerDisplay.create(document.getElementById('root'))
let settings = null
window.api.getSettings().then((s) => (settings = s))
window.api.on('settings', (s) => (settings = s))
window.api.on('view', (v) => settings && display.update(v, settings))
// Escape brings up the user interface
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') window.api.focusControl()
	if (e.key === ' ') window.api.cmd('toggle')
})
document.addEventListener('dblclick', () => window.api.focusControl())
