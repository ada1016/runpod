# WittleDefender Frida Agent: Recovery, Reverse Engineering, and Hook Design

This document explains how the WittleDefender/胡鬧地牢 Frida agent was
developed and why `index_hook_config.ts` uses its present architecture. It is
intended as a durable technical handoff for a developer or AI continuing the
work after the original investigation is no longer in context.

It is primarily a design and reasoning record, not a basic Frida installation
guide. The companion project scripts and configuration should remain the
authoritative source for build, attach, process selection, and startup-command
syntax.

## Snapshot covered by this document

The observations below correspond to the following recovered artifacts:

| Artifact | SHA-256 |
| --- | --- |
| `index_hook_config.ts` | `db1e38468687130054adfc4b4cb57e733129ba9ff0aa18ab43b3ab6572bfff82` |
| `HotFixBattle.dll` | `f0b6fcee784e16fd66bd80d0d8cb8e605c705ad0393bf2252b6b511d7b441a65` |
| `hotfixbattle.active.bundle` | `cba3500c0c7d9229c4e0ee411f7cf5d9389882f7f506bff6a4bb43c83409d91b` |
| decompiled-source archive `wd.zip` | `35406d7fb867ceb85196ffdb19f9b84aa19994e9c7ac5479a55b3890885c1fba` |

The investigated game build identified itself as WittleDefender 2.0.3. The
names, layouts, and behavior in a later build must be revalidated rather than
assumed.

## Executive summary

This game is a Unity IL2CPP application, but much of its gameplay is not an
ordinary AOT IL2CPP implementation in the main executable. Core battle logic is
delivered in hot-update assemblies and executed through HybridCLR. The most
important recovered assemblies are:

```text
HotFix.dll
HotFixBattle.dll
```

That distinction explains both the successful design and most failed attempts:

- live IL2CPP metadata reliably exposes assemblies, classes, fields, methods,
  signatures, and `MethodInfo*` handles;
- `il2cpp_runtime_invoke` can reliably invoke many HybridCLR methods by their
  exact `MethodInfo*`;
- a HybridCLR `method.virtualAddress` may be null, non-executable, or point to a
  shared interpreter/native thunk used by unrelated methods;
- attaching to or replacing that shared address does not mean the target
  managed method has been uniquely hooked;
- one-time mutations of live objects and exact fields proved more stable than
  polling or pretending every HybridCLR method has a unique native body.

The final agent therefore uses three deliberately different mechanisms:

1. live metadata plus `il2cpp_runtime_invoke` for managed getters/setters;
2. verified direct field access for simple instance fields and inline
   obfuscated value types; and
3. `Interceptor.attach` only at the ordinary AOT networking boundary, where the
   native entry points were observed to behave as real interceptable methods.

There is no `ChangeHp` native hook, no continuous hero watcher, and no periodic
combat mutation loop in the current source.

The decisive static-analysis breakthrough came before any of those hook-design
choices: the downloaded DLL AssetBundle was not a canonical UnityFS image at
offset zero. It contained a duplicated UnityFS prefix/load-offset wrapper. The
bundle had to be normalized at its verified second UnityFS header before an
asset extractor could recover a DLL that ILSpy could read. This repair step is
easy to misremember as “shifting the DLL,” but the corrected description is:

```text
repair the duplicated outer UnityFS wrapper
    -> extract the raw DLL byte asset
        -> validate the managed PE
            -> open the real HotFixBattle method bodies in ILSpy
```

## How the real gameplay code was uncovered

### Initial clue: native inspection did not explain the managed logic

An existing dylib and IDA output provided useful behavioral clues, but direct
native-address hooks behaved inconsistently. In particular, one attempted hook
for a HybridCLR method was entered with a `this` object belonging to an
unrelated class. That was the first strong sign that apparently valid method
addresses were shared dispatch stubs rather than unique implementations.

Runtime diagnostics later confirmed the pattern: unrelated managed methods
could expose the same native virtual address. An executable memory range only
proved that an address contained code; it did not prove ownership by one
managed method.

### Locating the hot-update assemblies

The decrypted IPA/application directory was searched for DLL-oriented Unity
Addressables assets. The relevant paths followed this pattern:

```text
Data/Raw/aa/iOS/dll_assets_assets/_resources/dll/
    hotfix.dll.bytes_<content-hash>.bundle
    hotfixbattle.dll.bytes_<content-hash>.bundle
    frameworkbattleruntime.dll.bytes_<content-hash>.bundle
```

The same assets could exist in the installed PlayCover application directory:

```text
~/Library/Containers/io.playcover.PlayCover/Applications/
    com.game.kingrush.app/Data/Raw/aa/iOS/...
```

An ordinary `lsof` query was not sufficient to reveal every hot-update DLL,
because Unity reads the Addressables bundle and loads the managed bytes into
memory; it does not have to keep a standalone `HotFixBattle.dll` open as a
mapped file.

### Breakthrough: the duplicated UnityFS load-offset wrapper

