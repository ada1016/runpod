# Tab5 V2 Local-First Redesign

Built from the user-supplied baseline:
- tab5_mono(8).yaml
- tab5_bridge_multi(4).py
- apps(4).yaml
- gas_meter(4).py (canonical 1040-line gas backend)

## Important
`appdaemon/gas_meter.py` is copied byte-for-byte from the supplied baseline.

## Main V2 changes
- Navigation renders locally on Tab5.
- Living Room is a normal Room.
- Room state is cached locally.
- No `open_tab` dependency.
- Missing cache shows SYNCING instead of stale previous-room data.
- AppDaemon publishes keyed Room/House/Gas/Recovery packets through the existing single `sensor.tab5_ui_bridge`.
- Room commands carry explicit `room`.
- House is an aggregate page with ALL OFF / ALL LIGHTS / ALL AC.
- Room slot 4 is a virtual all-lights collection.
- Gas remains a standalone workflow.

## Conservative migration
The 2,000+ line working LVGL frontend remains in `esphome/tab5.yaml` for this first V2 baseline. The requested modular directories are included as responsibility boundaries, not as active ESPHome packages yet.

Keep your existing:
- assets/DaYong.png
- assets/all.png
- assets/papamama.png
- assets/darren.png
- assets/amber.png
- assets/gas.png
- fonts/tab5_icons.ttf
