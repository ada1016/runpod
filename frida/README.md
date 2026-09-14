# Centralized Frida TypeScript Tooling

This directory contains three reusable shell scripts for installing, compiling,
and launching Frida TypeScript agents on macOS. The design keeps Frida and Node
dependencies in one isolated tools directory while keeping each game's source,
compiled agent, and process configuration in its own project directory.

The scripts do not require functions or environment activation in `~/.zshrc`.

## Files

| File | Purpose |
| --- | --- |
| `install-frida-environment.sh` | One-time installation or update of the isolated Python and Node tooling |
| `build.sh` | Compiles one TypeScript agent to JavaScript |
| `hook.sh` | Resolves a game's PID from its project configuration, loads the JavaScript agent, and evaluates configured startup commands |
| `hook_pid.json` | Per-project file, not stored with these central scripts; defines process names and optional startup commands |

## Directory layout

```text
~/Documents/
├── frida-js-tools/
│   ├── node_modules/
│   ├── package.json
│   ├── package-lock.json
│   └── python-env/
└── runpod/
    ├── frida/
    │   ├── install-frida-environment.sh
    │   ├── build.sh
    │   ├── hook.sh
    │   └── README.md
    ├── ls/
    │   ├── legendsummoner.ts
    │   ├── legendsummoner.js
    │   └── hook_pid.json
    └── wd/
        ├── index_hook_config.ts
        ├── index_hook_config.js
        └── hook_pid.json
```

`~/Documents/frida-js-tools` contains shared dependencies only. Game projects
do not need permanent `node_modules`, `package.json`, Python virtual
environments, or shell-profile functions.

## Requirements

- macOS with Bash
- Node.js and npm
- Python 3.11 or newer
- A running Frida-compatible target
- Permission to attach to the target process

If Node.js or a suitable Python version is missing, the installer prints the
suggested Homebrew command.

## Install the environment

Copy the scripts into `~/Documents/runpod/frida`, remove any filename suffixes
added by the browser, and make them executable:

```bash
cd ~/Documents/runpod/frida

mv 'install-frida-environment(2).sh' install-frida-environment.sh
mv 'build(1).sh' build.sh
mv 'hook(2).sh' hook.sh

chmod +x install-frida-environment.sh build.sh hook.sh
./install-frida-environment.sh
```

The installer creates or updates:

```text
~/Documents/frida-js-tools/python-env
~/Documents/frida-js-tools/node_modules
~/Documents/frida-js-tools/package.json
~/Documents/frida-js-tools/package-lock.json
```

Python packages:

- `frida-tools`

Node packages:

- `frida-compile`
- `frida-il2cpp-bridge`

The installer can be run again to update or repair the environment. If an
existing Python environment uses Python older than 3.11, it is preserved with a
timestamped `.backup-...` name before a replacement is created.

## Build an agent

Syntax:

```bash
./build.sh <project-name> <source.ts>
```

Example using a file already in a project:

```bash
cd ~/Documents/runpod/frida
./build.sh wd ~/Documents/runpod/wd/index_hook_config.ts
```

This writes:

```text
~/Documents/runpod/wd/index_hook_config.js
```

Example using a downloaded source:

```bash
./build.sh ls ~/Downloads/legendsummoner.ts
```

If the source is directly under `~/Downloads`, `build.sh` moves it into:

```text
~/Documents/runpod/<project-name>/
```

and compiles it there. If the source is outside `~/Downloads`, it is compiled
in its current directory. The project name is then used for display and for the
destination only when moving a downloaded file.

### Central module resolution

`frida-compile` resolves imports from the source directory's ancestor tree and
does not reliably use `NODE_PATH` alone. During compilation, `build.sh`
temporarily creates:

```text
<project>/node_modules -> ~/Documents/frida-js-tools/node_modules
```

The link is removed automatically on success, failure, or interruption. The
actual packages remain centralized. If the project already has a
`node_modules` entry, the script leaves it untouched and uses it.

## Configure process matching and startup commands

Every compiled JavaScript agent must have a `hook_pid.json` in the same
directory.

Legend Summoner example:

```json
{
  "process_names": [
    "小兵立大功",
    "LegendSummoner"
  ],
  "default_hook": [
    "inc(8)",
    "addExp(2)"
  ]
}
```

WittleDefender example:

```json
{
  "process_names": [
    "胡鬧地牢",
    "WittleDefender"
  ],
  "default_hook": [
    "reroll(96)",
    "expower(3)"
  ]
}
```

### Configuration fields

| Field | Required | Meaning |
| --- | --- | --- |
| `process_names` | Yes | Non-empty array of exact names as printed by `frida-ps`; earlier entries have higher priority |
| `default_hook` | No | Array of JavaScript expressions evaluated by Frida after loading the agent; defaults to an empty array |

Process matching is exact and Unicode-safe. Partial matching is deliberately not
used, so helper processes such as `GameOverlayViewService` cannot match unless
explicitly listed.

If multiple configured processes are running, `hook.sh` prints every match,
then selects the first configured process name. If that name has multiple PIDs,
the lowest PID is selected.

`default_hook` contains executable JavaScript, not passive data. Treat
`hook_pid.json` as trusted code and do not run configurations from untrusted
sources.

## TypeScript agent contract

Commands named in `default_hook` must exist on the agent's global object.
Expose them before asynchronous initialization:

```typescript
const api = {
    inc(value: number) {
        // Update current state.
    },

    addExp(value: number) {
        // Update current state.
    }
};

rpc.exports = api;
Object.assign(globalThis, api);
```