The first extracted `hotfixbattle.dll.bytes_*.bundle` looked like a UnityFS
bundle, but ordinary extraction failed. Passing material obtained from the
unrepaired container onward did not produce an assembly ILSpy could load. The
failure initially looked like DLL encryption, corruption, or an incompatible
ILSpy build.

Binary inspection exposed the actual problem:

```bash
grep -abo "UnityFS" hotfixbattle.active.bundle
```

For the recovered HotFixBattle bundle, the output was:

```text
0:UnityFS
320:UnityFS
```

Hex offset `320` is `0x140`. More importantly, the first 320 bytes were an
**exact duplicate** of the next 320 bytes:

```text
bytes [0x000:0x140] == bytes [0x140:0x280]
```

The real canonical UnityFS image began at the second header, offset `0x140`.
The game passed a load offset to Unity's bundle loader, so the prefixed form was
valid for the game but confusing to tools that assumed the UnityFS container
began at byte zero and that its declared size reached the physical end of the
file.

An earlier related HotFix bundle used the same scheme with a 128-byte
(`0x80`) duplicated prefix. Therefore, **320 is build/file-specific and must
not be hard-coded as a universal HybridCLR rule**.

#### Prove duplication before removing bytes

The second `UnityFS` occurrence provides a candidate offset `N`; it is not by
itself permission to trim. Verify the repeated ranges exactly:

```bash
N=320
cmp -n "$N" \
  <(dd if=hotfixbattle.active.bundle bs=1 count="$N" 2>/dev/null) \
  <(dd if=hotfixbattle.active.bundle bs=1 skip="$N" count="$N" 2>/dev/null)
```

Equivalent Python validation is clearer and avoids relying on shell process
substitution:

```python
from pathlib import Path

path = Path("hotfixbattle.active.bundle")
data = path.read_bytes()
offsets = []
start = 0
while True:
    found = data.find(b"UnityFS\x00", start)
    if found < 0:
        break
    offsets.append(found)
    start = found + 1

print("UnityFS offsets:", [hex(x) for x in offsets])
N = offsets[1]
assert N > 0
assert data[:N] == data[N:2 * N], "prefix is not an exact duplicate"
print("verified duplicated prefix length:", N, hex(N))
```

The strongest structural test is to parse each candidate UnityFS header's
declared file size and select the candidate for which:

```text
candidate_offset + declared_UnityFS_size == physical_file_size
```

That is the rule later implemented in the local `unityfs_tool.py`: scan for
embedded `UnityFS\0` candidates and choose the image whose declared size ends
exactly at EOF. This is safer than selecting the second signature blindly.

#### Normalize the bundle

After the exact 320-byte duplication was established, either command produced
the canonical inner bundle:

```bash
tail -c +321 hotfixbattle.active.bundle > hotfixbattle.inner.bundle
```

or:

```bash
dd if=hotfixbattle.active.bundle \
   of=hotfixbattle.inner.bundle \
   bs=1 skip=320 status=none
```

`tail -c` uses a one-based starting byte, hence `+321` to discard bytes 0–319.
The equivalent earlier 128-byte case used `tail -c +129`.

The normalized `.inner.bundle`, not the outer wrapped file, was then opened in
AssetRipper/another compatible Unity bundle extractor. The workflow was:

```text
hotfixbattle.active.bundle
  -> verify duplicate prefix at 0x140
  -> strip first 320 bytes
  -> hotfixbattle.inner.bundle
  -> AssetRipper: Export All Files
  -> HotFixBattle.dll.bytes
  -> preserve raw bytes / copy or rename to HotFixBattle.dll
  -> verify MZ + PE/CLI structure
  -> ILSpy
```

Only after this normalization and raw-asset extraction did ILSpy expose the
real HybridCLR CIL bodies. That changed the investigation from guessing native
hooks to reading the actual gameplay control flow.

#### Why this lesson generalizes

When an asset extractor or ILSpy rejects a promising artifact, do not jump
straight to “encrypted” or “bad decryption.” Check container boundaries first:

- repeated file signatures;
- duplicated prefix blocks;
- embedded container headers at nonzero offsets;
- declared size versus physical size;
- alignment/padding expected by the game's loader;
- whether an extractor exported a raw asset or a converted representation; and
- whether the payload begins with a valid `MZ` and points to `PE\0\0`.

Repair the **container layer** before diagnosing the **managed assembly layer**.
Keep the original wrapped file unchanged, record the detected offset, and hash
both wrapped and normalized artifacts.

### What “decrypted DLL” means here

Two different protection layers must not be confused:

1. The application/IPA must be available in a form whose packaged resources can
   be inspected. A decrypted IPA or an already decrypted PlayCover installation
   satisfies that part.
2. The game's noncanonical duplicated UnityFS load-offset wrapper must be
   detected, proven, and normalized.
3. `HotFixBattle.dll` is then recovered as a raw byte asset from the canonical
   inner UnityFS bundle. The resulting payload is a normal managed PE/CLI
   assembly and can be opened in ILSpy.

The recovered file was identified as:

```text
PE32 executable (DLL), Mono/.NET assembly
```

The practical recovery workflow used during this investigation was:

1. list the IPA or installed application resources and locate
   `hotfixbattle.dll.bytes_*.bundle`;
2. preserve an untouched copy and hash it;
3. search for all `UnityFS\0` signatures and inspect their offsets;
4. verify that the candidate prefix is an exact duplicate and that the inner
   header's declared size terminates at physical EOF;
5. strip the verified 320-byte (`0x140`) wrapper for this exact HotFixBattle
   artifact, producing a canonical inner bundle;
6. parse/extract the inner UnityFS/AssetBundle payload (the local
   `unityfs_tool.py` or AssetRipper was used during the investigation);
7. export the embedded DLL byte asset in raw form;
8. verify `MZ`, `PE\0\0`, CLI/.NET metadata, file type, size, and SHA-256 hash;
9. open the recovered DLL in ILSpy and export/decompile the project;
10. correlate the decompiled types with live metadata through
   `frida-il2cpp-bridge`.

The supplied `wd.zip` is the resulting decompiled HotFixBattle source tree. It
is more valuable for control-flow analysis than a normal IL2CPP dummy DLL,
because these HybridCLR assemblies retained real managed method bodies.

### Why ILSpy was useful in this game

In a conventional IL2CPP build, a reconstructed dummy DLL usually contains
signatures but empty/default bodies because the real implementation was
compiled into native machine code. Here, the hot-update DLL contains executable
CIL for HybridCLR. ILSpy could therefore recover meaningful bodies such as:

```csharp
public long ChangeHp(long hp)
{
    if (!CanChangeHp()) return 0L;
    ObfuscatedLong currentHp = CurrentHp;
    CurrentHp -= (ObfuscatedLong)hp;
    CurrentHp = ObfuscatedLong.Max(CurrentHp, 0L);
    CurrentHp = ObfuscatedLong.Min(CurrentHp, CurrentMaxHp);
    AddFlag(UpdateViewFlag.UpdateHp);
    return CurrentHp - currentHp;
}
```

That body established a critical sign convention:

```text
hp > 0  means damage
hp < 0  means healing
hp == 0 means no change
```

It also established that `hp` is `Int64`, not `Int32`. Several early hook ideas
were invalid because they assumed the opposite sign or read only 32 bits.

## Tool and evidence chain

The investigation combined complementary tools rather than treating any one
output as authoritative:

| Tool/technique | What it contributed |
| --- | --- |
| Decrypted IPA or PlayCover app | Inspectable game binary and Addressables assets |
| ZIP/file/hash utilities | Located bundles and preserved build identity |
| `grep -abo`, hex comparison, `cmp`/Python | Found and proved the duplicated UnityFS prefix |
| `tail`/`dd` or offset-aware `unityfs_tool.py` | Normalized the wrapped bundle at verified offset `0x140` |
| AssetRipper/UnityFS extraction | Exported raw `HotFixBattle.dll.bytes` from the inner bundle |
| ILSpy exported project | Real HybridCLR C# bodies, field names, call graphs, and “Used By” references |
| IDA Pro | Native/dylib behavior and executable-address inspection |
| `dnfile`/PE inspection | Confirmed and inspected managed assembly structure |
| Frida 17.x | Live process instrumentation and diagnostics |
| `frida-il2cpp-bridge` | Live domain, assembly, class, field, method, GC, and object access |
| `il2cpp_runtime_invoke` | Exact `MethodInfo*` managed invocation without trusting a shared VA |
| Runtime logs/counters | Proved whether an installed native hook was actually hit |
| Crash reports | Exposed unsafe argument/object assumptions and runtime-invoke interception failures |

Static analysis answered what the code intended to do. Runtime inspection
answered which classes were actually loaded, which objects were alive, and
whether a proposed interception point was unique and callable.

## The HybridCLR address-sharing problem

### A non-null virtual address is not proof of a unique method body

The bridge exposes `method.virtualAddress`, but in HybridCLR this can identify
an interpreter/shared call stub. The following test is necessary but not
sufficient:

```typescript
const range = Process.findRangeByAddress(method.virtualAddress);
const executable = range !== null && range.protection.includes("x");
```

`executable === true` says only that the pointer lands in executable memory.
It does not say that the pointer uniquely implements the selected managed
method.

The strongest observed diagnostic was a hook intended for one class receiving
`this` from another class. Later MethodInfo-filtered replacements installed
successfully but recorded zero matching calls. These were not timing problems;
they showed that the execution path did not pass through the assumed unique
entry point in the expected ABI form.

### Why hooking `il2cpp_runtime_invoke` was rejected

Intercepting `il2cpp_runtime_invoke` looked attractive because MethodInfo is an
explicit argument. In practice, the attempted global runtime-invoke full-heal
hook terminated the process immediately. That function is a broad runtime
boundary used by many managed calls, including calls initiated by the agent.
Reentrancy, ABI mistakes, interpreter behavior, and recursive instrumentation
make it a poor mutation point.

