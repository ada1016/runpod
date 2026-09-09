# Tab5 Home Control V2 --- System Design 

> Purpose: This document is a specification for another
> GPT/engineer to understand the current Tab5 design, architecture
> decisions, file responsibilities, constraints, and intended behavior
> without reconstructing the full conversation.
>

------------------------------------------------------------------------

## 1. Project Goal

Tab5 is an ESPHome + LVGL touchscreen used as a home-control panel.

The main UX problem in the previous design was that Tab5 relied too
heavily on AppDaemon to provide/render the currently selected tab's
device state. Switching tabs could therefore involve a network round
trip, and occasionally the UI would not render/update when navigating.

The V2 goal is:

-   All normal UI/pages are created and rendered locally on Tab5.
-   Switching tabs must be immediate and must not depend on an AppDaemon
    `open_tab` round trip.
-   AppDaemon remains the abstraction/bridge between logical Tab5
    controls and Home Assistant entities.
-   Home Assistant remains responsible for actual smart-device
    state/integrations/automation.
-   Gas reporting remains a separate AppDaemon application and must
    **not** be converted into a normal HA/Room device.
-   Existing font names, asset names, and asset paths must remain
    unchanged.
-   Avoid functional regressions while refactoring.

------------------------------------------------------------------------

## 2. Core Domain Model

The smart-home hierarchy is:

``` text
House
├── Living Room
│   ├── AC
│   └── Lights
├── Parents Room
│   ├── AC
│   └── Lights
├── Darren Room
│   ├── AC
│   └── Lights
└── Amber Room
    ├── AC
    └── Lights
```

Important rules:

1.  **Living Room is a normal Room**, exactly like Parents/Darren/Amber.
2.  A Room contains:
    -   AC
    -   Light(s)
3.  Gas is **not** part of House/Room/device hierarchy.
4.  `LightGroup` is not treated as a separate device class. It is a collection of lights in each room. 
5.  "All lights in a room" is a virtual collection/action over the Light
    devices belonging to that room.
6.  "All AC" / "All Lights" / "All Off" at House level are aggregate
    actions over Room devices.

The primary device types are therefore conceptually:

``` text
AC
Light
```

Gas is a standalone application/workflow, not a smart-home device class.

------------------------------------------------------------------------

## 3. UI Mental Model

Top-level navigation is intended to represent:

``` text
[ 全屋 ] [ 客廳 ] [ 爹娘 ] [ 宸 ] [ 芹 ] [ 瓦斯 ] [ ⚙ ]
```

Semantics:

  Tab    Meaning
  ------ --------------------------------------
  全屋   House overview + whole-house actions
  客廳   Living Room detailed control
  爹娘   Parents Room detailed control
  宸     Darren Room detailed control
  芹     Amber Room detailed control
  瓦斯   Standalone gas-meter reporting app
  ⚙      Settings

### House page

House is an aggregation/dashboard page, not another Room.

Its job is:

-   Whole-house overview
-   All lights control
-   All AC control
-   All-off action
-   Room summaries

It should not become a wall of every individual device control.

Conceptually:

``` text
HOUSE

[ ALL OFF ]   [ ALL LIGHTS ]   [ ALL AC ]

Living    AC status     Light aggregate
Parents   AC status     Light aggregate
Darren    AC status     Light aggregate
Amber     AC status     Light aggregate
```

### Room page

Room pages are for detailed control.

Each Room uses the same fixed slot contract:

``` text
ROOM
├── AC_SLOT
├── LIGHT_SLOT_1
├── LIGHT_SLOT_2
├── LIGHT_SLOT_3
└── LIGHT_SLOT_4
```

`LIGHT_SLOT_4` can be used as the room-wide "全部燈 / All Lights"
virtual action rather than requiring a Home Assistant light-group
entity.

The intent is that users can customize a Room mostly by editing its Room
configuration rather than rewriting LVGL behavior.

Example Darren mapping:

``` text
AC_SLOT       -> Darren AC
LIGHT_SLOT_1  -> Bed Head
LIGHT_SLOT_2  -> Bed Foot
LIGHT_SLOT_3  -> Desk
LIGHT_SLOT_4  -> All Darren Lights
```

------------------------------------------------------------------------

## 4. Local-First Rendering

This is the most important V2 UX change.

### Old behavior

Conceptually:

``` text
Tap tab
  ↓
send open_tab
  ↓
AppDaemon selects tab
  ↓
AppDaemon builds current-tab state
  ↓
HA sensor update
  ↓
Tab5 receives state
  ↓
UI renders
```

This made navigation dependent on network/backend timing.

### V2 behavior

``` text
Tap tab
  ↓
Tab5 changes active page locally
  ↓
Tab5 immediately renders that page using cached state
  ↓
AppDaemon state updates continue asynchronously
```

AppDaemon updates data; it no longer determines whether a page can be
displayed.

### Required safety behavior

When switching rooms, Tab5 must **never display the previous room's
device state as if it belonged to the newly selected room**.

------------------------------------------------------------------------


## 5. Device UI Responsibility

Device UI behavior should be reusable.

Conceptually:

``` text
AC model/state
    ↓
AC UI component

Light model/state
    ↓
Light UI component
```

### AC component responsibilities

Typical AC UI/readings:

-   Power
-   Current room temperature
-   Target temperature
-   HVAC mode
-   Fan mode
-   Availability/status
-   Temperature +/-
-   Future AC-specific controls such as swing/quiet/eco should be added
    here once and inherited by all AC instances.

### Light component responsibilities

Typical Light UI/readings:

-   Name
-   On/off state
-   Brightness
-   Availability/status
-   Touch behavior
-   Future shared behavior such as long press, brightness popup,
    transition, etc.

### Why this separation matters

Changing AC behavior should not require editing:

``` text
living_room
parents_room
darren_room
amber_room
```

Likewise, adding a shared Light feature should be implemented once in
the Light component.

Room files/configuration should mainly determine **which device occupies
which slot and what label is shown**.


------------------------------------------------------------------------

## 6. AppDaemon Role

AppDaemon remains a backend abstraction layer.

Responsibilities:

``` text
Tab5 logical command
        ↓
AppDaemon
        ↓
logical device → HA entity mapping
        ↓
HA service call
```

And in reverse:

``` text
HA entity state
        ↓
AppDaemon
        ↓
normalize state
        ↓
room/house state snapshot
        ↓
Tab5 local cache
```

AppDaemon should **not** own page rendering or require an `active_tab`
to decide what Tab5 is allowed to display.

------------------------------------------------------------------------

## 7. Compatibility With Existing `apps.yaml`

The bridge filename/class are intentionally kept compatible with the
existing configuration:

``` yaml
tab5_multi_bridge:
  module: tab5_bridge_multi
  class: Tab5MultiBridge
```

The V2 Python bridge should therefore remain:

``` text
tab5_bridge_multi.py
class Tab5MultiBridge
```

This avoids unnecessary `apps.yaml` migration.

Existing entity mapping names should also be accepted where practical,
including names such as:

``` text
ac_brother
ac_sister
ac_parents
ac_living

light_bedroom_window
light_living_room
light_da_head
light_da_foot
light_da_desk
light_am_door
light_am_foot
light_am_desk
```

Internally these can be interpreted using the new Room model, for
example:

``` text
ac_brother -> Darren AC
ac_sister  -> Amber AC
ac_parents -> Parents AC
ac_living  -> Living AC
```

The goal is architectural improvement without forcing unnecessary HA
entity renames.

------------------------------------------------------------------------

## 8. Gas Architecture --- Important Constraint

Gas must remain isolated from the normal Room/HA device model.

The existing gas process is considered good and should be preserved.


------------------------------------------------------------------------

## 11. Intended Tab5 File Structure

Long-term modular structure:

``` text
tab5/
│
├── tab5.yaml
│
│
├── ui/
│   ├── root.yaml
│   ├── navigation.yaml
│   ├── theme.yaml
│   │
│   ├── devices/
│   │   ├── ac.yaml
│   │   └── light.yaml
│   │
│   ├── rooms/
│   │   ├── living_room.yaml
│   │   ├── parents_room.yaml
│   │   ├── darren_room.yaml
│   │   └── amber_room.yaml
│   │
│   ├── pages/
│   │   └── house.yaml
│   │
│   ├── actions/
│   │   ├── room_all_lights.yaml
│   │   ├── all_ac.yaml
│   │   └── house_all_off.yaml
│   │
│   ├── apps/
│   │   └── gas/
│   │       └── gas_page.yaml
│   │
│   └── settings/
│       └── settings_page.yaml
│
└── bridge/
    ├── device_state.yaml
    ├── device_command.yaml
    ├── gas_bridge.yaml
    └── connection.yaml
```

