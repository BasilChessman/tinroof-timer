# TinRoof Timer

Controls **TinRoof Timer** (Windows / macOS) over TCP port 61002. Needs TinRoof Timer 1.5.0 or later.

## Setup
Enter the IP address of the computer running TinRoof Timer. The port is 61002 unless you changed it in
TinRoof Timer → Settings → Network.

## Actions
Go · Pause · Toggle pause · Reset · Reset with new duration · Set duration and start · Jog minutes ·
Jog seconds · Load preset 1–9 · Show message · Clear message · Flash message · Display mode
(Timer / Clock / Black / Test) · Count down to a time of day · Start or cue a speaker by number ·
Next / previous speaker · Custom command

Commands the timer rejects or ignores are noted in the connection's log.

## Feedbacks
State colours (running / paused) · State is… · Display mode is… · Message on screen ·
Warning level is… · Traffic-light colours by warning level · Overtime · Counting down to a time of day ·
Speaker is current / next / done

## Variables
`state`, `mode`, `time`, `time_hm`, `time_h`, `time_m`, `time_s`, `state_raw`, `time_signed`, `time_ms`,
`time_short`, `remaining_seconds`, `overtime`, `elapsed`, `duration`, `end_time`, `end_time_hm`, `warning`,
`progress`, `message_active`, `message`, `stopwatch`, `target_time`, `countdown_to_time`, `speaker_name`,
`speaker_number`, `next_speaker_name`, `next_speaker_number`, `speaker_count`, `connected`, plus
`speaker_<n>_name`, `speaker_<n>_time` and `speaker_<n>_done` for every speaker (at least 20).