`rpc.exports` alone is not enough for `hook.sh` startup expressions;
`Object.assign(globalThis, api)` (or equivalent global assignments) is
required.

When configuration controls defaults, initialize the TypeScript agent with
neutral or disabled values and do not execute the same default internally:

```typescript
const multipliers = {
    combat: 1,
    exp: 1
};
```

Otherwise a command such as `reroll(96)` may run once inside the agent and a
second time through `hook_pid.json`.

Startup commands execute immediately after the script is loaded. A command that
requires battle-only objects must either:

1. be invoked only when attaching during a battle, or
2. implement its own bounded retry/wait behavior.

For example, the current WittleDefender `reroll()` command retries until its
target object appears, while `expower()` is a one-shot operation requiring
active heroes.

## Hook an agent

Syntax:

```bash
./hook.sh <script.js>
```

Examples:

```bash
cd ~/Documents/runpod/frida

./hook.sh ~/Documents/runpod/ls/legendsummoner.js
./hook.sh ~/Documents/runpod/wd/index_hook_config.js
```

`hook.sh` performs the following sequence:

1. Resolves the JavaScript file to an absolute path.
2. Loads `hook_pid.json` from the JavaScript file's directory.
3. Validates `process_names` and `default_hook`.
4. Runs the isolated `frida-ps`.
5. Matches exact process names and selects a PID by configured priority.
6. Runs Frida through `sudo`.
7. Loads the JavaScript with `-l`.
8. Passes each `default_hook` entry as a separate `-e` expression.
9. Leaves the interactive Frida prompt available for later commands.

Values set later in the prompt can replace current settings when the agent is
implemented as shared mutable state:

```javascript
inc(3)
addExp(4)
expower(2)
```

One-shot mutation commands may accumulate when repeated. Their behavior is
defined by the agent, not by `hook.sh`.

## Use a different centralized environment

All three scripts support `FRIDA_TOOLS_ROOT`:

```bash
FRIDA_TOOLS_ROOT=~/Documents/frida-js-tools-test \
  ./install-frida-environment.sh

FRIDA_TOOLS_ROOT=~/Documents/frida-js-tools-test \
  ./build.sh wd ~/Documents/runpod/wd/index_hook_config.ts

FRIDA_TOOLS_ROOT=~/Documents/frida-js-tools-test \
  ./hook.sh ~/Documents/runpod/wd/index_hook_config.js
```

This is useful when two agents require incompatible versions of
`frida-compile`, `frida-il2cpp-bridge`, or `frida-tools`.

## Troubleshooting

### Source file not found

```text
[-] Source file not found: ...
```

Confirm the path and filename:

```bash
ls -l ~/Documents/runpod/wd/index_hook_config.ts
```

Shell-escape parentheses or quote filenames containing them.

### Cannot find frida-il2cpp-bridge

```text
TS2882: Cannot find module or type declarations for
'frida-il2cpp-bridge'
```

Use the current `build.sh`, which creates the temporary module link. Confirm
that the centralized package exists:

```bash
ls -ld ~/Documents/frida-js-tools/node_modules/frida-il2cpp-bridge
```

If missing, rerun:

```bash
~/Documents/runpod/frida/install-frida-environment.sh
```

Do not fix the resulting cascade of `Cannot find namespace 'Il2Cpp'` errors
one by one; resolving the bridge import normally resolves those errors.

### No process matched

List processes using the same isolated Frida installation:

```bash
~/Documents/frida-js-tools/python-env/bin/frida-ps
```

Copy the target name exactly into `process_names`, including capitalization
and non-ASCII characters.

### hook_pid.json not found

The configuration must be beside the compiled JavaScript, not beside
`hook.sh`:

```text
project/
├── agent.js
└── hook_pid.json
```

### Default command fails

The command must be assigned to `globalThis`, and any required game objects
must exist when it executes. Test it manually in the Frida prompt. For
battle-only commands, attach during battle or add bounded retry logic to the
TypeScript implementation.

### Frida script load timeout

Confirm the selected PID and test loading without expensive initialization.
Large synchronous heap scans or blocking initialization can exceed the CLI load
timeout. Prefer command-triggered discovery or asynchronous, bounded work.

## Guidance for continued development

- Keep installation concerns in `install-frida-environment.sh`.
- Keep compilation and temporary module resolution in `build.sh`.
- Keep process selection and configuration evaluation in `hook.sh`.
- Keep game-specific behavior inside each TypeScript agent and
  `hook_pid.json`.
- Preserve exact process-name matching.
- Keep `hook_pid.json` beside the compiled JavaScript.
- Do not add global shell functions or require activation of the Python
  environment.
- Use executables directly from `$FRIDA_TOOLS_ROOT`.
- Keep startup functions globally callable when referenced by
  `default_hook`.
- Avoid duplicated defaults in both TypeScript and JSON.
- Give startup commands that depend on runtime objects bounded retry behavior,
  or document that the user must attach at the appropriate game state.
- Preserve the temporary symlink cleanup trap in `build.sh`.
- Validate shell changes with `bash -n` and JSON files with
  `python3 -m json.tool`.

## Current command summary

```bash
# One-time setup
cd ~/Documents/runpod/frida
./install-frida-environment.sh

# Compile
./build.sh <project> /absolute/path/to/agent.ts

# Attach, load and apply project defaults
./hook.sh /absolute/path/to/agent.js
```