The current source calls `il2cpp_runtime_invoke`; it does not intercept or
replace it.

### Reliable rule for future work

Use this decision order:

1. Prefer a one-time field/property mutation if the desired behavior is
   represented as mutable object state.
2. Prefer exact MethodInfo-based invocation when an existing managed method or
   dictionary setter should run normally.
3. Use a native interceptor only after proving the address is a genuine unique
   AOT body and validating its native ABI.
4. If the method is HybridCLR-dispatched and cannot be reduced to state, locate
   a unique AOT caller or instrument the interpreter dispatch layer with exact
   version-specific knowledge.
5. Never infer uniqueness from executable memory alone.

## Runtime object graph used by the agent

The player heroes are discovered through live UI/camp objects:

```text
HotFix.Battle.UI.BattleMainUI
  -> _mechaSkillNode
     -> _myCamp
        -> _heroList
           -> EntityHero objects
```

`Il2Cpp.gc.choose(BattleMainUI)` finds active UI instances. The agent then
invokes the list's managed `get_Count` and `get_Item` methods. Handles are
deduplicated because multiple UI objects can expose the same live hero.

For combat attributes, the path is:

```text
EntityHero / EntityRoleBase
  -> GetRoleAttr()
     -> RoleAttributeGroup
        -> AttributeMap field
           -> Dictionary<int,int>
              -> get_Item(int)
              -> set_Item(int,int)
```

`AttributeMap` is the **field name**, not a runtime class named
`AttributeMap`. Its value is a generic dictionary, and the indexer method names
are `get_Item` and `set_Item` with a capital `I`.

Objects are rediscovered for each command. They are not cached across battles,
because Unity/HybridCLR can destroy, pool, or recreate them. The two explicit
exceptions are temporary ownership features:

- `god()` pins the exact heroes to which it added one invincibility count;
- `creroll()` pins the exact Crusade manager whose original reroll value must be
  restored.

## MethodInfo invocation helper

`runtimeInvokeRaw()` resolves the exported runtime functions lazily:

```text
il2cpp_runtime_invoke
il2cpp_object_unbox
```

For every invocation it:

1. resolves the method from the live object's class, name, and argument count;
2. allocates native storage for each `Int32` argument;
3. builds the native argument-pointer array;
4. supplies a managed exception output slot;
5. invokes the method using its `MethodInfo*` handle;
6. rejects a returned managed exception; and
7. unboxes `Int32` return values when requested.

This helper currently supports `Int32` arguments only. Do not reuse it for
`Int64`, `FP`, structures, references, or out parameters without implementing
and validating the correct native argument storage.

Method lookup currently uses name plus argument count. For overloaded methods
with the same arity, a future version should add exact parameter-type matching
before invocation.

## Current command inventory and design

The interactive globals and RPC exports ultimately call the same functions.
The user-facing globals are summarized below.

| Command | Mechanism | Persistence |
| --- | --- | --- |
| `read()` | live discovery plus read-only field/getter access | none |
| `reroll(n)` | write `Levels_table.<extraReroll>k__BackingField` | current table objects |
| `creroll(n)` / `creroll(false)` | write/restore `InGameAttr.ReRandomSkillNum` for `BattleType.Crusade=18` | pinned current manager until disabled |
| `revive()` | write `InGameAttr.AdReviveTimes=5` | current battle group |
| `inc(percent)` | dictionary writes for ATK, DEF, and RecoveryRate | current hero objects |
| `heal(percent)` | dictionary write for RecoveryRate only | current hero objects |
| `expower(multiplier)` | dictionary write for EX-weapon charge percentage | current hero objects |
| `god()` / `god(seconds)` / `god(false)` | owned `InvincibleCount` contribution | pinned heroes until disabled/timer expiry |
| `traceend()` / `traceend(false)` | attach/detach AOT network `Send` listeners | until detached/process exit |
| `traceendstatus()` | return cached tracing diagnostics | read-only |

No gameplay command runs automatically inside the TypeScript. Startup defaults
belong in the project `hook_pid.json` and are evaluated by the launcher after
the compiled script loads.

### `read()` and `ObfuscatedLong` HP decoding

The agent reads the inline `CurrentHp : ObfuscatedLong` struct from metadata.
The recovered type contains:

```csharp
private long _obfuscatedValue;
private int _xorKey;
public long Value => _obfuscatedValue ^ _xorKey;
```

The C# expression sign-extends the signed `Int32` key before XOR with the
`Int64`. The implementation therefore uses Frida `Int64` arithmetic rather
than JavaScript bitwise operators, which would truncate to 32 bits. It retries
the read when the key changes concurrently.

The report also reads these dictionary keys:

| Name | Key | Representation |
| --- | ---: | --- |
| Attack | 1 | integer |
| HPRecovery | 5 | integer |
| Defence | 6 | integer |
| DefencePercent | 7 | game-specific raw percent |
| SkillSpeed | 11 | integer |
| RecoveryRate | 47 | 10,000 raw = 100% |

