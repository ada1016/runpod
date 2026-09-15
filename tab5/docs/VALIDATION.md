# Validation

## Installed release

- ESPHome 2026.8.2 / ESP-IDF 5.5.5; config hash `0x8d72b220`.
- Build marker `TAB5_V4_ALL_ROOMS`.
- OTA successful; USB confirms successful boot after 60 seconds and ongoing HA V4 state reception.
- Physical device actions and full UX acceptance remain manual.
- Raw build/USB logs are retained locally and in the private backup, excluded from Git.

## Offline checks

Run from the root:

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
c++ -std=c++17 tests/test_state.cpp -o /tmp/tab5-test-state && /tmp/tab5-test-state
c++ -std=c++17 tests/test_groups.cpp -o /tmp/tab5-test-groups && /tmp/tab5-test-groups
.venv/bin/esphome config esphome/tab5-v4-lab.yaml
```

Tests cover ordering, freshness, timeout, confirmation, partial groups, overlapping commands, independent temperature debounce, sliders, reconnect and bridge behavior. The gas backend is checked against its original SHA-256, avoiding a duplicate source tree.

## Startup fix

USB reproduced `esp_task_stack_is_sane_cache_disabled()` during NVS initialization. The default main task stack was allocated in ESP32-P4 SPM, which this flash safety check does not accept. `CONFIG_ESP_MAIN_TASK_STACK_SIZE: "8192"` prevents that allocation. Flash safety assertions and OTA rollback stay enabled. Both the Living Room and all-room releases subsequently booted successfully.
