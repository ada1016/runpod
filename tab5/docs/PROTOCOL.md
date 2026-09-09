# V2 bridge protocol

Single HA state entity: `sensor.tab5_ui_bridge`

## Room
`2|R|room|mode|fan|target|temp|humidity|ac_available|`
then 4 x:
`name|type|on|brightness|available|`
then `seq`

## House
`2|H|`
then 4 x:
`room|ac_mode|lights_on|light_available|`
order: living, parents, darren, amber
then `seq`

## Gas
`2|G|status|message|reading|company_date|company_reading|confirmation|history_ok|seq`

## Xiaomi recovery
`2|X|unavailable_count|state|message|seq`

## Commands
Room actions carry explicit `room`:
- ac_temp_delta
- ac_fan_auto
- ac_fan_quiet
- ac_power_toggle
- slot_power
- slot_brightness
- slot_cct

Asynchronous refresh:
- refresh_room
- refresh_house
- refresh_gas
- refresh_all

House:
- house_all_off
- house_all_lights_toggle
- house_all_ac_toggle

Standalone:
- gas_submit
- reload_xiaomi
