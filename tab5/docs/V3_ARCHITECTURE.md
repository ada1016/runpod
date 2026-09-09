# V3 architecture

```text
Tab5 / ESPHome
  room YAML packages
  navigation
  shared AC/light widgets
  local device-state cache
  local rendering
        |
        | logical command
        v
AppDaemon thin bridge
  logical key -> HA entity_id
  generic HA service call
        |
        v
Home Assistant
        |
        v
Physical device
```

A room package can be edited without modifying Python as long as it references
logical device keys already mapped in `apps.yaml` / `tab5_bridge_multi.py`.

Group membership is local. Example Darren "全":

`light_da_head,light_da_foot,light_da_desk`

The Python bridge receives that list and resolves each logical key. It does not know
that those lights belong to Darren's room.
