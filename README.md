# TinRoof Timer

A countdown timer for show operators that runs on Windows and macOS. It comes with its own Bitfocus Companion module for controlling it from Companion or a Stream Deck.

## ⬇ Download

**[Latest release →](https://github.com/BasilChessman/tinroof-timer/releases/latest)**

| Platform | File |
|---|---|
| Windows installer (recommended) | [TinRoof-Timer-Setup-1.5.0.exe](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.5.0/TinRoof-Timer-Setup-1.5.0.exe) |
| Windows portable (no install) | [TinRoof-Timer-1.5.0-Portable.exe](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.5.0/TinRoof-Timer-1.5.0-Portable.exe) |
| macOS (Apple Silicon and Intel) | [TinRoof-Timer-1.5.0-macOS-Universal.dmg](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.5.0/TinRoof-Timer-1.5.0-macOS-Universal.dmg) |
| Bitfocus Companion module (optional) | [tinroof-timer-companion-module-1.5.0.tgz](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.5.0/tinroof-timer-companion-module-1.5.0.tgz) |

The builds aren't code-signed yet. On Windows, click **More info → Run anyway** the first time. On a Mac, right-click the app and choose **Open**. The [release notes](https://github.com/BasilChessman/tinroof-timer/releases/latest) explain which file to pick.

## Features

- Countdown, overtime, and a stopwatch (duration 0)
- Go / pause / resume / reset, and jog while running (±10 s, ±1 m, ±5 m buttons)
- 9 presets with labels: click or press 1–9 to load, Ctrl/⌘-click to save the **Set time** value (safe while a timer runs)
- **Count down to a time of day** (e.g. until 10:30)
- **Speaker presets**: a running order of names with a duration or end time each; click to start, Next/Prev, ✓ when started, CSV import/export
- Current and next speaker shown on the output
- **Run log**: how long each timer actually ran and how far over it went, shown per speaker and exportable as CSV
- Elapsed time and expected end time
- Messages (90 characters) that flash on arrival, re-flash, quick-message buttons, your own saved messages, and an automatic message when the countdown reaches zero
- Display modes Timer / Clock / Black / Test pattern
- Full-screen output on a chosen display, any resolution or portrait (automatic = first non-primary display)
- Amber/red warning times with adjustable colours and seconds-level thresholds, white-only mode, and at zero: count into overtime, *hold the display at 00:00 while overtime is still tracked*, or stop
- Progress bar, clock and end time on the output
- Background colour, transparent background, brightness; hide the output display
- Sounds at set times (negative = overtime)
- Esc on the output brings up the UI
- Launch at startup, single instance
- TCP control on port 61002 (see below) and an HTTP API (`/api/state`, `/api/command?cmd=GO`)
- UDP remote-display broadcast on port 61003 (`IDCT:` packets) with the display's warning colour and overtime flash
- Web view on port 8181 (`/` live display, `/timer.txt`), discoverable in the Windows Network browser (UPnP/SSDP)
- Windows and macOS (universal: Intel and Apple Silicon)

Keyboard shortcuts in the control window: **Space** go/pause · **R** reset · **1–9** load a preset (Ctrl/⌘+number saves the Set time value) · **N / P** start the next or previous speaker (Shift cues without starting) · **+ / −** jog 1 minute · **T / C / B** timer, clock or black · **M** go to the message box · **Esc** clear the message. Ctrl/⌘+1–4 switches display mode from the menu, and Ctrl/⌘+D shows or hides the output.

## Count down to a time of day

Under **Time & Presets → Set time**, switch to **Until time of day** and enter an end time. The timer then counts down to that clock time. If the time has already passed today, it counts to the same time tomorrow. Pausing freezes the display; resuming catches back up with the clock. Jog moves the end time. Setting an ordinary duration switches back to normal countdown.

## Speaker presets

Build the running order in **Settings → Speakers** (or **Edit list…** on the Speakers tab). Each speaker gets a name and either a **duration** or an **end time**. In the main window, click a speaker to load and start their countdown, or Shift-click to load it without starting. **Next ▶** and **◀ Prev** move through the list. Started speakers get a ✓, which **Clear ✓** removes. The current speaker's name, and optionally "Next: …", can be shown on the output.

CSV import and export use one `name, time` row per speaker. The time can be minutes (`10`), `m:ss`, `h:mm:ss`, or `@10:30` for an end time.

## Run log

Every time a timer runs, the **Run log** tab in the main window records who it was for, when it started, the planned time, how long it actually ran and how much it went over. A run starts when you press Go, and ends when you reset, set a new time, start the next speaker, the timer stops at zero, or you quit. Pauses don't count towards the time it ran. The speaker list also shows what each speaker ran (and any overtime) next to their ✓. **Export CSV…** saves the log for giving notes to presenters. The log is kept between sessions, and **Load default settings** doesn't clear it.

While the timer is in overtime, the main window shows **Over by** with the time over, instead of a negative time remaining.

To keep the overtime from the speaker but still record it, set **Settings → Timer → At zero** to **Hold display at zero, keep tracking overtime**. The output display, web view and UDP displays stay at 00:00, while the main window, Companion and the run log carry on counting the overtime. (**Stop the timer** really stops it, so no overtime is recorded.)

## Remote-control protocol (TCP 61002)

Send one command per line, ending with `\r`, `\n` or `\r\n`. Commands aren't case-sensitive. Every command gets a reply line: `OK`, `IGNORED` (a valid command that doesn't apply right now, e.g. pausing a stopped timer), `ERROR`, or the value asked for.

