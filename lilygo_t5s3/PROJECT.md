# LILYGO T5 E-Paper S3 Lite — Project Handoff

## Purpose

This document is the handoff/context file for a new ChatGPT Work conversation dedicated to building a new Home Assistant controller for the **LILYGO T5 E-Paper S3 Lite**.

The existing M5Stack Tab5 implementation is already working. It is the **functional reference and specification**, not the codebase to modify.

The new LILYGO implementation should reproduce the useful functionality and UI concepts of Tab5, but should be redesigned properly for an ESP32-S3 e-paper device.

---

## Workspace and File-Access Model

ChatGPT Work will be given access to the following local workspace:

```text
~/Documents/runpod/
├── tab5/              # existing working Tab5 project — REFERENCE / READ-ONLY
└── lilygo-t5/         # new LILYGO project — GPT MAY CREATE/CHANGE FILES HERE
```

### Critical rules

1. **`tab5/` is the authoritative reference implementation.**
   - Inspect and read files directly from this directory.
   - Use it to understand current functionality, UI behavior, room definitions, logical device keys, AppDaemon protocol, Home Assistant mappings, fonts/icons, actions, and design decisions.
   - Do **not** modify, rename, delete, reorganize, or generate files inside `tab5/` unless the user explicitly requests a Tab5 change.

2. **All new implementation work belongs under `lilygo-t5/`.**
   - ChatGPT may create directories, source files, documentation, tests, build files, and generated project files here.
   - Do not mix LILYGO source into `tab5/`.
   - Do not copy the whole Tab5 project into `lilygo-t5/`; reuse concepts and behavior, not its ESPHome/LVGL implementation wholesale.

3. Because ChatGPT has direct workspace access, **do not ask the user to ZIP or repeatedly upload Tab5 files** when the required information is available in `tab5/`.
   - Inspect the reference files directly.
   - If something genuinely cannot be accessed, explain exactly which file/path is needed.

4. Treat the current contents of `tab5/` as more authoritative than descriptions in this document whenever implementation details differ.

---

# Project Objective

Build a new Home Assistant touchscreen controller using:

**LILYGO T5 E-Paper S3 Lite**

This is a separate project from the existing M5Stack Tab5 controller.

The objective is to reproduce essentially all useful Tab5 functionality and the same overall user experience, while redesigning the implementation and visual interface for:

- ESP32-S3
- e-paper
- GT911 touch
- 540×960 portrait layout (confirm exact hardware/display characteristics during Phase 0)
- partial refresh
- grayscale/black-and-white presentation
- low memory fragmentation
- deterministic behavior
- long-running reliability
- appropriate power management

Do **not** mechanically convert the ESPHome YAML.

---

# Preferred Technology

The default implementation direction is:

**PlatformIO + native C/C++**

Native C++ is preferred so the project has direct control over:

- e-paper display driver
- partial/full refresh
- dirty regions
- refresh scheduling
- ghosting management
- GT911 touch
- PSRAM/RAM usage
- Wi-Fi
- communication with the existing backend
- power/sleep behavior
- watchdog/recovery behavior

ESPHome/LVGL should not be assumed to be the final implementation simply because Tab5 uses them.

If investigation reveals a strong technical reason to use a different architecture, discuss it with the user before changing direction.

---

# Existing Tab5 System

The working Tab5 implementation uses approximately:

- M5Stack Tab5 engineering sample
- ESP32-P4
- ESPHome
- LVGL
- 720×1280 portrait LCD
- GT911 touch
- Home Assistant
- AppDaemon
- local room/device definitions
- logical device keys
- V3 local-first communication architecture

The Tab5 project is the production/reference implementation.

Study the actual files under:

```text
~/Documents/runpod/tab5/
```

before making assumptions about its behavior.

---

# Existing System Architecture

Conceptually:

```text
Home Assistant
       |
   AppDaemon
       |
 V3 logical protocol
       |
     Tab5
 ESPHome/LVGL
```

Tab5 keeps UI structure and room definitions locally.

AppDaemon acts primarily as a bridge between logical device names and actual Home Assistant entity IDs.

Examples of logical keys include:

```text
ac_living
ac_parents
ac_darren
ac_amber

light_living_room
light_bedroom_window

light_da_head
light_da_foot
light_da_desk

light_am_door
light_am_foot
light_am_desk

temperature_living
temperature_parents
temperature_darren
temperature_amber

humidity_living
humidity_parents
humidity_darren
humidity_amber

ac_humidity_living
ac_humidity_parents
ac_humidity_darren
ac_humidity_amber
```

The V3 protocol includes packets similar to:

```text
Climate:
3|D|key|climate|state|fan|target|current|available|seq

Light:
3|D|key|light|on|brightness|available|seq

Sensor:
3|D|key|sensor|state|available|seq
```

There are also Gas and Xiaomi-recovery messages.

**Inspect the current AppDaemon/Tab5 source for the authoritative protocol.**

---

# Initial LILYGO Backend Strategy

Do **not** replace AppDaemon during initial development.

The initial architecture should remain:

```text
                 Home Assistant
                       |
                   AppDaemon
                       |
                logical protocol
                 /           \
                /             \
       Tab5 ESPHome        LILYGO C++
        existing             new
```

This lets the existing Tab5 remain operational while LILYGO is developed.

Reuse the existing logical-device abstraction and protocol where practical.

Only after the LILYGO implementation is mature should the project separately evaluate whether AppDaemon remains useful or whether direct Home Assistant communication would be preferable.

---

# Rooms

There are four primary rooms:

- Living
- Parents
- Darren
- Amber

The exact current definitions should be read from `tab5/`.

At a high level:

### Living
- AC
- living-room light
- Xiaomi temperature
- Xiaomi humidity
- Daikin humidity

### Parents
- AC
- bedroom/window light
- Xiaomi temperature
- Xiaomi humidity
- Daikin humidity

### Darren
- AC
- head light
- foot light
- desk light
- All Lights group
- Xiaomi temperature
- Xiaomi humidity
- Daikin humidity

### Amber
- AC
- door light
- foot light
- desk light
- All Lights group
- Xiaomi temperature
- Xiaomi humidity
- Daikin humidity

Room definitions in the new implementation should primarily be **data/configuration**, not duplicated page implementations.

---

# AC Behavior to Preserve

Current room AC behavior includes:

### OFF → ON
- Cool mode
- Fan Auto
- Target 26°C

### ON → OFF

### Temperature
- +/- 0.5°C
- clamp to 18–30°C

### Fan
- Auto
- Quiet

### HVAC
- Cool

The room AC status represents information similar to:

- AC state
- fan state
- Daikin current/indoor temperature
- Daikin humidity

The separate environmental display uses Xiaomi:

- temperature
- humidity

Inspect the current Tab5 implementation for exact behavior.

---

# House / ALL Page

The existing Tab5 has a House/ALL page containing:

1. Combined control of all four ACs.
2. Whole-house light group.
3. Large master ALL OFF control.
4. Four room status tiles:
   - Living
   - Parents
   - Darren
   - Amber

## House AC target behavior

House target temperature is:

**average of available AC target temperatures, rounded to nearest 0.5°C.**

House +/- does not simply increment every AC from its individual target.

Instead:

```text
current house average
        +/- 0.5
           |
           v
absolute target sent to ALL four ACs
```

This intentionally causes all AC targets to converge.

Do not display `MIXED` as the House target.

## House lights

Whole-house light controls should remain usable if at least one valid light member exists.

An unavailable light must not disable the entire group.

## Master OFF

The House page includes a master ALL OFF command for all relevant ACs and lights.

Read the current Tab5 files for exact membership and command behavior.

---

# Other Existing Functionality

The current Tab5 project contains functionality including:

- room navigation
- House/ALL page
- Settings page
- runtime themes
- AC controls
- light controls
- grouped lights
- environmental sensors
- device availability handling
- local state caching
- Home Assistant/AppDaemon bridge
- command handling
- status rendering
- Gas meter UI/backend
- Xiaomi integration recovery/reload
- battery/status UI
- fonts and custom icons

The LILYGO should eventually reproduce the useful functionality where appropriate.

LCD-specific behavior should be redesigned when it does not make sense on e-paper.

---

# E-Paper UI Design Principles

