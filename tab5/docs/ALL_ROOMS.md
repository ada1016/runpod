# All rooms and House interaction update

## Coverage

- Living Room: existing interaction pilot generalized to shared logic.
- Parents (爹娘): AC and window light.
- Darren (宸): AC, head/foot/desk lights, and room light group.
- Amber (芹): AC, door/foot/desk lights, and room light group.
- House (全部): all-AC target/fan/power, all-light power/CCT/brightness, and master ALL OFF.

Every AC and light card now has press styling, HA confirmation feedback, freshness gating, and pending-command protection. Layout, themes, gas workflow, original source, and the ESP32-P4 startup stack fix are retained.

## Group semantics

A group command captures its member keys and creates one explicit intent per ready device. Unavailable, missing, or stale members are skipped; they are not silently retried if they return later. The UI shows readiness before a command and confirmation counts afterward, such as `2/3 confirmed; 1 skipped`. A timeout reports the confirmed count plus `check rest`. Skipped members are never counted as successful.

Group power-on/off and ALL OFF send explicit values, not a series of state-dependent toggles. Master ALL OFF handles AC and lights with their respective command types. Its status covers all 12 configured devices.

One device can have one pending intent. An individual device and an overlapping room/house group cannot issue conflicting operations at the same time. Unrelated rooms remain usable. Temperature requests can replace pending temperature requests from the same control group; room and house temperature controls cannot silently overwrite each other's pending intent.

## Temperature

Each AC has its own 350 ms debounce. Navigation never changes a queued target's device. House +/- uses the displayed half-degree-rounded average of ready AC targets (including pending targets from that group), then requests a common new target for those ready members. Other AC settings are unchanged.

## Sliders and rendering

All four room light slots and the whole-house slider protect dragging and pending values. A drag also locks overlapping group/individual commands. Navigation clears obsolete drag locks; a missed release expires after 30 seconds. Reconciliation restores HA-reported values on confirmation or timeout.

House status dots now reflect freshness and pending state. Mixed AC modes/fans are shown as MIXED instead of representing every AC with the first unit's state.

## Compatibility and delivery

No AppDaemon changes are required beyond the already-installed V4 bridge. The command event and per-device sensor protocol are unchanged.

The previous Living Room release and original V3 sources are preserved in the private pre-cleanup archive at `~/Documents/tab5-backups/`.

This all-room update is installed on the physical Tab5. OTA succeeded; USB logs confirm `TAB5_V4_ALL_ROOMS`, successful boot after 60 seconds, and HA V4 state reception. See `ota-all-rooms-upload.log` and `usb-all-rooms-validation.log`. Physical control/UX acceptance remains pending.

## Validation

- Existing C++ state scenarios pass.
- New `tests/test_groups.cpp` passes: partial availability/confirmation/timeout, no late replay to recovered devices, normalized group membership, overlapping-operation locks, independent room debounce, whole-house target accumulation, ALL OFF domain routing, drag locks, reconnect, and stale gating.
- Six project structure tests pass.
- Before cleanup, all 55 original files matched their baseline hashes; they are now preserved in the private archive.
- Full ESPHome 2026.8.2 / ESP-IDF 5.5.5 build: see `build-all-rooms.log` and `firmware/manifest.json`.

Hardware acceptance should cover all four rooms, a partially unavailable light group, master ALL OFF, quick navigation during temperature entry, and dragging a single-light slider while its group also receives updates. These involve real devices and have not been automated.