| Command | Notes |
|---|---|
| `GO`, `PAUSE`, `TOGGLEPAUSE` | Start or resume, pause, or toggle |
| `RESET [time]` | Stop and load a time: whole minutes (`25`), `hh:mm` or `hh:mm:ss`. Without a time, reloads the last one. |
| `START <time>` | Load a time and start it |
| `JOG <minutes>`, `JOGSEC <seconds>` | Add or remove time (−60 to 60 minutes, or up to ±3600 seconds); IGNORED if the result would be 0 or less |
| `PRESET <1-9>` | Load a time preset |
| `TARGET <hh:mm[:ss]>` / `TARGETSTART <hh:mm[:ss]>` | Count down to a time of day (24 h, or with am/pm); the first only loads it, the second also starts it |
| `SPEAKER <n\|NEXT\|PREV>` / `CUE <n\|NEXT\|PREV>` | Start a speaker, or load it without starting |
| `DISPLAY TIMER\|CLOCK\|BLACK\|TEST` | Display mode |
| `MESSAGE <text>`, `MESSAGE CLEAR`, `MESSAGE FLASH` | Show (one pair of surrounding quotes is removed), clear or re-flash the message |
| `REMAINING`, `STATE` | Seconds left; `PLAYING`, `PAUSED` or `STOPPED` |
| `VERSION`, `HELP` | App version; list of commands |
| `UPDATES ON\|OFF` | Push the state to this connection whenever it changes (see below) |

With `UPDATES ON`, the timer also sends these lines (replies to commands keep coming as normal):

- `STATE {json}`: sent when anything changes, at most about once a second while running. Fields: `state`, `mode`, `time` (hh:mm:ss), `overtime`, `seconds` (negative in overtime), `elapsed`, `duration`, `end` (expected end time of day), `warn` (`GREEN`, `AMBER`, `RED` or `OVER`), `progress` (0–100), `stopwatch`, `message`, `target` (end time when counting to a time of day), `speaker`, `speakerNumber`, `nextSpeaker`, `nextSpeakerNumber`.
- `SPEAKERS [json]`: the speaker list, sent when it changes: `[{ "n": 1, "name": "…", "time": "00:10:00" or "@10:30", "done": false }]`.

The same commands work over HTTP: `/api/command?cmd=GO`, and `/api/state` returns the full state as JSON.

## Bitfocus Companion

The **TinRoof Timer module** is in `companion-module/` and on the release page. Use the module version that matches the app: module 1.5 and later need TinRoof Timer 1.5 or later. In Companion, add a **TinRoof Timer** connection with the IP address of the computer running the timer. It has:

- Variables: `state`, `mode`, `time`, `time_hm`, `time_h`, `time_m`, `time_s`, `time_signed`, `time_ms`, `time_short`, `remaining_seconds`, `overtime`, `elapsed`, `duration`, `end_time`, `end_time_hm`, `warning`, `progress`, `message`, `message_active`, `stopwatch`, `target_time`, `countdown_to_time`, `speaker_name`, `speaker_number`, `next_speaker_name`, `next_speaker_number`, `speaker_count`, `connected`, plus `speaker_<n>_name`, `speaker_<n>_time` and `speaker_<n>_done` for every speaker in the list (at least 20)
- Actions: go, pause, reset, jog, display mode, messages, set duration and start, jog in seconds, load preset, flash message, count down to a time of day, start or cue a speaker by number, next and previous speaker, custom command
- Feedbacks: warning level, traffic-light colours, overtime, counting to a time of day, speaker is current, next or done
- 86 presets, including 20 speaker buttons that show each speaker's name and time and light up when that speaker is live

To install it, download `tinroof-timer-companion-module-<version>.tgz` from the release (or build it with `cd companion-module && npm install && npm run package`), then import it in Companion under *Modules → Import module package*.

## Build

```sh
npm install
npm start            # run in development
npm test             # protocol / engine tests
npm run dist:mac     # dist/TinRoof Timer-<v>-universal.dmg
npm run dist:win     # dist/TinRoof Timer Setup <v>.exe and the portable .exe (cross-builds fine from a Mac)
```

The builds are **not code-signed**. On macOS, right-click the app and choose *Open* the first time. On Windows, choose *More info → Run anyway* in SmartScreen. On first launch, Windows also asks for firewall permission; allow it on private networks so Companion and the web view can connect.

## Layout

```
src/main/timer.js      timer engine (pure, unit-tested)
src/main/protocol.js   command parser and UDP packet builder
src/main/network.js    TCP server, UDP broadcast, HTTP web view/API, SSDP
src/main/view.js       formatting, colours, warning levels
src/main/main.js       Electron windows, menus, IPC, settings, sounds
src/renderer/          control UI, output window, web view (shared display.js)
companion-module/      Bitfocus Companion module
```
