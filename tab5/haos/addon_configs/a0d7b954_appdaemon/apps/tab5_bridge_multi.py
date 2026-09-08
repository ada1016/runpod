import appdaemon.plugins.hass.hassapi as hass

class Tab5MultiBridge(hass.Hass):
    def initialize(self):
        self.active_tab = "all"

        self.gas_reading_entity = self.args.get(
            "gas_reading_entity",
            "input_text.gas_meter_reading"
        )
        self.gas_submit_button = self.args.get(
            "gas_submit_button",
            "input_button.submit_gas_meter"
        )
        self.gas_status_entity = self.args.get(
            "gas_status_entity",
            "sensor.gas_meter_submission_status"
        )

        self.ac = {
            "brother": self.args["ac_brother"],
            "sister": self.args["ac_sister"],
            "parents": self.args["ac_parents"],
            "living": self.args["ac_living"],
        }
        self.light = {
            "bedroom_window": self.args["light_bedroom_window"],
            "living_room": self.args["light_living_room"],
            "da_head": self.args["light_da_head"],
            "da_foot": self.args["light_da_foot"],
            "da_desk": self.args["light_da_desk"],
            "am_door": self.args["light_am_door"],
            "am_foot": self.args["light_am_foot"],
            "am_desk": self.args["light_am_desk"],
        }

        # Xiaomi Home manual recovery support.
        # All monitored physical light entities are checked for unavailable state.
        self.xiaomi_light_entities = list(self.light.values())
        self.xiaomi_reload_entity = self.args.get(
            "xiaomi_reload_entity",
            self.light["da_head"]
        )
        self.xiaomi_reload_in_progress = False

        da = [self.light["da_head"], self.light["da_foot"], self.light["da_desk"]]
        am = [self.light["am_door"], self.light["am_foot"], self.light["am_desk"]]
        all_lights = da + am + [self.light["bedroom_window"], self.light["living_room"]]

        self.tabs = {
            "all": {
                "acs": [self.ac["brother"], self.ac["sister"], self.ac["parents"], self.ac["living"]],
                "slots": [
                    {"name":"全", "type":"light_group", "entities":all_lights},
                    {"name":"宸", "type":"light_group", "entities":da},
                    {"name":"芹", "type":"light_group", "entities":am},
                    {"name":"", "type":"none", "entities":[]},
                ],
            },
            "parents": {
                "acs": [self.ac["parents"]],
                "slots": [
                    {"name":"窗邊", "type":"light", "entities":[self.light["bedroom_window"]]},
                    {"name":"客廳", "type":"light", "entities":[self.light["living_room"]]},
                    {"name":"", "type":"none", "entities":[]},
                    {"name":"", "type":"none", "entities":[]},
                ],
            },
            "darren": {
                "acs": [self.ac["brother"]],
                "slots": [
                    {"name":"床頭", "type":"light", "entities":[self.light["da_head"]]},
                    {"name":"床尾", "type":"light", "entities":[self.light["da_foot"]]},
                    {"name":"桌", "type":"light", "entities":[self.light["da_desk"]]},
                    {"name":"全", "type":"light_group", "entities":da},
                ],
            },
            "amber": {
                "acs": [self.ac["sister"]],
                "slots": [
                    {"name":"門口", "type":"light", "entities":[self.light["am_door"]]},
                    {"name":"床尾", "type":"light", "entities":[self.light["am_foot"]]},
                    {"name":"桌", "type":"light", "entities":[self.light["am_desk"]]},
                    {"name":"全", "type":"light_group", "entities":am},
                ],
            },
            "gas": {"acs": [], "slots": [{"name":"","type":"none","entities":[]} for _ in range(4)]},
        }

        self.humidity = {
            "all": self.args.get("humidity_all", ""),
            "parents": self.args.get("humidity_parents", ""),
            "darren": self.args.get("humidity_darren", ""),
            "amber": self.args.get("humidity_amber", ""),
        }

        self.listen_event(self._command, "esphome.tab5_command")

        watched = set()
        for tab in self.tabs.values():
            watched.update(tab["acs"])
            for slot in tab["slots"]:
                watched.update(slot["entities"])
        watched.update(v for v in self.humidity.values() if v)
        watched.add(self.gas_status_entity)

        for entity in watched:
            self.listen_state(self._changed, entity, attribute="all")

        self.run_in(self._publish_timer, 1)

    def _press_gas_submit(self, kwargs):
        reading = kwargs.get("reading", "")

        self.log(
            f"Pressing gas-meter Submit for reading {reading}"
        )

        self.call_service(
            "input_button/press",
            entity_id=self.gas_submit_button,
        )

    def _bridge_field(self, value):
        """
        Keep the one-state bridge safe for pipe-delimited parsing.
        """
        if value is None:
            return ""

        value = str(value)
        value = value.replace("|", "/")
        value = value.replace("\r", " ")
        value = value.replace("\n", " ")
        return value.strip()


    def _xiaomi_recovery_snapshot(self):
        unavailable = []

        for entity in self.xiaomi_light_entities:
            state = self.get_state(entity)

            if state in (None, "unknown", "unavailable"):
                unavailable.append(entity)

        if self.xiaomi_reload_in_progress:
            return (
                len(unavailable),
                "reloading",
                "Reload requested... waiting for Xiaomi Home to reconnect devices."
            )

        if unavailable:
            count = len(unavailable)
            noun = "device" if count == 1 else "devices"
            return (
                count,
                "needs_reload",
                f"{count} {noun} unavailable detected. Suggest click Reload to regain full control."
            )

        return (
            0,
            "ok",
            "All monitored devices available. Full control is ready."
        )

    def _finish_xiaomi_reload_check(self, kwargs):
        self.xiaomi_reload_in_progress = False
        self._publish()

    def _publish_timer(self, kwargs):
        self._publish()

    def _changed(self, entity, attribute, old, new, kwargs):
        self._publish()

    def _ac_snapshot(self, entities):
        if not entities:
            return ("", "", "", "")
        snapshots=[]
        for e in entities:
            s=self.get_state(e, attribute="all") or {}
            snapshots.append((s.get("state","unknown"), s.get("attributes",{}) or {}))
        if len(snapshots)==1:
            state,a=snapshots[0]
            return (str(state), str(a.get("fan_mode") or "--"),
                    "--" if a.get("temperature") is None else f'{float(a["temperature"]):.1f}',
                    "--" if a.get("current_temperature") is None else f'{float(a["current_temperature"]):.1f}')
        states=[s for s,_ in snapshots]
        mode="off" if all(s=="off" for s in states) else ("cool" if all(s=="cool" for s in states) else "mixed")
        fans=[a.get("fan_mode") or "--" for _,a in snapshots]
        fan=fans[0] if all(f==fans[0] for f in fans) else "Mixed"
        t=[a.get("temperature") for _,a in snapshots if a.get("temperature") is not None]
        r=[a.get("current_temperature") for _,a in snapshots if a.get("current_temperature") is not None]
        return (mode, fan, "--" if not t else f'{sum(map(float,t))/len(t):.1f}', "--" if not r else f'{sum(map(float,r))/len(r):.1f}')

    def _light_snapshot(self, entities):
        if not entities: return ("0","0")
        ons=[]; br=[]
        for e in entities:
            s=self.get_state(e, attribute="all") or {}
            on=s.get("state")=="on"; a=s.get("attributes",{}) or {}; b=a.get("brightness")
            ons.append(on)
            br.append(round(float(b)*100/255) if b is not None else (100 if on else 0))
        return ("1" if any(ons) else "0", str(max(0,min(100,round(sum(br)/len(br))))))

    def _publish(self):
        tab = self.tabs[self.active_tab]

        # -----------------------------------------------------
        # GAS TAB
        #
        # Fields 0..21 remain compatible with the normal room
        # renderer. Fields 22..28 carry gas status:
        #
        # 22 status
        # 23 message
        # 24 submitted reading
        # 25 company date
        # 26 company reading
        # 27 confirmation bool
        # 28 history contains reading bool
        # -----------------------------------------------------
        if self.active_tab == "gas":
            status_obj = (
                self.get_state(
                    self.gas_status_entity,
                    attribute="all"
                )
                or {}
            )

            status = self._bridge_field(
                status_obj.get("state", "ready")
            )

            attrs = (
                status_obj.get("attributes", {})
                or {}
            )

            message = self._bridge_field(
                attrs.get("message", "Ready")
            )

            reading = self._bridge_field(
                attrs.get("reading", "")
            )

            company_date = self._bridge_field(
                attrs.get("company_date", "")
            )

            company_reading = self._bridge_field(
                attrs.get("company_reading", "")
            )

            confirmation = (
                "1"
                if attrs.get("confirmation", False)
                else "0"
            )

            history_ok = (
                "1"
                if attrs.get(
                    "history_contains_reading",
                    False
                )
                else "0"
            )

            fields = [
                "gas", "", "", "", "", "",
            ]

            for _ in range(4):
                fields += ["", "none", "0", "0"]

            unavailable_count, recovery_state, recovery_message = (
                self._xiaomi_recovery_snapshot()
            )

            fields += [
                status,
                message,
                reading,
                company_date,
                company_reading,
                confirmation,
                history_ok,
                str(unavailable_count),
                recovery_state,
                self._bridge_field(recovery_message),
            ]

            return self._set_bridge(
                "|".join(fields)
            )

        mode, fan, target, room = self._ac_snapshot(
            tab["acs"]
        )

        h = "--"
        he = self.humidity.get(
            self.active_tab,
            ""
        )

        if he:
            try:
                h = (
                    f'{float(self.get_state(he)):.0f}'
                )
            except Exception:
                pass

        fields = [
            self.active_tab,
            mode,
            fan,
            target,
            room,
            h
        ]

        for slot in tab["slots"]:
            on, bri = self._light_snapshot(
                slot["entities"]
            )

            fields += [
                slot["name"],
                slot["type"],
                on,
                bri
            ]

        # Keep one fixed payload shape for ESPHome.
        # Fields 22..28 are gas-reserved. Fields 29..31 are always
        # Xiaomi recovery status for the Settings page.
        unavailable_count, recovery_state, recovery_message = (
            self._xiaomi_recovery_snapshot()
        )

        fields += [
            "", "", "", "", "", "", "",
            str(unavailable_count),
            recovery_state,
            self._bridge_field(recovery_message),
        ]

        self._set_bridge(
            "|".join(fields)
        )

    def _set_bridge(self,payload):
        self.set_state("sensor.tab5_ui_bridge", state=payload,
                       attributes={"friendly_name":"Tab5 UI Bridge","icon":"mdi:tablet-dashboard"})

    def _command(self,event_name,data,kwargs):
        action=str(data.get("action",""))
        if action=="open_tab":
            tab=str(data.get("tab","all"))
            if tab in self.tabs:
                self.active_tab=tab; self._publish()
            return

        if action == "reload_xiaomi":
            if self.xiaomi_reload_in_progress:
                self.log(
                    "Xiaomi Home reload ignored: reload already in progress",
                    level="WARNING"
                )
                return

            self.xiaomi_reload_in_progress = True
            self.log(
                "Manual Xiaomi Home config-entry reload requested from Tab5"
            )
            self._publish()

            self.call_service(
                "homeassistant/reload_config_entry",
                entity_id=self.xiaomi_reload_entity,
            )

            # Give the integration time to reconnect, then publish the
            # actual unavailable/available result. No automatic retry.
            self.run_in(
                self._finish_xiaomi_reload_check,
                8
            )
            return

        if action == "gas_submit":
            reading = str(
                data.get("value", "")
            ).strip()

            # Second layer of double-submit protection.
            current_status = self.get_state(
                self.gas_status_entity
            )

            if current_status == "submitting":
                self.log(
                    "Gas submission ignored: backend is already submitting",
                    level="WARNING"
                )
                return

            if (
                not reading.isdigit()
                or len(reading) > 4
            ):
                self.log(
                    f"Rejected invalid gas meter reading: {reading}",
                    level="WARNING",
                )
                return

            reading = reading.zfill(4)

            self.log(
                f"Gas meter submission requested: {reading}"
            )

            # STEP 1: write the reading first.
            self.call_service(
                "input_text/set_value",
                entity_id=self.gas_reading_entity,
                value=reading,
            )

            # STEP 2: trigger the backend only after HA has had
            # time to commit the input_text state.
            self.run_in(
                self._press_gas_submit,
                0.5,
                reading=reading,
            )

            return

        tab=self.tabs[self.active_tab]; acs=tab["acs"]
        if action=="ac_temp_delta" and acs:
            try: delta=float(data.get("value",0))
            except: return
            targets=[]
            for e in acs:
                try: targets.append(float(self.get_state(e,attribute="temperature")))
                except: pass
            current=sum(targets)/len(targets) if targets else 26.0
            new=max(18.0,min(30.0,current+delta))
            for e in acs: self.call_service("climate/set_temperature", entity_id=e, temperature=new)
        elif action=="ac_fan_auto" and acs:
            for e in acs: self.call_service("climate/set_fan_mode", entity_id=e, fan_mode="Auto")
        elif action=="ac_fan_quiet" and acs:
            for e in acs: self.call_service("climate/set_fan_mode", entity_id=e, fan_mode="Quiet")
        elif action=="ac_power_toggle" and acs:
            all_on=all(self.get_state(e)!="off" for e in acs)
            if all_on:
                for e in acs: self.call_service("climate/turn_off", entity_id=e)
            else:
                for e in acs:
                    self.call_service("climate/set_temperature", entity_id=e, temperature=26.0, hvac_mode="cool")
                    self.call_service("climate/set_fan_mode", entity_id=e, fan_mode="Auto")
        elif action.startswith("slot_"):
            try: idx=int(data.get("slot",-1))
            except: return
            if not (0<=idx<4): return
            entities=tab["slots"][idx]["entities"]
            if not entities: return
            if action=="slot_power":
                service="light/turn_on" if str(data.get("value","")).lower()=="on" else "light/turn_off"
                self.call_service(service, entity_id=entities)
            elif action=="slot_brightness":
                try: pct=max(0,min(100,int(float(data.get("value",0)))))
                except: return
                self.call_service("light/turn_on", entity_id=entities, brightness_pct=pct)
            elif action=="slot_cct":
                try: k=int(float(data.get("value",0)))
                except: return
                self.call_service("light/turn_on", entity_id=entities, color_temp_kelvin=k)
        self.run_in(self._publish_timer,1)

