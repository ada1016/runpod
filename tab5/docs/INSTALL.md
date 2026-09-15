# Installation and recovery

Use the commands in the root README from the `tab5` directory. The old `tab5-improvement/experimental/` paths were removed during consolidation.

The canonical source is `esphome/tab5-v4-lab.yaml`. ESPHome `run` compiles and uploads; `upload --file firmware/firmware.ota.bin` uploads the existing image only. Existing local firmware is the all-room release recorded in `firmware/manifest.json`. A fresh clone must build its own image with local secrets.

The current device IP is `192.168.68.16`. OTA uses Wi-Fi even if USB is attached. USB is useful for startup diagnostics; opening its serial port can restart Tab5. Keep the ESP32-P4 main task stack setting at 8192: it fixes the observed NVS startup assertion while preserving normal rollback protection.

After installation, confirm `BUILD MARKER: TAB5_V4_ALL_ROOMS`, HA connection/state reception, and `Boot seems successful`. Test a room control and its real device before group controls.

## Recovery

The private archive in `~/Documents/tab5-backups/` preserves the original source and the previously working Living Room release under `tab5/tab5-improvement/releases/living-room-bootfix/`. Extract into a separate directory to recover its matching YAML, secrets and OTA image. Use the matching release files together. Do not install the failed diagnostic binaries under `failed-2026-09-15/`.

The baseline firmware's identity with the original running V3 image was not verified. The Living Room release was hardware-validated before the all-room release.
