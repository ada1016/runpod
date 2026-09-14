# WittleDefender Frida Project

This project uses a project-local `Makefile` to coordinate the shared Frida
tooling under `~/Documents/runpod/frida`.

## Project layout

```text
~/Documents/runpod/wd/
├── Makefile
├── README.md
├── wittledefender.ts
├── wittledefender.js
└── hook_pid.json
```

The Makefile defines:

```makefile
PROJECT := wd
AGENT := wittledefender
```

The source must therefore be `wittledefender.ts`; the generated agent is
`wittledefender.js`. Change `AGENT` without an extension if the source is
renamed.

## Help and Make targets

Enter the project:

```bash
cd ~/Documents/runpod/wd
```

Plain `make` displays help and does not build or hook:

```bash
make
make help
```

Available targets:

| Command | Behavior |
| --- | --- |
| `make` / `make help` | Display all targets and descriptions |
| `make all` | Alias for `make build` |
| `make build` | Verify the environment and build only when required |
| `make run` | Build when required, then attach and run configured defaults |
| `make hook` | Attach using the existing JavaScript without rebuilding |
| `make rebuild` | Remove the JavaScript and compile it again |
| `make setup` | Force installation/update of the shared Frida environment |
| `make ensure-env` | Check the environment and install when incomplete |
| `make check` | Validate source, configuration, and helper scripts |
| `make clean` | Remove only `wittledefender.js` |
| `make git-status` | Show Git changes under this project |
| `make git-pull` | Pull repository changes using fast-forward only |
| `make git-push` | Auto-commit this project and push |

## Build and hook workflows

Build only when `wittledefender.js` is missing or older than the TS source:

```bash
make build
```

Build when required, then attach:

```bash
make run
```

Hook the existing JS without rebuilding:

```bash
make hook
```

Force recompilation:

```bash
make rebuild
```

Remove generated JS:

```bash
make clean
```

Run from another directory:

```bash
make -C ~/Documents/runpod/wd run
```

## Environment targets

`make setup` directly runs:

```text
~/Documents/runpod/frida/install-frida-environment.sh
```

It creates or updates the shared environment under:

```text
~/Documents/frida-js-tools/
├── node_modules/
├── package.json
├── package-lock.json
└── python-env/
```

Normal build and run targets use `ensure-env`, which invokes the installer
only when Frida, `frida-ps`, `frida-compile`, or
`frida-il2cpp-bridge` is missing.

Validate project files without compiling:

```bash
make check
make ensure-env
```

## hook_pid.json

`hook_pid.json` must be beside `wittledefender.js`:

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

### process_names

- Values must exactly match names shown by `frida-ps`.
- Matching is case-sensitive and Unicode-safe.
- Partial matches are not used.
- Earlier names have higher priority.
- If multiple processes match, the launcher prints them and selects the
  highest-priority name, then the lowest PID for duplicate names.

List processes with:

```bash
~/Documents/frida-js-tools/python-env/bin/frida-ps
```

### default_hook

Each entry is a JavaScript expression evaluated after the compiled agent loads:

```json
"default_hook": [
  "reroll(96)",
  "expower(3)"
]
```

The TypeScript functions must be globally callable:

```typescript
rpc.exports = api;
Object.assign(globalThis, api);
```

`rpc.exports` alone does not make a function available to the launcher's
evaluation expressions.

The current WittleDefender agent exposes:

| Expression | Purpose |
| --- | --- |
| `reroll(n)` | Set normal-stage extra rerolls; its implementation retries while waiting for the target |
| `creroll()` / `creroll(n)` | Set active Crusade rerolls |
| `creroll(false)` | Restore the saved Crusade reroll value |
| `revive()` | Set the current battle's AD revive count |
| `inc(percent)` | Add ATK, DEF, and outgoing-healing percentage |
| `heal(percent)` | Add outgoing-healing percentage only |
| `expower(multiplier)` | Multiply the EX-weapon energy charge factor |
| `read()` | Print current hero attributes |
| `god()` / `god(seconds)` | Add the owned invincibility contribution |
| `god(false)` | Remove the owned invincibility contribution |
| `traceend()` / `traceend(false)` | Enable or disable battle-end request tracing |
| `traceendstatus()` | Display battle-end trace status |

`default_hook` executes immediately. `reroll()` has bounded retry behavior,
but `expower()` requires active heroes and is one-shot. To make the configured
`expower(3)` succeed, attach during a battle or invoke it again in the Frida
prompt after heroes exist:

```javascript
expower(3)
```

Review `hook_pid.json` before running it because `default_hook` contains
executable JavaScript expressions.

Validate the JSON:

```bash
python3 -m json.tool ~/Documents/runpod/wd/hook_pid.json
```

## Git targets

Show changes limited to this project:

```bash
make git-status
```

Pull only when the whole repository is clean:

```bash
make git-pull
```

This uses `git pull --ff-only`. Git pull operates on the entire
`~/Documents/runpod` repository and can update sibling folders.

Stage this project, create an automatic commit, and push:

```bash
make git-push
```

The commit message format is:

```text
wd update YYYY-MM-DD HH:MM:SS
```

`git-push` exits successfully without committing when this project has no
changes. Build, hooking, and publication remain separate; `make run` never
commits or pushes.

## Common workflows

After editing TypeScript:

```bash
make run
```

After changing only `hook_pid.json`:

```bash
make hook
```

After restarting the game:

```bash
make hook
```

Review and publish:

```bash
make git-status
make git-push
```

Update before beginning work:

```bash
make git-pull
```

## Troubleshooting

If the source is not found, confirm:

```bash
ls -l ~/Documents/runpod/wd/wittledefender.ts
```

If `hook_pid.json` is missing, place it in:

```text
~/Documents/runpod/wd/hook_pid.json
```

If no process matches, compare the exact configured names with:

```bash
~/Documents/frida-js-tools/python-env/bin/frida-ps
```

If a default command fails, verify that the command is assigned to
`globalThis` and that its required battle objects exist.

## Quick reference

```bash
cd ~/Documents/runpod/wd

make             # Show help
make help        # Show help
make build       # Build only when required
make all         # Alias for build
make run         # Build when required, then hook
make hook        # Hook existing JS
make rebuild     # Force regeneration
make setup       # Force environment install/update
make check       # Validate project files
make ensure-env  # Validate/install shared environment
make clean       # Remove generated JS
make git-status  # Show project changes
make git-pull    # Fast-forward-only repository pull
make git-push    # Auto-commit this project and push
```
