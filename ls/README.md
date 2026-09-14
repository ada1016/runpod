# Legend Summoner Frida Project

This project uses a project-local `Makefile` to coordinate the shared Frida
tooling under `~/Documents/runpod/frida`.

## Project layout

```text
~/Documents/runpod/ls/
├── Makefile
├── legendsummoner.ts
├── legendsummoner.js
└── hook_pid.json
```

The Makefile expects:

```makefile
PROJECT := ls
AGENT := legendsummoner
```

Therefore:

- the TypeScript source must be named `legendsummoner.ts`;
- the generated agent is `legendsummoner.js`; and
- `hook_pid.json` must be in the same directory as the generated JavaScript.

If the agent has a different filename, change `AGENT` in the Makefile. Do not
include `.ts` or `.js` in the value.

## Running Make

Enter the project directory:

```bash
cd ~/Documents/runpod/ls
```

Alternatively, run any target from another directory with:

```bash
make -C ~/Documents/runpod/ls <target>
```

Plain `make` now displays the help menu. It does not build or hook:

```bash
make
```

The same menu can be requested explicitly:

```bash
make help
```

## Make targets

| Command | Behavior |
| --- | --- |
| `make` / `make help` | Display the available targets and descriptions |
| `make all` | Alias for `make build` |
| `make build` | Verify the environment and build only when required |
| `make run` | Build when required, then attach Frida and execute configured defaults |
| `make hook` | Attach using the existing JavaScript without rebuilding |
| `make rebuild` | Remove the generated JavaScript and compile it again |
| `make setup` | Force installation/update of the shared Frida environment |
| `make ensure-env` | Check the shared environment and install only when incomplete |
| `make check` | Validate required source, configuration, and helper scripts |
| `make clean` | Remove only the generated `legendsummoner.js` |
| `make git-status` | Show Git changes under the `ls` project |
| `make git-pull` | Pull repository changes using fast-forward only |
| `make git-push` | Commit `ls` changes with an automatic message and push |

### Display help

```bash
make
```

or:

```bash
make help
```

The help output is generated from the `##` descriptions in the Makefile, so a
new public target should be written in this form:

```makefile
target-name: prerequisites ## Description displayed by make help
	# recipe
```

### Build

```bash
make build
```

Make compiles when:

- `legendsummoner.js` does not exist; or
- `legendsummoner.ts` is newer than `legendsummoner.js`.

When both files exist and the JavaScript is current, Make does not compile it
again.

The alias below has the same behavior:

```bash
make all
```

### Build and hook

```bash
make run
```

This performs the normal complete workflow:

1. check the shared Frida environment;
2. install it if required;
3. validate project files;
4. compile the TypeScript if required;
5. call the central `hook.sh`;
6. find the game process using `hook_pid.json`;
7. load `legendsummoner.js`; and
8. execute every configured `default_hook` expression.

The terminal remains attached to the interactive Frida prompt until Frida is
exited.

### Hook without rebuilding

```bash
make hook
```

Use this when:

- `legendsummoner.js` is already current;
- only `hook_pid.json` changed; or
- the game was restarted and the same compiled agent should be attached again.

This target fails with an explanation when `legendsummoner.js` is missing.

### Force a rebuild

```bash
make rebuild
```

This runs `make clean` followed by `make build`. It is useful when dependency
or compiler changes require regeneration even though the TypeScript timestamp
has not changed.

To force rebuild and then attach:

```bash
make rebuild
make hook
```

### Install or update the environment

```bash
make setup
```

This directly runs:

```text
~/Documents/runpod/frida/install-frida-environment.sh
```

It creates or updates the shared tools under:

```text
~/Documents/frida-js-tools/
├── node_modules/
├── package.json
├── package-lock.json
└── python-env/
```

Use `make setup` on a new machine, to repair the environment, or when an
intentional package update is wanted. It may update installed Frida packages.

Normal `make` and `make run` use `ensure-env` instead. That check invokes
the installer only when a required executable or package is missing.

### Validate without building

```bash
make check
make ensure-env
```

`make check` verifies:

- `legendsummoner.ts`;
- `hook_pid.json`;
- the central executable `build.sh`; and
- the central executable `hook.sh`.

`make ensure-env` verifies:

- the isolated Frida CLI;
- `frida-ps`;
- `frida-compile`; and
- `frida-il2cpp-bridge`.

### Remove generated output

```bash
make clean
```

This removes only:

```text
~/Documents/runpod/ls/legendsummoner.js
```

It does not remove TypeScript source, configuration, shared packages, or the
Python environment.

## Git targets

The Git repository root is expected to be:

```text
~/Documents/runpod
```

The Makefile restricts status, staging, and commit paths to the current
`~/Documents/runpod/ls` project. A Git push still publishes repository
commits, and a Git pull updates the repository rather than only one folder.

### Show project changes

```bash
make git-status
```

This is equivalent to asking Git for short status output limited to the current
project directory.

### Pull safely

```bash
make git-pull
```

This target:

1. checks the entire repository for uncommitted changes;
2. refuses to pull if the working tree is dirty; and
3. uses `git pull --ff-only`.

`--ff-only` prevents the Make target from automatically creating a merge
commit or rewriting local history when local and remote branches diverge.

There is no normal Git operation that pulls only the `ls` directory. Pulling
retrieves repository commits and can update sibling projects.

### Commit and push this project

