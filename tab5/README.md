# Tab5 V4 — Home Assistant dashboard

Current all-room firmware for M5Stack Tab5: 客廳、爹娘、宸、芹、全部. Built with ESPHome 2026.8.2 / ESP-IDF 5.5.5. Installed and verified through USB logs: `TAB5_V4_ALL_ROOMS`, successful boot after 60 seconds, and HA state reception. Physical device and UX acceptance remains a manual check.

## Project layout

- `esphome/`: YAML, C++ state/feedback code, assets and fonts. Entry point: `tab5-v4-lab.yaml`.
- `appdaemon/`: V4 bridge, merge-only `apps.yaml`, and unchanged gas backend reference.
- `tests/`: offline state, group, bridge and wiring tests.
- `tools/build-requirements.lock`: pinned Python build dependencies.
- `firmware/`: release manifest; compiled images remain local and are excluded from Git because they contain credentials.
- `docs/`: behavior, installation and validation notes.

## Build and install

Run from this `tab5` directory. On a fresh checkout:

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r tools/build-requirements.lock
cp esphome/secrets.example.yaml esphome/secrets.yaml
```

Fill in `esphome/secrets.yaml` locally. Then build and install:

```bash
.venv/bin/esphome run esphome/tab5-v4-lab.yaml --device 192.168.68.16
```

`run` builds before uploading. To install the already-built local release without rebuilding:

```bash
.venv/bin/esphome upload esphome/tab5-v4-lab.yaml --device 192.168.68.16 --file firmware/firmware.ota.bin
```

Read device logs:

```bash
.venv/bin/esphome logs esphome/tab5-v4-lab.yaml --device 192.168.68.16
```

See [installation](docs/INSTALL.md), [room interactions](docs/ALL_ROOMS.md) and [validation](docs/VALIDATION.md).

## AppDaemon

The installed V4 bridge already works with this release. For a fresh installation, copy `appdaemon/tab5_bridge_v4.py` into the HA AppDaemon apps directory, then merge the `tab5_v4_bridge:` block from `appdaemon/apps.yaml` into the existing configuration. Preserve other app entries. `gas_meter.py` is an unchanged reference, not a request to register another gas app. Entity IDs in `apps.yaml` are specific to this home.

## Preservation and Git

The pre-cleanup source, older versions, private configuration and firmware are archived outside the repository in `~/Documents/tab5-backups/`. Only the current source is maintained here. The device identity remains `tab5-v4-lab` for compatibility.

Real secrets, firmware binaries, virtual environments, build caches and raw logs are excluded from Git. Source cleanup does not alter the running Tab5.
