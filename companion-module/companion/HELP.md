# TinRoof Timer

Controls **TinRoof Timer** (Windows / macOS) over TCP port 61002. The module also works with
Irisdown Countdown Timer 2.0, but the variables marked "TinRoof Timer" stay empty there.

## Setup
Enter the IP address of the computer running TinRoof Timer. The port is 61002 unless you changed it in
TinRoof Timer → Settings → Network.

## Actions
Go · Pause · Toggle pause · Reset · Reset with new duration · Set duration and start · Jog minutes ·
Jog seconds · Load preset 1–9 · Show message · Clear message · Flash message · Display mode
(Timer / Clock / Black / Test) · Custom command

## Feedbacks
State colours (running / paused) · State is… · Display mode is… · Message on screen ·
Warning level is… · Traffic-light colours by warning level · Overtime

## Variables
`state`, `mode`, `time`, `time_hm`, `time_h`, `time_m`, `time_s` (same as the Irisdown module), plus
`state_raw`, `time_signed`, `time_ms`, `time_short`, `remaining_seconds`, `overtime`, `elapsed`, `duration`,
`end_time`, `warning`, `progress`, `message_active`, `message`, `stopwatch`, `connected`.
