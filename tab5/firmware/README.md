# Current all-room firmware

`manifest.json` records the installed release and exact image/source hashes.

Local files (excluded from Git):

- `firmware.ota.bin`: installed all-room OTA image.
- `firmware.factory.bin`: matching combined image.
- `firmware.elf`: matching debug symbols.

ESPHome firmware embeds private configuration, so build your own images after cloning. Use the root README for build/install commands. Older releases are preserved in the private archive at `~/Documents/tab5-backups/`.
