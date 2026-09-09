import appdaemon.plugins.hass.hassapi as hass


class Tab5MultiBridge(hass.Hass):
    """
    Tab5 V3 thin bridge.

    ESPHome owns:
      - pages / navigation
      - room layout
      - room slot names/types
      - room group membership
      - local UI rendering
      - local UI state cache

    AppDaemon owns only:
      - logical device key -> HA entity_id mapping
      - generic HA service calls
      - normalized device-state packets
      - gas transport
      - Xiaomi manual recovery
    """

    BRIDGE_ENTITY = "sensor.tab5_ui_bridge"
    PROTOCOL_VERSION = "3"

    def initialize(self):
        self.gas_reading_entity = self.args.get(
            "gas_reading_entity",
            "input_text.gas_meter_reading",
        )
        self.gas_submit_button = self.args.get(
            "gas_submit_button",
            "input_button.submit_gas_meter",
        )
        self.gas_status_entity = self.args.get(
            "gas_status_entity",
            "sensor.gas_meter_submission_status",
        )

        # Logical key -> HA entity_id.
        # This is intentionally the only device abstraction in Python.
        self.devices = {
            "ac_darren": self.args["ac_brother"],
            "ac_amber": self.args["ac_sister"],
            "ac_parents": self.args["ac_parents"],
            "ac_living": self.args["ac_living"],

            "light_bedroom_window": self.args["light_bedroom_window"],
            "light_living_room": self.args["light_living_room"],
            "light_da_head": self.args["light_da_head"],
            "light_da_foot": self.args["light_da_foot"],
            "light_da_desk": self.args["light_da_desk"],
            "light_am_door": self.args["light_am_door"],
            "light_am_foot": self.args["light_am_foot"],
            "light_am_desk": self.args["light_am_desk"],
        }

        # Optional environmental sensors.
        optional = {
            "humidity_living": self.args.get("humidity_living", ""),
            "humidity_parents": self.args.get("humidity_parents", ""),
            "humidity_darren": self.args.get("humidity_darren", ""),
            "humidity_amber": self.args.get("humidity_amber", ""),
        }
        for key, entity in optional.items():
            if entity:
                self.devices[key] = entity

        self.reverse_devices = {
            entity_id: logical_key
            for logical_key, entity_id in self.devices.items()
            if entity_id
        }

        self.xiaomi_light_keys = [
            "light_bedroom_window",
            "light_living_room",
            "light_da_head",
            "light_da_foot",
            "light_da_desk",
            "light_am_door",
            "light_am_foot",
            "light_am_desk",
        ]

        self.xiaomi_reload_entity = self.args.get(
            "xiaomi_reload_entity",
            self.devices["light_da_head"],
        )
        self.xiaomi_reload_in_progress = False
        self._seq = 0

        self.listen_event(self._command, "esphome.tab5_command")

        for entity_id in self.reverse_devices:
            self.listen_state(
                self._device_changed,
                entity_id,
                attribute="all",
            )

        self.listen_state(
            self._gas_changed,
            self.gas_status_entity,
            attribute="all",
        )

        self.run_in(self._bootstrap_publish, 1)

        self.log("Tab5 V3 thin bridge READY")
        self.log("Room/page/group definitions are local on ESPHome.")

    # -----------------------------------------------------------------
    # Transport
    # -----------------------------------------------------------------
    def _next_seq(self):
        self._seq += 1
        return str(self._seq)

    def _field(self, value, max_len=72):
        if value is None:
            return ""
        value = (
            str(value)
            .replace("|", "/")
            .replace("\r", " ")
            .replace("\n", " ")
            .strip()
        )
        return value[:max_len]

    def _set_bridge(self, fields):
        payload = "|".join(
            [self.PROTOCOL_VERSION] + list(fields) + [self._next_seq()]
        )

        # HA state is intentionally kept compact.
        if len(payload) > 250:
            self.log(
                f"Bridge packet too long ({len(payload)}); truncating",
                level="WARNING",
            )
            payload = payload[:250]

        self.set_state(
            self.BRIDGE_ENTITY,
            state=payload,
            attributes={
                "friendly_name": "Tab5 UI Bridge",
                "icon": "mdi:tablet-dashboard",
                "protocol": "Tab5 V3 Local UI Thin Bridge",
            },
        )

    def _bootstrap_publish(self, kwargs):
        delay = 0.0
        for key in self.devices:
            self.run_in(
                self._publish_device_timer,
                delay,
                device_key=key,
            )
            delay += 0.10

        self.run_in(self._publish_recovery_timer, delay + 0.10)
        self.run_in(self._publish_gas_timer, delay + 0.20)

    def _publish_device_timer(self, kwargs):
        self._publish_device(kwargs["device_key"])

    def _publish_recovery_timer(self, kwargs):
        self._publish_recovery()

    def _publish_gas_timer(self, kwargs):
        self._publish_gas()

    # -----------------------------------------------------------------
    # Logical device state -> normalized packet
    # -----------------------------------------------------------------
    def _publish_device(self, device_key):
        entity_id = self.devices.get(device_key)
        if not entity_id:
            return

        obj = self.get_state(entity_id, attribute="all") or {}
        state = str(obj.get("state", "unknown"))
        attrs = obj.get("attributes", {}) or {}

        available = (
            "0"
            if state in ("unknown", "unavailable", "none", "None")
            else "1"
        )

        if entity_id.startswith("climate."):
            fan = self._field(attrs.get("fan_mode") or "--", 16)

            target = "--"
            current = "--"

            try:
                if attrs.get("temperature") is not None:
                    target = f'{float(attrs["temperature"]):.1f}'
            except (TypeError, ValueError):
                pass

            try:
                if attrs.get("current_temperature") is not None:
                    current = f'{float(attrs["current_temperature"]):.1f}'
            except (TypeError, ValueError):
                pass

            self._set_bridge(
                [
                    "D",
                    device_key,
                    "climate",
                    self._field(state, 16),
                    fan,
                    target,
                    current,
                    available,
                ]
            )
            return

        if entity_id.startswith("light."):
            is_on = state == "on"

            brightness = attrs.get("brightness")
            if brightness is not None:
                try:
                    pct = round(float(brightness) * 100.0 / 255.0)
                except (TypeError, ValueError):
                    pct = 100 if is_on else 0
            else:
                pct = 100 if is_on else 0

            pct = max(0, min(100, pct))

            self._set_bridge(
                [
                    "D",
                    device_key,
                    "light",
                    "1" if is_on else "0",
                    str(pct),
                    available,
                ]
            )
            return

        # Optional generic numeric/environment sensor.
        self._set_bridge(
            [
                "D",
                device_key,
                "sensor",
                self._field(state, 24),
                available,
            ]
        )

    def _device_changed(self, entity, attribute, old, new, kwargs):
        device_key = self.reverse_devices.get(entity)
        if device_key:
            self._publish_device(device_key)

        if device_key in self.xiaomi_light_keys:
            self.run_in(self._publish_recovery_timer, 0.15)

    # -----------------------------------------------------------------
    # Gas / recovery transport
    # -----------------------------------------------------------------
    def _publish_gas(self):
        obj = self.get_state(self.gas_status_entity, attribute="all") or {}
        status = self._field(obj.get("state", "ready"), 16)
        attrs = obj.get("attributes", {}) or {}

        self._set_bridge(
            [
                "G",
                status,
                self._field(attrs.get("message", "Ready"), 72),
                self._field(attrs.get("reading", ""), 8),
                self._field(attrs.get("company_date", ""), 32),
                self._field(attrs.get("company_reading", ""), 8),
                "1" if attrs.get("confirmation", False) else "0",
                "1" if attrs.get("history_contains_reading", False) else "0",
            ]
        )

    def _gas_changed(self, entity, attribute, old, new, kwargs):
        self._publish_gas()

    def _xiaomi_recovery_snapshot(self):
        unavailable = []

        for key in self.xiaomi_light_keys:
            entity_id = self.devices.get(key)
            if not entity_id:
                continue

            state = self.get_state(entity_id)
            if state in (None, "unknown", "unavailable"):
                unavailable.append(key)

        if self.xiaomi_reload_in_progress:
            return (
                len(unavailable),
                "reloading",
                "Reload requested... waiting for Xiaomi Home to reconnect devices.",
            )

        if unavailable:
            count = len(unavailable)
            noun = "device" if count == 1 else "devices"
            return (
                count,
                "needs_reload",
                f"{count} {noun} unavailable detected. Suggest click Reload to regain full control.",
            )

        return (
            0,
            "ok",
            "All monitored devices available. Full control is ready.",
        )

    def _publish_recovery(self):
        count, state, message = self._xiaomi_recovery_snapshot()
        self._set_bridge(
            [
                "X",
                str(count),
                state,
                self._field(message, 110),
            ]
        )

    # -----------------------------------------------------------------
    # Generic command helpers
    # -----------------------------------------------------------------
    def _resolve_device(self, device_key):
        entity_id = self.devices.get(str(device_key).strip())
        if not entity_id:
            self.log(
                f"Unknown logical device key: {device_key}",
                level="WARNING",
            )
        return entity_id

    def _resolve_device_list(self, raw):
        result = []
        seen = set()

        for key in str(raw or "").split(","):
            key = key.strip()
            if not key or key in seen:
                continue

            entity_id = self._resolve_device(key)
            if entity_id:
                result.append((key, entity_id))
                seen.add(key)

        return result

    def _press_gas_submit(self, kwargs):
        reading = kwargs.get("reading", "")
        self.log(f"Pressing gas-meter Submit for reading {reading}")
        self.call_service(
            "input_button/press",
            entity_id=self.gas_submit_button,
        )

    def _finish_xiaomi_reload_check(self, kwargs):
        self.xiaomi_reload_in_progress = False
        self._publish_recovery()
        self._bootstrap_publish({})

    # -----------------------------------------------------------------
    # Commands generated by ESPHome YAML
    # -----------------------------------------------------------------
    def _command(self, event_name, data, kwargs):
        action = str(data.get("action", "")).strip()

        if action == "refresh_all":
            self._bootstrap_publish({})
            return

        if action == "refresh_devices":
            for key, _entity in self._resolve_device_list(
                data.get("devices", "")
            ):
                self._publish_device(key)
            return

        if action == "reload_xiaomi":
            if self.xiaomi_reload_in_progress:
                return

            self.xiaomi_reload_in_progress = True
            self._publish_recovery()

            self.log("Manual Xiaomi Home config-entry reload requested from Tab5")
            self.call_service(
                "homeassistant/reload_config_entry",
                entity_id=self.xiaomi_reload_entity,
            )
            self.run_in(self._finish_xiaomi_reload_check, 8)
            return

        # -------------------------------------------------------------
        # Gas stays standalone.
        # -------------------------------------------------------------
        if action == "gas_submit":
            reading = str(data.get("value", "")).strip()

            if self.get_state(self.gas_status_entity) == "submitting":
                return

            if not reading.isdigit() or len(reading) > 4:
                self.log(
                    f"Rejected invalid gas meter reading: {reading}",
                    level="WARNING",
                )
                return

            reading = reading.zfill(4)

            self.call_service(
                "input_text/set_value",
                entity_id=self.gas_reading_entity,
                value=reading,
            )
            self.run_in(
                self._press_gas_submit,
                0.5,
                reading=reading,
            )
            return

        # -------------------------------------------------------------
        # AC: ESPHome may supply one logical key (device) or a CSV list
        # (devices). This keeps room and whole-house AC UI on the same
        # generic command path; group membership remains in ESPHome.
        # -------------------------------------------------------------
        if action.startswith("ac_"):
            raw_devices = data.get("devices", "") or data.get("device", "")
            resolved = self._resolve_device_list(raw_devices)
            if not resolved:
                return

            if action == "ac_temp_delta":
                try:
                    delta = float(data.get("value", 0))
                except (TypeError, ValueError):
                    return

                for key, entity_id in resolved:
                    try:
                        current = float(self.get_state(entity_id, attribute="temperature"))
                    except (TypeError, ValueError):
                        current = 26.0
                    self.call_service(
                        "climate/set_temperature",
                        entity_id=entity_id,
                        temperature=max(18.0, min(30.0, current + delta)),
                    )

            elif action == "ac_set_temperature":
                try:
                    target = float(data.get("value", 26.0))
                except (TypeError, ValueError):
                    return

                target = max(18.0, min(30.0, target))
                self.call_service(
                    "climate/set_temperature",
                    entity_id=[entity_id for _key, entity_id in resolved],
                    temperature=target,
                )

            elif action == "ac_fan_auto":
                self.call_service(
                    "climate/set_fan_mode",
                    entity_id=[entity_id for _key, entity_id in resolved],
                    fan_mode="Auto",
                )

            elif action == "ac_fan_quiet":
                self.call_service(
                    "climate/set_fan_mode",
                    entity_id=[entity_id for _key, entity_id in resolved],
                    fan_mode="Quiet",
                )

            elif action == "ac_power_toggle":
                any_on = any(
                    self.get_state(entity_id) != "off"
                    for _key, entity_id in resolved
                )
                if any_on:
                    self.call_service(
                        "climate/turn_off",
                        entity_id=[entity_id for _key, entity_id in resolved],
                    )
                else:
                    for _key, entity_id in resolved:
                        self.call_service(
                            "climate/set_temperature",
                            entity_id=entity_id,
                            temperature=26.0,
                            hvac_mode="cool",
                        )
                        self.call_service(
                            "climate/set_fan_mode",
                            entity_id=entity_id,
                            fan_mode="Auto",
                        )

            for key, _entity in resolved:
                self.run_in(
                    self._publish_device_timer,
                    0.5,
                    device_key=key,
                )
            return

        # -------------------------------------------------------------
        # Light commands: ESPHome supplies one or several logical keys.
        # Group membership is NOT stored in Python.
        # -------------------------------------------------------------
        if action.startswith("light_"):
            resolved = self._resolve_device_list(data.get("devices", ""))
            if not resolved:
                return

            entity_ids = [entity_id for _key, entity_id in resolved]

            if action == "light_power":
                service = (
                    "light/turn_on"
                    if str(data.get("value", "")).lower() == "on"
                    else "light/turn_off"
                )
                self.call_service(service, entity_id=entity_ids)

            elif action == "light_brightness":
                try:
                    pct = int(float(data.get("value", 0)))
                except (TypeError, ValueError):
                    return

                self.call_service(
                    "light/turn_on",
                    entity_id=entity_ids,
                    brightness_pct=max(0, min(100, pct)),
                )

            elif action == "light_cct":
                try:
                    kelvin = int(float(data.get("value", 0)))
                except (TypeError, ValueError):
                    return

                self.call_service(
                    "light/turn_on",
                    entity_id=entity_ids,
                    color_temp_kelvin=kelvin,
                )

            elif action == "light_group_toggle":
                any_on = any(
                    self.get_state(entity_id) == "on"
                    for entity_id in entity_ids
                )
                self.call_service(
                    "light/turn_off" if any_on else "light/turn_on",
                    entity_id=entity_ids,
                )

            for key, _entity in resolved:
                self.run_in(
                    self._publish_device_timer,
                    0.5,
                    device_key=key,
                )
            return

        # -------------------------------------------------------------
        # Aggregate AC group. Membership comes from ESPHome command.
        # -------------------------------------------------------------
        if action == "ac_group_toggle":
            resolved = self._resolve_device_list(data.get("devices", ""))
            if not resolved:
                return

            any_on = any(
                self.get_state(entity_id) != "off"
                for _key, entity_id in resolved
            )

            for key, entity_id in resolved:
                if any_on:
                    self.call_service(
                        "climate/turn_off",
                        entity_id=entity_id,
                    )
                else:
                    self.call_service(
                        "climate/set_temperature",
                        entity_id=entity_id,
                        temperature=26.0,
                        hvac_mode="cool",
                    )
                    self.call_service(
                        "climate/set_fan_mode",
                        entity_id=entity_id,
                        fan_mode="Auto",
                    )

                self.run_in(
                    self._publish_device_timer,
                    0.5,
                    device_key=key,
                )
            return

        # -------------------------------------------------------------
        # House ALL OFF. ESPHome supplies both groups.
        # -------------------------------------------------------------
        if action == "all_off":
            ac_devices = self._resolve_device_list(
                data.get("ac_devices", "")
            )
            light_devices = self._resolve_device_list(
                data.get("light_devices", "")
            )

            for key, entity_id in ac_devices:
                self.call_service(
                    "climate/turn_off",
                    entity_id=entity_id,
                )
                self.run_in(
                    self._publish_device_timer,
                    0.5,
                    device_key=key,
                )

            if light_devices:
                self.call_service(
                    "light/turn_off",
                    entity_id=[
                        entity_id
                        for _key, entity_id in light_devices
                    ],
                )

                for key, _entity_id in light_devices:
                    self.run_in(
                        self._publish_device_timer,
                        0.5,
                        device_key=key,
                    )
            return

        self.log(
            f"Unknown Tab5 V3 action: {action}",
            level="WARNING",
        )