Do not design the LILYGO as though it were an LCD.

The UI should be optimized around:

- partial refresh
- dirty rectangles / dirty widgets
- minimal unnecessary redraw
- avoiding full-screen refresh where possible
- sensible periodic full refresh for ghosting control
- clear monochrome/grayscale state indication
- touch responsiveness
- deterministic rendering
- avoiding animations that cause unnecessary refreshes
- stable memory use

Color themes from Tab5 should not be copied literally.

Use e-paper-appropriate visual states such as:

- black/white inversion
- borders
- line weights
- grayscale
- fill patterns
- icon state
- typography

Preserve the information hierarchy and usability rather than pixel-for-pixel LCD appearance.

---

# Preferred UI Architecture

A purpose-built native C++ UI is preferred over automatically reproducing the LVGL hierarchy.

Concepts such as the following are appropriate:

```text
App
DisplayManager
TouchManager
RefreshScheduler
UIManager
Page
RoomPage
HousePage
SettingsPage
Widget
DeviceModel
ClimateState
LightState
SensorState
Transport
CommandQueue
```

A widget should ideally know:

- bounds
- current state
- whether it is dirty
- how to render itself
- how to handle touch

A state update should conceptually work like:

```text
HA/AppDaemon update
        |
        v
update local device model
        |
        v
identify affected widget(s)
        |
        v
mark dirty
        |
        v
renderer processes dirty region(s)
        |
        v
partial e-paper refresh
```

Do not redraw the whole display for every Home Assistant state packet.

Do not perform display refresh directly inside network callbacks.

---

# Reliability Requirements

Reliability is more important than cleverness.

Prefer:

- fixed/static structures where practical
- minimal heap allocation during normal operation
- minimal dynamic `String` churn
- clear ownership/lifetime of objects
- no blocking network operations in rendering
- no display updates directly from network callbacks
- command/event queues where appropriate
- watchdog-friendly code
- robust Wi-Fi reconnect
- robust backend reconnect
- stale-state handling
- device availability handling
- predictable refresh scheduling
- clear serial logging
- safe recovery after communication failures

Keep these concerns separated:

```text
network communication
device state/model
command processing
touch processing
UI rendering
display refresh
power management
```

---

# Suggested Project Structure

All new code should be under:

```text
~/Documents/runpod/lilygo-t5/
```

A possible structure is:

```text
lilygo-t5/
├── platformio.ini
├── PROJECT.md
├── README.md
│
├── src/
│   ├── main.cpp
│   ├── app.cpp
│   │
│   ├── hardware/
│   │   ├── display.cpp
│   │   ├── touch.cpp
│   │   ├── power.cpp
│   │   └── rtc.cpp
│   │
│   ├── ui/
│   │   ├── ui_manager.cpp
│   │   ├── refresh_scheduler.cpp
│   │   ├── room_page.cpp
│   │   ├── house_page.cpp
│   │   ├── settings_page.cpp
│   │   └── widgets/
│   │
│   ├── devices/
│   │   ├── device_model.cpp
│   │   ├── climate.cpp
│   │   ├── light.cpp
│   │   └── sensor.cpp
│   │
│   └── transport/
│       └── ha_bridge.cpp
│
├── include/
├── assets/
├── test/
└── docs/
```

This is a starting proposal, not a rigid requirement.

Improve it if investigation shows a cleaner architecture.

---

# Development Phases

Do **not** attempt the complete Tab5 port in one step.

## Phase 0 — Hardware Bring-Up

First prove the LILYGO hardware independently of the Home Assistant UI.

Verify:

- correct board/framework configuration
- reliable boot
- serial logging
- PSRAM
- Wi-Fi
- e-paper full refresh
- e-paper partial refresh
- grayscale capability
- GT911 touch
- correct touch coordinate mapping
- portrait orientation
- fonts/icons
- battery/power information if supported
- RTC if useful
- repeated refresh stability
- long-running stability

Use current official/reference LILYGO code and libraries where appropriate.

Do not build the complete HA UI before display/touch hardware is proven.

## Phase 1 — Darren Room

Implement only Darren first:

- Darren AC
- Xiaomi temperature
- Xiaomi humidity
- Daikin humidity
- head light
- foot light
- desk light
- All Lights