### `inc(percent)`

`inc()` discovers current player heroes once and mutates three attributes:

- Attack key 1: `before + round(before * percent / 100)`;
- Defence key 6: the same relative calculation; and
- RecoveryRate key 47: adds `percent * 100` raw units.

RecoveryRate is additive because multiplying a normal zero baseline would do
nothing. Every write is made through the dictionary's managed `set_Item` and
verified with `get_Item`. Repeated calls compound ATK/DEF and add healing
percentage points. There is no restoration ledger; battle recreation or a
process restart normally restores the source-derived state.

### `heal(percent)`

`heal()` changes only key 47. It exists so healing can be studied independently
without changing visible ATK/DEF. Like `inc()`, it is a one-time update of
current hero objects and repeated calls add percentage points.

### `expower(multiplier)`

Static analysis found:

```csharp
fP *= (1 + roleAttr.GetValue(SWeaponChargeSpeedPct))
    * (1 + roleAttr.GetValue(LevelEffectSWeaponChargeSpeedPct));
```

`SWeaponChargeSpeedPct` is key 151. The agent transforms the complete factor:

```text
after = ((10000 + before) * multiplier) - 10000
```

Consequently, `expower(1.2)` maps a zero raw bonus to 2000 (+20%), while an
existing +10% bonus becomes +32%, not merely +30%. Repeated calls compound.

This approach deliberately does **not** hook
`HeroSpecialWeaponRef.AddEnergy(FP)`. That method is HybridCLR-dispatched, and a
blind native hook would also risk multiplying negative energy consumption. Key
151 affects the positive weapon-energy calculation path recovered in
`DamageCountLogic.InitWeaponEnergy`; it does not rewrite energy costs.

At battle end, the client records each hero's remaining weapon-energy
percentage and aggregate combat statistics. `WeaponRef._finishFireCount`
increments after a weapon finishes, but no explicit special-weapon activation
count was found in the submitted result DTO. Manual activations may still be
represented by replay `CommandId.SkillHudClick = 7`, and abnormal charge speed
can indirectly affect damage, timing, remaining energy, commands, and the
result hash.

### `reroll(n)` for ordinary battles

The normal reroll value comes from:

```text
LocalModels.Bean.Levels_table.extraReroll
```

The auto-property backing field is
`<extraReroll>k__BackingField`. Because table objects may not exist when the
agent is first loaded, `reroll()` performs bounded delayed discovery:

- retry every 3 seconds;
- stop after 30 attempts;
- cancel the prior generation when called again;
- stop as soon as at least one table instance was found.

This is bounded startup discovery, not a permanent watcher.

### `creroll(n)` for Crusade

Crusade did not honor `Levels_table.extraReroll`. Static analysis and runtime
testing showed that its remaining rerolls are held in the active battle
manager's:

```text
BattleLogicMgr.InGameAttr.ReRandomSkillNum
```

The corrected implementation does not search for a class named
`CrusadeMode`. It enumerates `BattleLogicMgr`, reads `StartData.Type`, and
requires the numeric enum value `BattleType.Crusade = 18`. This matters because
the active manager/mode class name was not the reliable discriminator initially
assumed.

When first enrolled, the manager is pinned and its original value saved.
`creroll(false)` restores that exact value and releases the reference. A new
battle creates a new manager and requires a new command.

### `revive()`

`revive()` writes:

```text
BattleLogicMgr.InGameAttr.AdReviveTimes = 5
```

It does not resurrect a dead hero and does not replace
`BattleStatistics.AddRevive()`. It only changes the available ad-revive count
that the normal revive flow later consumes.

Earlier attempts to replace `AddRevive()` or `OnReviveFinish()` either froze the
UI or installed a MethodInfo-related hook that was never hit. Those failures
reinforced the preference for a one-time authoritative state change.

### `god()`, `god(seconds)`, and `god(false)`

Static analysis found the actual invincibility predicate:

```csharp
public static bool IsInvincible(EntityRoleBase role)
{
    return role.InvincibleCount > 0;
}
```

`InvincibleCount` is an inline `ObfuscatedInt` with an encoded value and XOR
key. Game buffs use balanced `+1` and `-1` contributions. The agent follows the
same ownership model:

- enabling adds exactly one to each newly discovered current player hero;
- it pins each modified hero before mutation;
- enabling again skips already owned heroes;
- disabling subtracts exactly one from owned heroes, never forces zero;
- it verifies both the expected struct layout and the value after writing;
- any uncertain write sets a fault state and requires a restart rather than
  blindly adding/subtracting again.

This preserves legitimate game invincibility buffs. For example, if the game
adds its own contribution while the agent owns one, `god(false)` removes only
the agent's contribution.

`god(seconds)` schedules one wall-clock timer. A later successful god command
cancels/replaces the timer. If another IL2CPP operation owns the command lock at
expiry, the disable request is deferred until that operation releases it; it
does not create a polling loop.

Pinned references must be released with `god(false)` before leaving battle,
detaching, or reloading the agent. Detaching a script does not automatically
execute a managed-state rollback.