This is the target responsibility structure. Migration should be
conservative: do not break a working 2,000+ line LVGL frontend merely to
achieve a prettier directory tree.

------------------------------------------------------------------------

## 12. Tab5 File Responsibilities

### `tab5.yaml`

Bootstrap/main configuration.

Should eventually mostly load:

-   hardware
-   UI
-   bridge/state logic

Avoid putting every room's device behavior directly in the main file.


### `ui/navigation.yaml`

Owns local navigation only.

No AppDaemon round trip should be required to change visible page.

### `ui/theme.yaml`

Owns local theme behavior.

Existing themes should remain local to Tab5.

### `ui/devices/ac.yaml`

Reusable AC presentation/control behavior.

### `ui/devices/light.yaml`

Reusable Light presentation/control behavior.

### `ui/rooms/*.yaml`

Customization point for each Room:

-   Room name
-   AC slot assignment
-   Light slot assignments
-   Labels
-   enabled/disabled slots

Do not duplicate generic AC/Light implementation here.

### `ui/pages/house.yaml`

House overview and aggregate actions.

### `ui/apps/gas/gas_page.yaml`

Gas **UI only**. Backend processing stays in Python.

### `bridge/device_state.yaml`

Receives normalized state and updates local caches/models.

### `bridge/device_command.yaml`

Sends logical device/action/value commands.

### `bridge/gas_bridge.yaml`

Transport between Gas UI and existing gas backend only.

------------------------------------------------------------------------

## 13. Home Assistant Responsibilities

Home Assistant remains responsible for:

-   Actual Daikin AC entities
-   Actual Xiaomi Light entities
-   Integrations
-   Actual device state
-   Automations
-   Scripts/scenes
-   Scheduling

Tab5 should not replace Home Assistant as the automation/scheduler
engine.

Gas is not required to become a normal HA device/entity model merely for
architectural symmetry.

------------------------------------------------------------------------

## 14. AppDaemon File Responsibilities

Expected files:

``` text
/config/appdaemon/apps/
├── apps.yaml
├── tab5_bridge_multi.py
└── gas_meter.py
```

Additional internal modules may be introduced later if useful, such as
registry/router/state helpers, but do not split merely for aesthetics.

### `tab5_bridge_multi.py`

Must retain:

``` text
module filename: tab5_bridge_multi.py
class: Tab5MultiBridge
```

Responsibilities:

-   Logical device mapping
-   Command routing
-   HA state listeners
-   State normalization
-   Room snapshot publication
-   House aggregate snapshot publication
-   Gas UI transport into the existing gas workflow
-   Recovery/connection bridge behavior as needed

Should no longer use current active tab as the core rendering
architecture.

### `apps.yaml`

Keep current configuration style and existing mapping names when
possible.

### `gas_meter.py`

Keep the existing working implementation.

Owns gas-company-specific behavior and secrets-dependent backend
processing.

------------------------------------------------------------------------

## 15. Existing Asset / Font Compatibility

**Do not rename existing font or asset names/paths.**

Known assets that must remain compatible include:

``` text
assets/DaYong.png
assets/all.png
assets/papamama.png
assets/darren.png
assets/amber.png
assets/gas.png
```

Known font path:

``` text
fonts/tab5_icons.ttf
```

Known IDs/names used by the existing frontend include:

``` text
img_dayong
img_tab_all
img_tab_papamama
img_tab_darren
img_tab_amber
img_tab_gas

fa_24
fa_42
fa_64
fa_brands_64
icon_nav_84
fa_104
```

When refactoring, preserve these unless the user explicitly approves a
rename.

------------------------------------------------------------------------

## 16. Current Compile Constraint / ESPHome C++ Rule

ESPHome's ESP-IDF build currently has C++ exception handling disabled.

Do **not** use patterns such as:

``` cpp
try {
    value = std::stoi(text);
} catch (...) {
    value = 0;
}
```

This caused:

``` text
error: exception handling disabled, use '-fexceptions' to enable
```

Do not enable exceptions merely for parsing.

Use exception-free parsing, e.g.:

``` cpp
int b = 0;
if (sscanf(bri.c_str(), "%d", &b) != 1) b = 0;
b = std::max(0, std::min(100, b));
```

There are also LVGL enum bitwise-operation compiler warnings involving
`LV_PART_* | LV_STATE_*`. These were warnings rather than the cause of
the compile failure and can be cleaned separately.