Connect this to the existing AppDaemon/V3 backend.

Prove:

- initial state
- state updates
- availability
- touch commands
- command acknowledgement/state convergence
- reconnect behavior
- partial refresh behavior

## Phase 2 — Remaining Rooms

Add:

- Living
- Parents
- Amber

Use shared page/widget implementation driven by room configuration.

## Phase 3 — House / ALL

Implement the existing aggregate behavior and master controls.

## Phase 4 — Settings and Remaining Useful Features

Port/rethink appropriate Tab5 functions such as:

- settings
- gas meter
- Xiaomi recovery
- battery/power UI
- other useful status functionality

Only include features that make sense on e-paper.

## Phase 5 — Optimization

Focus on:

- dirty-region efficiency
- ghosting management
- full-refresh policy
- sleep/power
- reconnect/recovery
- memory stability
- watchdog behavior
- long-duration testing

## Phase 6 — Backend Evaluation

Only after LILYGO is mature:

Evaluate whether to:

- keep AppDaemon/V3, or
- communicate more directly with Home Assistant.

This is not part of initial migration.

---

# Source-Control and Change Discipline

The user prefers controlled, source-control-friendly work.

Follow these rules:

1. One controlled architectural/change step at a time.
2. Preserve known-good milestones.
3. Compile/test after meaningful changes.
4. Do not modify unrelated working functionality.
5. Prefer complete canonical files when making significant code changes.
6. If a required reference file exists in `tab5/`, inspect it instead of asking the user to paste it.
7. If a needed detail cannot be determined from available files, ask rather than inventing it.
8. Diagnose failures from actual build/runtime logs.
9. Keep `tab5/` untouched unless explicitly authorized.
10. Put all LILYGO implementation files under `lilygo-t5/`.

---

# First Task for a New Chat/Work Session

When beginning this project:

### Step 1 — Inspect, do not modify

Inspect:

```text
~/Documents/runpod/tab5/
```

Study enough of the project to understand:

- directory structure
- main ESPHome configuration
- UI pages
- room definitions
- device widgets
- actions
- AppDaemon files
- V3 packet parsing/generation
- logical key → HA entity mappings
- House aggregation behavior
- Gas implementation
- Xiaomi recovery
- fonts/icons/assets
- settings/themes
- current documentation

Do not modify `tab5/`.

### Step 2 — Classify the existing implementation

Produce a concise architecture analysis separating:

**A. Concepts/behavior to reuse**
- logical device model
- room definitions
- command semantics
- aggregate behavior
- backend protocol
- state/availability concepts

**B. Logic that may be reusable with adaptation**
- packet parsing
- caching concepts
- command construction
- configuration data

**C. Tab5-specific implementation that should not be ported directly**
- ESPHome YAML mechanics
- LVGL object definitions
- LCD redraw assumptions
- color/theme implementation
- Tab5 hardware configuration

### Step 3 — Verify LILYGO hardware/toolchain

Confirm the exact hardware revision/specification and appropriate current:

- PlatformIO board/framework setup
- LILYGO reference repository
- e-paper driver/library
- GT911 touch support
- PSRAM configuration
- display orientation/resolution
- partial-refresh support
- grayscale support
- battery/power interfaces

Do not guess hardware pin mappings when authoritative reference code is available.

### Step 4 — Propose architecture

Based on the actual Tab5 source and confirmed LILYGO hardware, propose the native C++ architecture and concrete initial directory/file structure under:

```text
~/Documents/runpod/lilygo-t5/
```

### Step 5 — Agree on Phase 0 before building application features

Do not immediately implement the entire application.

Begin with a small, testable Phase 0 hardware baseline.

---

# Definition of Success

The project succeeds when the LILYGO T5 E-Paper S3 Lite provides the same important Home Assistant control experience as the working Tab5 system while being architected specifically for e-paper.

The target is **functional equivalence, not source-code equivalence and not pixel-for-pixel LCD reproduction**.

The existing Tab5 remains operational and serves as the reference throughout development.

```text
~/Documents/runpod/tab5/       = working reference, read-only
~/Documents/runpod/lilygo-t5/  = new implementation, writable
```