### Why `ChangeHp` is not used for god mode

Although `EntityRoleBase.ChangeHp(long)` is semantically close to damage, its
HybridCLR address did not behave as a unique hook point. Observed variants
included:

- a non-executable/null exposed virtual address;
- a shared executable thunk with no MethodInfo matches;
- an installed callback with zero hits;
- periodic `runtimeInvoke(ChangeHp)` healing that was intrusive and unstable;
- invalid/stale hero access producing access violations; and
- process termination after intercepting the global runtime-invoke boundary.

The polling approach also had the wrong operational shape. Repeated healing
every 60 or 500 ms was not a hook; it repeatedly scanned objects and invoked
game logic. It could race destruction/recreation, apply work on unsuitable
threads, generate excessive flags/logs, and freeze the game.

The invincibility counter is the stable state that the normal damage path
already checks before calling `ChangeHp`. Mutating that state once is both
simpler and less invasive.

## Operation serialization and thread caveat

`runCommand()` claims `operationBusy` **before** awaiting `Il2Cpp.perform`.
Overlapping commands are rejected rather than queued. This avoids simultaneous
heap scans and dictionary writes from interactive/RPC requests.

`Il2Cpp.perform` ensures the IL2CPP runtime is initialized and provides a safe
managed attachment context. It is not, by itself, proof that the callback runs
on Unity's main thread. Any future code that touches UnityEngine UI or APIs with
main-thread affinity needs a deliberate main-thread scheduling mechanism.

## Battle-end network tracing

`traceend()` is the one current feature that uses a native interceptor. It
resolves `GameApp.get_NetWork()` from live metadata, obtains the runtime network
class, finds all six-parameter `Send(IMessage, ...)` overloads, deduplicates
their executable addresses, and attaches listeners.

Every observed request class is counted, but deep dumps are limited to:

```text
Proto.Battle.LevelEndRequest
Proto.Dungeon.GoldExpDungeonEndRequest
```

For matching requests, the tracer reports:

- request class and handle;
- common parameters object identity;
- commands/ByteString metadata and length;
- `BattleResultDto` level, version, max wave, and end reason;
- rewards;
- boss statistics and pass time;
- frame result hash;
- skill-upgrade and star/condition indexes; and
- whether PVP statistics exist.

Static analysis established that ordinary client-simulated battles submit a
result summary plus serialized replay commands. The command stream contains
command ID, frame ID, integer/fixed-point/array arguments, total frame count,
and the same result hash. The result hash is derived from SHA-256 of the local
`LevelEndData` JSON and truncated to an `Int32`; it is a deterministic
consistency value, not a keyed authentication code.

Crusade follows a different request architecture in the recovered client code:
its start/confirm requests do not expose the same normal end-result envelope.
That difference does not prove every frame is server-simulated; it means only
that the normal client `BattleResultDto + Commands` end request was not found
for that mode.

`traceend(false)` detaches every retained listener. `traceendstatus()` reports
addresses, signatures, observed request classes, matches, dumps, and errors.

## REPL globals versus RPC exports

The same command functions are assigned to `globalThis` for the interactive
Frida prompt and to `rpc.exports` for external clients.

Interactive names:

```text
god       creroll    revive     reroll
inc       heal       expower    read
traceend  traceendstatus
```

The RPC name corresponding to interactive `read()` is
`readHeroAttributes`. Frida's interactive prompt may display `Promise` before
an asynchronous command prints or resolves; that is normal. External clients
should await RPC results.

## Configuration-driven startup

The current source intentionally performs no gameplay mutation merely because
it was loaded. The launcher reads project-local `hook_pid.json` after loading
the compiled JavaScript and evaluates the configured `default_hook`
expressions. A project can therefore choose defaults without rebuilding the
agent.

This separation is important:

- TypeScript defines capabilities and neutral load behavior;
- JSON defines which capabilities a particular launch enables;
- changing startup behavior does not alter the instrument;
- another developer can attach the same agent diagnostically with no automatic
  gameplay writes.

Do not duplicate defaults in both TypeScript initialization and JSON unless the
duplication is intentional and documented.

## Stability and safety properties

The current architecture deliberately avoids:

- a permanent 60/500 ms heap watcher;
- cached unpinned hero pointers across battles;
- direct `ChangeHp` argument hooks on a shared HybridCLR thunk;
- global interception of `il2cpp_runtime_invoke`;
- hard-coded absolute addresses;
- writing `ObfuscatedInt` or `ObfuscatedLong` by guessed offsets;
- forcing `InvincibleCount` to zero during restoration;
- assuming `AttributeMap` is a class;
- modifying a generic dictionary's shared native `set_Item` implementation;
- stacking overlapping IL2CPP commands; and
- unbounded retry loops.

Remaining risks include:

- a game update changing field names, generated backing-field names, enum
  values, layouts, or attribute keys;