```bash
make git-push
```

This target:

1. stages changes under `~/Documents/runpod/ls`;
2. exits successfully when that folder has no staged changes;
3. generates a commit message automatically;
4. commits only the current project path; and
5. pushes the resulting repository commit.

The generated message has this format:

```text
ls update YYYY-MM-DD HH:MM:SS
```

For example:

```text
ls update 2026-09-14 14:32:10
```

Build, hook, and Git publication remain separate. `make run` never commits or
pushes files automatically.

## Configuring hook_pid.json

`hook_pid.json` tells the central launcher:

1. which process names belong to this game; and
2. which agent commands should run immediately after the JavaScript loads.

Example:

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

### process_names

`process_names` is required and must be a non-empty array of exact process
names:

```json
"process_names": [
  "小兵立大功",
  "LegendSummoner"
]
```

Rules:

- Names must match the output of `frida-ps` exactly.
- Matching is case-sensitive.
- Unicode names such as `小兵立大功` are supported.
- Partial names are not matched.
- Earlier entries have higher selection priority.
- If several matching processes are running, the launcher prints all matches
  and selects the highest-priority name; for duplicate names, it selects the
  lowest PID.

To inspect current processes:

```bash
~/Documents/frida-js-tools/python-env/bin/frida-ps
```

### default_hook

`default_hook` is an optional array of JavaScript expressions:

```json
"default_hook": [
  "inc(8)",
  "addExp(2)"
]
```

The central launcher passes each entry to Frida as a separate evaluation after
loading `legendsummoner.js`.

For an empty startup configuration:

```json
"default_hook": []
```

The functions must be exposed on the TypeScript agent's global object:

```typescript
const api = {
    inc,
    addExp,
    status
};

rpc.exports = api;
Object.assign(globalThis, api);
```

`rpc.exports` alone is not sufficient for the expressions executed by
`hook.sh`. The functions referenced by `default_hook` must also be globally
callable.

The current Legend Summoner controls include:

| Expression | Effect |
| --- | --- |
| `inc(1)` through `inc(20)` | Set the shared combat multiplier |
| `addExp(1)` through `addExp(5)` | Set the EXP multiplier |
| `adMock(0)` through `adMock(99)` | Set local AD availability mock; zero disables it |
| `status()` | Return current hook state |

Later commands entered in the Frida prompt replace the current multiplier
values:

```javascript
inc(3)
addExp(4)
status()
```

### Startup timing

`default_hook` expressions execute immediately after the JavaScript agent is
loaded. Commands that require objects available only inside a battle must
either:

- be executed by attaching after entering the battle; or
- implement their own bounded retry behavior.

The Legend Summoner `inc()` and `addExp()` commands update shared state, so
they can safely run before the first battle calculation uses that state.

### Avoid duplicated defaults

Prefer neutral defaults inside the TypeScript:

```typescript
const multipliers = {
    combat: 1,
    exp: 1
};
```

Then put the desired startup values only in `hook_pid.json`:

```json
"default_hook": [
  "inc(8)",
  "addExp(2)"
]
```

This allows startup values to change without rebuilding the agent and avoids
two competing sources of configuration.

### Treat default_hook as code

`default_hook` entries are executable JavaScript expressions. Do not use a
`hook_pid.json` obtained from an untrusted source without reviewing it.

Validate edited JSON with:

```bash
python3 -m json.tool ~/Documents/runpod/ls/hook_pid.json
```

## Common workflows

After editing TypeScript:

```bash
cd ~/Documents/runpod/ls
make run
```

After editing only `hook_pid.json`:

```bash
make hook
```

After restarting the game:

```bash
make hook
```

After changing the shared compiler or bridge:

```bash
make rebuild
make hook
```

From any directory:

```bash
make -C ~/Documents/runpod/ls run
```

Review and publish project changes:

```bash
make git-status
make git-push
```

Update the repository before beginning new work:

```bash
make git-pull
```

## Troubleshooting

### TypeScript source not found

Confirm that the filename matches `AGENT := legendsummoner`:

```bash
ls -l ~/Documents/runpod/ls/legendsummoner.ts
```

If the actual source is `legendsummoner-hooks.ts`, change the Makefile:

```makefile
AGENT := legendsummoner-hooks
```

### hook_pid.json not found

It must be in:

```text
~/Documents/runpod/ls/hook_pid.json
```

It belongs beside `legendsummoner.js`, not in the central `frida` directory.

### No process matched

Compare `process_names` with:

```bash
~/Documents/frida-js-tools/python-env/bin/frida-ps
```

Copy the exact displayed name.

### A changed default did not apply

There is no need to rebuild after editing only `hook_pid.json`. Detach the
current Frida session and run:

```bash
make hook
```

If the command exists but still fails, confirm that it is assigned to
`globalThis` in `legendsummoner.ts`.

## Quick reference

```bash
cd ~/Documents/runpod/ls

make             # Show available commands
make help        # Show available commands
make build       # Build only when required
make all         # Alias for make build
make run         # Build when required, then hook
make hook        # Hook existing JavaScript
make rebuild     # Force regeneration
make setup       # Force environment install/update
make check       # Validate project files
make ensure-env  # Validate/install shared environment
make clean       # Remove generated JavaScript
make git-status  # Show changes under this project
make git-pull    # Fast-forward-only repository pull
make git-push    # Auto-commit this project and push
```
