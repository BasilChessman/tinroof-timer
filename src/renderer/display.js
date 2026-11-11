/* Shared display renderer: used by the output window, the control preview and the web view.
 * Plain browser script (no modules) so it can be served over HTTP unchanged.
 * Usage: const d = SpeakerDisplay.create(rootElement); d.update(view, settings)
 */
;(function () {
	'use strict'

	const FONTS = {
		system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
		mono: '"SF Mono", "Cascadia Mono", Consolas, "Roboto Mono", monospace',
		condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
		rounded: '"SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", sans-serif',
		verdana: 'Verdana, Geneva, sans-serif',
	}

	function el(tag, cls, parent) {
		const e = document.createElement(tag)
		if (cls) e.className = cls
		if (parent) parent.appendChild(e)
		return e
	}

	function create(root) {
		root.classList.add('sd-root')
		const content = el('div', 'sd-content', root)
		const topbar = el('div', 'sd-topbar', content)
		const topClock = el('div', 'sd-top-clock', topbar)
		const topEnd = el('div', 'sd-top-end', topbar)
		const speakerLine = el('div', 'sd-speaker', content)
		const main = el('div', 'sd-main', content)
		const bigWrap = el('div', 'sd-big-wrap', main)
		const big = el('div', 'sd-big', bigWrap)
		const msgWrap = el('div', 'sd-msg-wrap', main)
		const msg = el('div', 'sd-msg', msgWrap)
		const nextLine = el('div', 'sd-next', content)
		const progress = el('div', 'sd-progress', content)
		const bar = el('div', 'sd-progress-bar', progress)
		const canvas = el('canvas', 'sd-test', root)
		// Drop the flash class once it has played. If it stayed on, the animation would replay
		// every time the message box goes from hidden to shown, i.e. on every new message.
		msg.addEventListener('animationend', () => msg.classList.remove('sd-msg-flash'))

		let last = {}
		let lastSeq = -1
		let lastFlashSeq = null
		let msgFitKey = ''

		function fit(elm, box, key, maxFrac, center) {
			// scale text so it fills the box width (and doesn't exceed box height * maxFrac).
			// With `center`, the text is also shifted so it sits at the vertical centre of the
			// whole screen rather than of its box (the bars above and below are uneven), and it
			// is kept small enough to fit there without overlapping them.
			const w = box.clientWidth
			const h = box.clientHeight
			if (!w || !h) return
			const k = key + '|' + w + 'x' + h + '|' + root.clientHeight + '|' + !!center
			if (k === elm.dataset.fit) return
			elm.dataset.fit = k
			let availH = h
			let shift = 0
			if (center) {
				const r = root.getBoundingClientRect()
				const b = box.getBoundingClientRect()
				const cy = r.top + r.height / 2
				const room = 2 * Math.min(cy - b.top, b.bottom - cy)
				if (room > 0) {
					availH = room
					shift = cy - (b.top + b.height / 2)
				}
			}
			elm.style.transform = shift ? `translateY(${shift.toFixed(1)}px)` : ''
			elm.style.fontSize = '100px'
			const tw = elm.scrollWidth || 1
			const th = elm.scrollHeight || 1
			const size = Math.max(8, Math.min((100 * w * 0.94) / tw, (100 * availH * maxFrac) / th))
			elm.style.fontSize = size.toFixed(1) + 'px'
		}

		function fitMessage(box) {
			const w = box.clientWidth
			const h = box.clientHeight
			if (!w || !h) return
			const k = msg.textContent + '|' + w + 'x' + h
			if (k === msgFitKey) return
			msgFitKey = k
			// binary search the largest font that fits in the box with wrapping
			let lo = 8
			let hi = Math.max(12, h)
			for (let i = 0; i < 14; i++) {
				const mid = (lo + hi) / 2
				msg.style.fontSize = mid + 'px'
				if (msg.scrollHeight <= h * 0.96 && msg.scrollWidth <= w * 0.98) lo = mid
				else hi = mid
			}
			msg.style.fontSize = lo.toFixed(1) + 'px'
		}

		function drawTest() {
			const w = root.clientWidth
			const h = root.clientHeight
			const dpr = window.devicePixelRatio || 1
			canvas.width = Math.round(w * dpr)
			canvas.height = Math.round(h * dpr)
			const c = canvas.getContext('2d')
			c.scale(dpr, dpr)
			c.fillStyle = '#000'
			c.fillRect(0, 0, w, h)
			// colour bars
			const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']
			const bw = w / bars.length
			bars.forEach((col, i) => {
				c.fillStyle = col
				c.fillRect(i * bw, h * 0.25, bw + 1, h * 0.5)
			})
			// greyscale ramp
			for (let i = 0; i < 11; i++) {
				const g = Math.round((i / 10) * 255)
				c.fillStyle = `rgb(${g},${g},${g})`
				c.fillRect((i * w) / 11, h * 0.75, w / 11 + 1, h * 0.1)
			}
			// grid
			c.strokeStyle = 'rgba(255,255,255,0.6)'
			c.lineWidth = 1
			const step = Math.max(20, Math.round(Math.min(w, h) / 12))
			for (let x = 0.5; x < w; x += step) {
				c.beginPath()
				c.moveTo(x, 0)
				c.lineTo(x, h)
				c.stroke()
			}
			for (let y = 0.5; y < h; y += step) {
				c.beginPath()
				c.moveTo(0, y)
				c.lineTo(w, y)
				c.stroke()
			}
			// border + diagonals + circle
			c.strokeStyle = '#fff'
			c.lineWidth = 3
			c.strokeRect(1.5, 1.5, w - 3, h - 3)
			c.beginPath()
			c.moveTo(0, 0)
			c.lineTo(w, h)
			c.moveTo(w, 0)
			c.lineTo(0, h)
			c.stroke()
			c.beginPath()
			c.arc(w / 2, h / 2, Math.min(w, h) * 0.4, 0, Math.PI * 2)
			c.stroke()
			// label
			const fs = Math.max(10, Math.round(h * 0.06))
			c.font = `bold ${fs}px system-ui, sans-serif`
			c.textAlign = 'center'
			c.textBaseline = 'middle'
			c.fillStyle = 'rgba(0,0,0,0.75)'
			const label = `${Math.round(w * dpr)} × ${Math.round(h * dpr)}`
			const tw = c.measureText(label).width
			c.fillRect(w / 2 - tw / 2 - fs * 0.5, h * 0.12 - fs * 0.7, tw + fs, fs * 1.4)
			c.fillStyle = '#fff'
			c.fillText(label, w / 2, h * 0.12)
			c.font = `${Math.round(fs * 0.5)}px system-ui, sans-serif`
			c.fillText('TinRoof Timer — test pattern', w / 2, h * 0.92)
		}

		let testKey = ''
		function update(v, s) {
			if (!v || !s) return
			const mode = v.mode
			root.dataset.mode = mode
			root.style.setProperty('--sd-font', FONTS[s.fontFamily] || FONTS.system)
			root.style.background = s.transparentBackground && root.dataset.allowTransparent ? 'transparent' : s.backgroundColor
			content.style.filter = s.brightness < 100 ? `brightness(${s.brightness}%)` : ''

			// TEST pattern
			if (mode === 'TEST') {
				canvas.style.display = 'block'
				content.style.display = 'none'
				const k = root.clientWidth + 'x' + root.clientHeight
				if (k !== testKey) {
					testKey = k
					drawTest()
				}
				return
			}
			canvas.style.display = 'none'
			content.style.display = ''
			testKey = ''

			// main text
			let text = ''
			let color = v.color
			if (mode === 'TIMER') text = v.timerText
			else if (mode === 'CLOCK') {
				text = v.clockText
				color = s.colorWhite
			}
			big.textContent = text
			big.style.color = color
			bigWrap.style.display = mode === 'BLACK' ? 'none' : ''
			big.classList.toggle('sd-flash-over', !!(mode === 'TIMER' && v.overtime && s.flashOvertime))
			big.classList.toggle('sd-paused', mode === 'TIMER' && v.state === 'PAUSED')

			// top bar
			const showClock = mode === 'TIMER' && s.showClockWithTimer
			const showEnd = mode === 'TIMER' && s.showEndTime && v.endText
			const showSpeaker = mode === 'TIMER' && s.showSpeakerName && v.speakerName
			topClock.textContent = showClock ? v.clockText : ''
			topEnd.textContent = showEnd ? (v.target ? 'Until ' : 'Ends ') + v.endText : ''
			speakerLine.textContent = showSpeaker ? v.speakerName : ''
			speakerLine.style.display = showSpeaker ? '' : 'none'
			topbar.style.display = showClock || showEnd ? '' : 'none'
			const showNext = mode === 'TIMER' && s.showNextSpeaker && v.nextSpeakerName
			nextLine.textContent = showNext ? 'Next: ' + v.nextSpeakerName : ''
			nextLine.style.display = showNext ? '' : 'none'

			// progress
			const showProg = mode === 'TIMER' && s.showProgressBar && !v.stopwatch
			progress.style.display = showProg ? '' : 'none'
			if (showProg) {
				bar.style.width = (v.overtime ? 100 : v.progress * 100).toFixed(2) + '%'
				bar.style.background = color
			}

			// message
			const hasMsg = !!v.message
			msgWrap.style.display = hasMsg ? '' : 'none'
			if (!hasMsg) msg.classList.remove('sd-msg-flash')
			main.classList.toggle('sd-has-msg', hasMsg)
			main.classList.toggle('sd-msg-only', hasMsg && mode === 'BLACK')
			if (msg.textContent !== v.message) msg.textContent = v.message
			// New messages flash only if the setting is on; an explicit Flash request always flashes.
			const newMsg = v.messageSeq !== lastSeq && s.messageFlash
			const forced = lastFlashSeq !== null && v.messageFlashSeq !== lastFlashSeq
			if (hasMsg && (newMsg || forced)) {
				msg.classList.remove('sd-msg-flash')
				void msg.offsetWidth // restart animation
				msg.classList.add('sd-msg-flash')
			}
			lastSeq = v.messageSeq
			lastFlashSeq = v.messageFlashSeq

			// sizing (only recomputes when text length / box changes)
			const lenKey = text.replace(/\d/g, '0') + '|' + hasMsg + '|' + mode + '|' + topbar.style.display + '|' + nextLine.style.display + '|' + speakerLine.style.display + '|' + s.fontFamily
			fit(big, bigWrap, lenKey, 0.92, !hasMsg)
			if (hasMsg) fitMessage(msgWrap)
			last = v
		}

		const ro = new ResizeObserver(() => {
			big.dataset.fit = ''
			msgFitKey = ''
			testKey = ''
			if (last.mode) update(last, lastSettings)
		})
		ro.observe(root)
		let lastSettings = null
		return {
			update(v, s) {
				lastSettings = s
				update(v, s)
			},
		}
	}

	window.SpeakerDisplay = { create }
})()