- same-arity managed overload ambiguity in `runtimeInvokeRaw`;
- races with game-side struct replacement between read and write;
- lifecycle mistakes if pinned references are not restored/freed;
- object discovery through UI failing in a battle mode with a different UI
  graph;
- server-side validation of replay commands, timing, combat statistics, or
  account state;
- network overload addresses becoming shared or changing ABI; and
- partial trace installation if one listener succeeds before a later error.

Client-side success never establishes server authorization. Attribute changes,
rerolls, revive counts, invincibility, and special-weapon charge can all affect
submitted results or replay-consistency surfaces even when the modified field
itself is not explicitly present in a protobuf request.

## Failed approaches worth remembering

| Attempt | Symptom | Lesson |
| --- | --- | --- |
| Treat `ChangeHp` as `Int32` | truncation/incorrect semantics | signature is `long ChangeHp(long)` |
| Treat negative `hp` as damage | modified healing | positive is damage because `CurrentHp -= hp` |
| Hook any executable `virtualAddress` | wrong `this`, zero target hits | HybridCLR thunk can be shared |
| Search for class `AttributeMap` and `set_item` | resolution failure | field holds `Dictionary<int,int>`; methods are `get_Item`/`set_Item` |
| Poll heroes and invoke healing | freezes/access violations | stale objects, repeated work, races, wrong execution context |
| Intercept global `il2cpp_runtime_invoke` | immediate process termination | boundary is broad/reentrant and ABI-sensitive |
| Replace `AddRevive()`/`OnReviveFinish()` | UI freeze or zero hits | mutate authoritative revive state instead |
| Assume Crusade uses normal `extraReroll` | no effect | use active manager `ReRandomSkillNum` and Type 18 |
| Assume a class literally named Crusade manager exists | no active manager found | discriminate live `BattleLogicMgr.StartData.Type` |
| Feed the duplicated-prefix bundle directly to standard tools | extractor/ILSpy pipeline reported unreadable or invalid output | locate both UnityFS headers, prove duplicated prefix, normalize at the verified load offset |
| Treat any second `UnityFS` string as a trim point | possible destructive false positive | require exact prefix duplication and declared-size-to-EOF validation |
| Patch/repack hotfix bundle statically | installed bundle rejected/ineffective | Addressables CRC/catalog/signing and load-source selection matter |
| Force miss behavior without camp filtering | uncertain side effects/no effect | hit/evasion applies to both camps and has multiple paths |

These are part of the design evidence. Do not retry them without new evidence
that changes the underlying assumption.

## Update checklist for a new game build

Before using or extending this agent against an update:

1. Preserve and hash the new IPA/application, hotfix bundle, recovered DLL, and
   current TypeScript.
2. Confirm which Addressables catalog/bundle is actually loaded; downloaded
   content may override packaged content.
3. Scan each candidate bundle for repeated `UnityFS\0` headers. Do not assume
   the old 128- or 320-byte load offset still applies.
4. Verify exact prefix duplication and the inner header's declared size before
   producing a normalized bundle.
5. Extract the matching `HotFix.dll` and `HotFixBattle.dll` as raw byte assets.
6. Confirm `MZ`, `PE\0\0`, and CLI metadata before opening either file in
   ILSpy.
7. Open both in ILSpy and export a fresh project.
8. Diff class names, field names, enum numeric values, and method signatures.
9. Confirm `HotFix` and `HotFixBattle` assembly names in the live domain.
10. Confirm the `BattleMainUI -> _mechaSkillNode -> _myCamp -> _heroList` graph
   in each supported battle mode.
11. Confirm `GetRoleAttr`, `AttributeMap`, `get_Item`, and `set_Item` metadata.
12. Revalidate attribute keys 1, 5, 6, 7, 11, 47, and 151 from the new
   `RoleAttributeType` and calculation code.
13. Revalidate `ObfuscatedInt` and `ObfuscatedLong` field layouts and signed XOR
    semantics.
14. Revalidate `BattleType.Crusade` numeric value before using `creroll`.
15. Revalidate `GameApp.get_NetWork` and every selected `Send` overload before
    enabling `traceend`.
16. Inspect candidate native addresses for executable protection, duplicate
    addresses, module ownership, and actual runtime hits.
17. Start with `read()` and tracing only; compare output to visible game state.
18. Apply one low-value mutation once and verify both the immediate value and
    battle lifecycle.
19. Test `god()` followed promptly by `god(false)` before testing timed mode.
20. Confirm every pinned reference is released before detach/reload.
21. Capture end-request diagnostics for every battle mode being studied.
22. Treat zero hook hits as evidence against the proposed call path, not as
    proof that the callback code is correct but unlucky.
23. Recompile with the exact local Frida TypeScript toolchain and resolve all
    type errors before attaching.

## Recommended next investigations

### Prove special-weapon activation recording

Instrument or inspect `CommandMgr.DispatchCommond` and count
`CommandId.SkillHudClick = 7`, then compare battles with zero and multiple
manual EX-weapon launches. Also inspect each special weapon's
`_finishFireCount`, final `RemainWeaponEnergyPercent`, total damage/healing, and
the serialized command ByteString. This will determine whether launch count is
explicitly replay-visible or only indirectly reflected in end state.

