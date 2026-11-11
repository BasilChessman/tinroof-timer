# TinRoof Timer

A countdown timer for show operators that runs on Windows and macOS. It speaks the **Irisdown Countdown Timer 2.0 remote-control protocol**, so it works with the existing Bitfocus Companion module *Irisdown: Countdown Timer* without changes. It also comes with its own Companion module that adds more variables and actions.

## ⬇ Download

**[Latest release →](https://github.com/BasilChessman/tinroof-timer/releases/latest)**

| Platform | File |
|---|---|
| Windows installer (recommended) | [TinRoof-Timer-Setup-1.1.2.exe](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.1.2/TinRoof-Timer-Setup-1.1.2.exe) |
| Windows portable (no install) | [TinRoof-Timer-1.1.2-Portable.exe](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.1.2/TinRoof-Timer-1.1.2-Portable.exe) |
| macOS (Apple Silicon and Intel) | [TinRoof-Timer-1.1.2-macOS-Universal.dmg](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.1.2/TinRoof-Timer-1.1.2-macOS-Universal.dmg) |
| Bitfocus Companion module (optional) | [tinroof-timer-companion-module-1.2.0.tgz](https://github.com/BasilChessman/tinroof-timer/releases/download/v1.1.2/tinroof-timer-companion-module-1.2.0.tgz) |

The builds aren't code-signed yet. On Windows, click **More info → Run anyway** the first time. On a Mac, right-click the app and choose **Open**. The [release notes](https://github.com/BasilChessman/tinroof-timer/releases/latest) explain which file to pick.

## Features

| | Irisdown 2.0.17 | TinRoof Timer |
|---|---|---|
| Countdown, overtime, stopwatch (duration 0) | ✓ | ✓ |
| Go / pause / resume / reset, jog while running | ✓ | ✓ (±10 s, ±1 m, ±5 m buttons) |
| 9 presets, click to load, Ctrl/⌘-click to save | ✓ | ✓ saves the **Set time** value (safe while a timer runs), plus labels and keys 1–9 |
| **Count down to a time of day** (e.g. until 10:30) | | ✓ |
| **Speaker presets**: a running order of names with a duration or end time each; click to start, Next/Prev, ✓ when started, CSV import/export | | ✓ |
| Current and next speaker shown on the output | | ✓ |
| Elapsed time and expected end time | ✓ | ✓ |
| Messages (90 characters, flash on arrival) | ✓ | ✓ plus re-flash, quick-message buttons and your own saved messages |
| Display modes Timer / Clock / Black / Test pattern | ✓ | ✓ |
| Full-screen output on a chosen display (any resolution or portrait) | ✓ | ✓ (automatic = first non-primary display) |
| Amber/red warning times, white-only mode, stop at zero | ✓ | ✓ with adjustable colours and seconds-level thresholds |
| Progress bar, clock shown with the timer | ✓ | ✓ plus end time on the output |
| Background colour, transparent background, brightness | ✓ | ✓ |
| Hide the output display | ✓ | ✓ |
| Sounds at set times (negative = overtime) | ✓ | ✓ |
| Esc on the output brings up the UI | ✓ | ✓ |
| Launch at startup, single instance | ✓ | ✓ |
| TCP control on port 61002 | ✓ | ✓ byte-compatible |
| UDP remote-display broadcast on 61003 (`IDCT:` packets) | ✓ | ✓ |
| CDEther/Hive receiver on UDP 36700 | ✓ | ✓ (off by default) |
| Web view on port 8181 (`/` and `/timer.txt`) | ✓ | ✓ live display over SSE |
| UPnP/SSDP discovery in the Network browser | ✓ | ✓ |
| HTTP API (`/api/state`, `/api/command?cmd=GO`) | | ✓ |
| macOS | | ✓ (universal: Intel and Apple Silicon) |

Keyboard shortcuts in the control window: **Space** go/pause · **R** reset · **1–9** load a preset (Ctrl/⌘+number saves the Set time value) · **N / P** start the next or previous speaker (Shift cues without starting) · **+ / −** jog 1 minute · **T / C / B** timer, clock or black · **M** go to the message box · **Esc** clear the message. Ctrl/⌘+1–4 switches display mode from the menu, and Ctrl/⌘+D shows or hides the output.

## Count down to a time of day

Under **Time & Presets → Set time**, switch to **Until time of day** and enter an end time. The timer then counts down to that clock time. If the time has already passed today, it counts to the same time tomorrow. Pausing freezes the display; resuming catches back up with the clock. Jog moves the end time. Setting an ordinary duration switches back to normal countdown.

## Speaker presets

Build the running order in **Settings → Speakers** (or **Edit list…** on the Speakers tab). Each speaker gets a name and either a **duration** or an **end time**. In the main window, click a speaker to load and start their countdown, or Shift-click to load it without starting. **Next ▶** and **◀ Prev** move through the list. Started speakers get a ✓, which **Clear ✓** removes. The current speaker's name, and optionally "Next: …", can be shown on the output.

CSV import and export use one `name, time` row per speaker. The time can be minutes (`10`), `m:ss`, `h:mm:ss`, or `@10:30` for an end time.

## Remote-control protocol (TCP 61002)

Commands are ASCII text and end with `\r`, `\n` or `\r\n`. Replies are `OK`, `IGNORED` (valid command that doesn't apply right now, e.g. pausing a stopped timer) or `ERROR`. All of them end with CRLF.

| Command | Notes |
|---|---|
| `GO` / `PLAY` | Starts the timer or resumes it from pause |
| `PAUSE`, `TOGGLEPAUSE` | |
| `RESET [time]` | `time` is whole minutes (`25`), `hh:mm` or `hh:mm:ss` |
| `JOG <minutes>` | −60 to 60; returns IGNORED if the result would be 0 or less |
| `REMAINING`, `STATE` | Seconds left; `PLAYING`, `PAUSED` or `STOPPED` |
| `DISPLAY TIMER\|CLOCK\|BLACK\|TEST` | |
| `MESSAGE <text>` / `MESSAGE CLEAR` | One pair of surrounding quotes is removed |
| `UPDATES ON\|OFF` | Pushes a line whenever the state changes. While on, all other replies are suppressed. |
| `UPDATEMODE 1\|2` | 1: `00:10:00 STOPPED TIMER` · 2: `TIME=+00:10:00&STATE=STOPPED&DISPLAY=TIMER&MESSAGE=FALSE` |
| `VERSION` | `VERSION 2.0.17.0` (the protocol level, so the Irisdown module switches on mode-2 feedback) |
| **Extensions** | `START <time>`, `JOGSEC <seconds>`, `PRESET <1-9>`, `MESSAGE FLASH`, `APPVERSION`, `HELP` |
| `TARGET <hh:mm[:ss]>` / `TARGETSTART <hh:mm[:ss]>` | Count down to a time of day (24 h, or with am/pm); the first only loads it, the second also starts it |
| `SPEAKER <n\|NEXT\|PREV>` / `CUE <n\|NEXT\|PREV>` | Start a speaker preset, or load it without starting |
| `UPDATEMODE 3` | Mode 2 plus `&SECONDS=&ELAPSED=&DURATION=&END=&WARN=&PROGRESS=&STOPWATCH=&TEXT=&TARGET=&SPEAKER=&SPEAKERNUM=&NEXTSPEAKER=&NEXTSPEAKERNUM=`. The speaker list is also pushed as `SPEAKERS=<url-encoded JSON>` whenever it changes. |

This behaviour was rebuilt from Irisdown's published protocol PDF and checked against the command parser and UDP sender in the shipped `Countdown Timer 2.0.exe` 2.0.17.

## Bitfocus Companion

There are two options:

1. **The existing module.** Add *Irisdown: Countdown Timer* and enter this computer's IP address. All of its actions, feedbacks and variables (`state`, `mode`, `time`, `time_hm`, `time_h`, `time_m`, `time_s`) work.
2. **The TinRoof Timer module** in `companion-module/`. It keeps the Irisdown action and variable IDs and adds more:
   - Variables: `time_signed`, `time_ms`, `time_short`, `remaining_seconds`, `overtime`, `elapsed`, `duration`, `end_time`, `end_time_hm`, `warning`, `progress`, `message`, `message_active`, `stopwatch`, `target_time`, `countdown_to_time`, `speaker_name`, `speaker_number`, `next_speaker_name`, `next_speaker_number`, `speaker_count`, `connected`, plus `speaker_<n>_name`, `speaker_<n>_time` and `speaker_<n>_done` for every speaker in the list (at least 20)
   - Actions: set duration and start, jog in seconds, load preset, flash message, count down to a time of day, start or cue a speaker by number, next and previous speaker, custom command
   - Feedbacks: warning level, traffic-light colours, overtime, counting to a time of day, speaker is current, next or done
   - 86 presets, including 20 speaker buttons that show each speaker's name and time and light up when that speaker is live

   To install it, run `cd companion-module && npm install && npm run package`, then import `tinroof-timer-1.2.0.tgz` in Companion under *Modules → Import module package*.

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
src/main/protocol.js   Irisdown-compatible command parser and UDP packet builders
src/main/network.js    TCP server, UDP broadcast, HTTP web view/API, SSDP
src/main/view.js       formatting, colours, warning levels
src/main/main.js       Electron windows, menus, IPC, settings, sounds
src/renderer/          control UI, output window, web view (shared display.js)
companion-module/      Bitfocus Companion module
```

Not affiliated with Irisdown.
