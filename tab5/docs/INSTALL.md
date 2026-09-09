# Install

1. Back up current working ESPHome/AppDaemon files.
2. Keep existing `/config/esphome/assets/` and `/config/esphome/fonts/`.
3. Replace AppDaemon:
   - apps.yaml
   - tab5_bridge_multi.py
   - gas_meter.py
4. Restart/reload AppDaemon.
5. Confirm log contains: `Tab5 V2 local-first bridge READY`.
6. Copy `esphome/tab5.yaml` to your active ESPHome filename, e.g. `/config/esphome/tab5-8668.yaml`.
7. Validate/compile with ESPHome 2026.8.
8. Install firmware.
9. Test tab navigation first, then controls.

Expected V2 behavior:
- Tabs change page immediately.
- Room page renders cached state without waiting for AppDaemon.
- If cache is missing, it shows SYNCING rather than another room's state.