### Generalize end-request tracing

The static analysis identified many end-request classes beyond the two current
filters. Future work should use a declarative request-class allowlist and
per-schema dump adapters rather than embedding more class checks inside the
native callback.

### Strengthen method selection

Replace name-plus-arity lookup with exact parameter-type selection. On failure,
return all same-name candidate signatures and handles. This converts silent
overload drift into an actionable update diagnostic.

### Add an explicit cleanup command

A single cleanup operation could disable god mode, restore Crusade rerolls,
cancel bounded timers, detach trace listeners, and report any ownership that
could not be released. Cleanup must remain conservative: uncertain state should
require a restart rather than a guessed inverse write.

### Separate mutation and diagnostic agents

For long-term maintenance, consider a read-only discovery/tracing agent and a
small mutation agent sharing the same resolver library. A diagnostic agent can
remain attached with a lower risk of accidentally changing battle state.

## Source-code map

| Section/function | Responsibility |
| --- | --- |
| constants and type declarations | assembly names, class names, keys, limits, report types |
| `runCommand` | one-operation lock and `Il2Cpp.perform` boundary |
| `findClass`, `findClassAnywhere` | live metadata resolution |
| `runtimeInvokeRaw` | MethodInfo-based managed invocation |
| `collectHeroes` | current-player object discovery and deduplication |
| `attributeMap` | `EntityHero -> RoleAttributeGroup -> Dictionary` resolution |
| `readCurrentHp` | inline `ObfuscatedLong` decoding |
| `collectHeroAttributes` / `readCommand` | diagnostic hero report |
| `incrementCommand` | ATK/DEF/RecoveryRate one-time mutation |
| `healCommand` | RecoveryRate-only mutation |
| `exPowerCommand` | SWeapon charge-factor mutation |
| `patchReroll` / `rerollCommand` | normal table mutation and bounded discovery |
| `crusadeRerollCommand` | Crusade manager enrollment, mutation, and restoration |
| `reviveCommand` | ad-revive count mutation |
| `invincibleFields`, `adjustInvincibleCount`, `godCommand` | owned invincibility contribution and timed restoration |
| `resolveNetworkSends`, `traceEndCommand` | AOT networking interception |
| dump helpers | filtered protobuf/result diagnostics |
| `globalThis` and `rpc.exports` assignments | interactive and external API surfaces |

## Concise reasoning chain

1. The app is IL2CPP, but core game rules are runtime-loaded HybridCLR hotfix
   assemblies.
2. The hotfix assemblies were located inside Unity Addressables DLL bundles,
   but the first HotFixBattle bundle was not directly tool-readable because a
   duplicated UnityFS prefix placed the real image at load offset `0x140`.
3. Exact byte comparison and declared-size validation proved the wrapper;
   removing the first 320 bytes exposed the canonical inner UnityFS image.
4. AssetRipper/raw extraction then recovered a valid managed PE, and ILSpy
   finally exposed the real CIL method bodies.
5. Decompiled bodies established exact types, field ownership, sign
   conventions, enum values, and call flow.
6. Live bridge metadata connected those static names to the running process.
7. HybridCLR virtual addresses proved non-unique, so executable pointers alone
   were rejected as method identity.
8. Exact MethodInfo invocation preserved normal managed dictionary behavior
   without hooking shared generic bodies.
9. Current objects are rediscovered per command to avoid stale cross-battle
   pointers.
10. Simple authoritative state is mutated once rather than enforced by polling.
11. Obfuscated inline values are decoded/updated through their metadata-defined
   fields and verified, never guessed by raw offset.
12. Invincibility is modeled as one owned contribution, allowing normal game
    buffs to coexist and enabling an exact inverse operation.
13. A native interceptor is retained only for the ordinary AOT network boundary
    where runtime hits validated the approach.
14. Startup policy is kept in configuration, while TypeScript stays neutral on
    load.
15. Submitted result data and replay commands remain separate from local state;
    any future change must consider both consistency surfaces.

## Handoff rule for another AI

When continuing this project, treat this README, the original wrapped bundle,
its recorded load offset, the normalized inner bundle, the matching recovered
DLLs, the fresh ILSpy export, and the current TypeScript as one evidence set.
Do not generate a new hook solely from a method name or `virtualAddress`. First
state:

1. whether the code-bearing bundle has a canonical header at offset zero or a
   proven nonzero load-offset wrapper;
2. whether the extracted payload is a structurally valid PE/CLI assembly;
3. whether the target lives in AOT IL2CPP or a HybridCLR hot-update assembly;
4. whether the desired behavior is better represented by stable mutable state;
5. the exact declaring class, signature, parameter types, and field layout;
6. whether the candidate native address is unique and actually hit;
7. the object-discovery and lifecycle strategy;
8. the rollback/ownership strategy; and
9. what result, statistics, replay, or network data can expose the change.

Only after those questions are answered should the agent be modified.
