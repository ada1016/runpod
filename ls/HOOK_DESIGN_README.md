# Legend Summoner Hook: Reverse-Engineering and Design Notes

This document explains why `legendsummoner-hooks.ts` was designed as it is.
It is a technical handoff for a developer or AI continuing the analysis. It is
not an installation or command-usage guide.

## Scope

The agent implements three independent client-side behaviors:

1. intercept calculated battle damage and apply one combat multiplier in
   opposite directions for allied and enemy projectiles;
2. intercept summoner experience awards and multiply their argument; and
3. mock the local advertisement-ticket availability model for UI/client-flow
   testing.

It also exposes mutable settings through Frida RPC and the interactive global
object so values can be changed without unloading the agent.

## What was actually recovered

The analysis used artifacts from a Unity IL2CPP application:

- a decrypted application/native image suitable for static inspection;
- `global-metadata.dat`;
- IL2CPP dump output such as `dump.cs`;
- generated dummy managed assemblies such as `Assembly-CSharp.dll`;
- the running game's IL2CPP metadata through `frida-il2cpp-bridge`; and
- an existing working native dylib as behavioral evidence that the target
  functionality could be altered.

“Decrypted” here refers to obtaining a loadable/inspectable application binary
from the protected iOS application package. It does **not** mean that
`Assembly-CSharp.dll` contains the original C# implementation.

### Why ILSpy showed empty methods

This is an IL2CPP game. Unity converted managed C# method bodies into native
machine code ahead of time. The generated `Assembly-CSharp.dll` is a
`Il2CppDummyDll` reconstruction that restores:

- namespaces;
- classes;
- fields;
- method names;
- signatures;
- tokens; and
- attributes containing addresses, when available.

It generally cannot restore executable C# bodies. Therefore ILSpy may display:

```csharp
[Address(RVA = "0x35D4AE0", Offset = "0x35D4AE0", VA = "0x35D4AE0")]
private double CalcDamage(
    ref SystemState state,
    ProjectileDataComponent projectileData,
    Entity targetEntity)
{
    return default(double);
}
```

The `return default(double)` statement is a dummy body. It does not mean the
game's real method returns zero or does nothing. The real implementation exists
as ARM64 native code in the loaded application image.

The useful parts of this reconstruction were the exact declaring type,
signature, field layout, and RVA correspondence. Runtime metadata was then used
to resolve the current process address, avoiding reliance on a hard-coded
absolute address.

## Why runtime metadata resolution is used

The original dump identified:

```text
LS.HitProcessSystem.CalcDamage(
    Unity.Entities.SystemState&,
    LS.ProjectileDataComponent,
    Unity.Entities.Entity
) -> System.Double
```

and:

```text
LS.Battle.Models.Summoner.AddExp(System.UInt32) -> System.Void
```

A dump RVA such as `0x35D4AE0` is not itself a stable absolute pointer.
Address-space layout randomization changes the module base between launches,
and builds can move methods. Earlier attempts that treated the RVA as a fixed
address reached executable bytes but Frida could not reliably intercept the
calculated address.

The agent instead asks the live IL2CPP runtime for:

```typescript
const image = Il2Cpp.domain.assembly("Assembly-CSharp").image;
const hitProcess = image.class("LS.HitProcessSystem");
const calcDamage = selectMethod(hitProcess, "CalcDamage", [
    "Unity.Entities.SystemState&",
    "LS.ProjectileDataComponent",
    "Unity.Entities.Entity"
]);
```

`method.virtualAddress` is therefore derived from the currently loaded
process, with the correct slide already applied.

## Why methods are matched by full signature

Selecting only by method name is unsafe because IL2CPP classes may contain
overloads, generated wrappers, or similarly named methods. `selectMethod()`
requires:

- the exact method name;
- the exact parameter count; and
- the exact IL2CPP type name for every parameter.

If no exact match exists, it prints the available same-name signatures. This
makes a game update fail visibly instead of silently attaching to the wrong
method.

Return types are implied by the known target and by each `NativeFunction` /
`NativeCallback` declaration. A future hardening improvement could validate
the runtime return type too.

## Why `CalcDamage` is the damage interception point

`CalcDamage` is a high-value interception point because it produces the
numeric damage result before downstream hit processing consumes it. Hooking the
returned `double` changes the calculated amount without requiring continuous
hero-object scanning or repeated writes to defensive attributes.

The replacement deliberately calls the original first:

```typescript
const result = originalCalcDamage(
    self,
    state,
    projectileData,
    targetEntity
) as number;
```

This preserves the game's normal calculation, including buffs, debuffs,
critical-hit logic, stage scaling, and other rules that may exist inside the
native implementation. The agent transforms only the final result.

This is preferable to recreating the full damage formula from incomplete dummy
assemblies.

## Native ABI assumptions for `CalcDamage`

The replacement declares:

```typescript
"double",
["pointer", "pointer", "pointer", "pointer"]
```

The four native arguments represent:

1. `self`, because `CalcDamage` is an instance method;
2. the by-reference `SystemState`;
3. the native representation/address of `ProjectileDataComponent`; and
4. `Entity`.

The native callback returns a JavaScript number, which Frida marshals as a
native `double`.

These ABI assumptions are build- and platform-sensitive. If a future build
changes the signature, converts the method to static, Burst-compiles it through
a different entry point, or changes value-type passing, the callback definition
must be revalidated before reuse.

## Why projectile ownership must be read

A simple `result * multiplier` changed damage for both sides. A later attempt
to combine attack and defence effects without correctly identifying ownership
caused both the player and enemies to receive very small damage.

The required behavior is asymmetric:

```text
allied projectile -> outgoing damage × combat multiplier
enemy projectile  -> incoming damage ÷ combat multiplier
```

The ownership signal was found in:

```text
LS.ProjectileDataComponent.IsAlly : System.Boolean
```

`IsAllyTarget` also exists but represents a different concept and must not be
substituted. The resolver therefore prefers the exact `IsAlly` field. It uses
a fuzzy “ally” fallback only when exactly one candidate exists; otherwise it
disables combat modification and prints every Boolean field instead of
guessing.

This fail-closed behavior is intentional. Incorrect ownership detection
corrupts both outgoing and incoming damage.

## Boxed metadata offset versus unboxed struct offset

`ProjectileDataComponent` is a value type. The bridge reports field offsets
for its boxed IL2CPP layout. A boxed object starts with a two-pointer IL2CPP
object header:

```text
Il2CppObject
├── klass/vtable pointer
├── monitor pointer
└── value-type data
```

`CalcDamage`, however, receives the component as an unboxed native value-type
argument. Reading the boxed metadata offset directly would be displaced by two
pointers and could read another Boolean or unrelated data.

The conversion is:

```typescript
nativeOffset = metadataOffset - (Process.pointerSize * 2);
```

On a 64-bit process this subtracts 16 bytes. In the observed metadata,
`IsAlly` was reported at boxed offset `0x10`, producing native offset
`0x0`.

This correction was central to making ally/enemy discrimination work.

## Combat multiplier semantics

The shared `multipliers.combat` value is consulted on every intercepted call:

```typescript
return isAlly
    ? result * multipliers.combat
    : result / multipliers.combat;
```

The multiplier is constrained to an integer from 1 through 20:

- `1` restores neutral behavior without uninstalling the interceptor;
- values above `1` increase outgoing allied damage;
- the same value reduces incoming enemy damage.

The current attached source initializes combat to `8`. In the newer
configuration-driven launcher design, the preferred architecture is to
initialize it to `1` and place `inc(8)` in `hook_pid.json`. Do not keep
both sources of truth unless the duplication is deliberate.

The name `inc` is retained as the public control for compatibility with the
existing workflow, although a future API might name it `setCombatMultiplier`
for clarity.

## Why `AddExp(uint)` is intercepted at its argument

The experience hook targets:

```text
LS.Battle.Models.Summoner.AddExp(System.UInt32)
```

Instead of replacing the whole function, the callback multiplies its unsigned
32-bit argument and then calls the original:

```typescript
const adjusted = Math.min(
    0xffffffff,
    exp * multipliers.exp
) >>> 0;

originalAddExp(self, adjusted);
```

This preserves all original state transitions and level-up behavior inside
`AddExp`. The explicit cap prevents overflow beyond `UInt32.MaxValue`, and
`>>> 0` normalizes the value to unsigned 32-bit form before the native call.

The EXP multiplier is restricted to integers from 1 through 5. The attached
source initializes it to `2`; under the configuration-driven design, use a
neutral internal value of `1` and put `addExp(2)` in `hook_pid.json`.

## Why the original function is captured before replacement

For each target, the code creates a callable `NativeFunction` before invoking
`Interceptor.replace()`. The replacement can therefore delegate to the
original implementation.

The code intentionally uses regular `Interceptor.replace()` rather than
`replaceFast()`. Regular replacement proved more compatible with the
PlayCover/Darwin environment used during testing. This is an empirical platform
choice, not a universal rule.

Keeping the `NativeCallback` reachable through the installed interceptor is
also important; constructing transient callbacks without a retained native
replacement can invite lifetime problems.

## Advertisement-ticket mock

Static inspection identified the client-side advertisement availability model:

```text
LS.Database.BoADTicket
├── get_RewardCount()
├── get_MaxRewardCount()
├── GetRemainRewardCount()
├── GetRemainWatchCount()
└── IsEnable()
```

The agent replaces these getters so local code observes a consistent available
state:

- reward count is reported as zero;
- maximum reward count is the configured mock count;
- remaining reward count is the configured mock count;
- remaining watch count is the configured mock count; and
- availability is true when the mock count is greater than zero.

The public `adMock(n)` control accepts 0 through 99. A value of zero disables
the mock and delegates to the captured originals.

### What this mock does not establish

This is a client-model/UI-flow mock. It does not generate a valid server
transaction, server reward record, receipt, or authoritative inventory change.
Analysis of the request/response model showed an advertisement claim flow
involving request/result DTOs and server-returned rewards/ticket state.

Consequently:

- changing these getters may make a button appear available;
- it may let local presentation logic enter a claim path;
- it does not prove that a remote service will authorize a claim; and
- server responses can overwrite or reject the mocked client assumption.

This boundary must remain explicit in future documentation and tests.

## Why integer and Boolean getter callbacks differ

Frida's native callback ABI expects a numeric representation for a native
Boolean return. The Boolean replacement therefore returns `1` or `0`,
instead of a TypeScript `boolean`:

```typescript
(self: NativePointer): number =>
    adMockState.enabled
        ? (mockedValue() ? 1 : 0)
        : Number(original(self))
```

This resolves the TypeScript mismatch where a callback returning `boolean`
was not assignable to Frida's numeric native callback implementation.

## Runtime controls and shared state

The public API is:

| Command | State/effect |
| --- | --- |
| `inc(n)` | Set combat multiplier to integer 1–20 |
| `addExp(n)` | Set EXP multiplier to integer 1–5 |
| `adMock(n)` | Set local AD-ticket mock count to integer 0–99; zero disables |
| `status()` | Return installation state, current multipliers, resolved ally offset, and AD mock state |

The callbacks read shared state on every invocation. Installing the native
interceptor is therefore a one-time operation; changing `inc()` or
`addExp()` later immediately affects subsequent calls without replacing the
hook again.

The API is exposed in two ways:

```typescript
rpc.exports = api;
Object.assign(globalThis, api);
```

- `rpc.exports` supports external Frida clients.
- assigning to `globalThis` supports the interactive Frida prompt and the
  launcher's `default_hook` expressions.

The global assignment occurs before `Il2Cpp.perform(installHooks)`. This lets
the launcher resolve the command names as soon as the script has loaded, even
though native hook installation waits for an IL2CPP-safe execution context.

## Configuration-driven defaults

The newer launcher reads startup expressions from a project-local
`hook_pid.json`, for example:

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

For that architecture, the TypeScript should use:

```typescript
const multipliers: MultiplierState = {
    exp: 1,
    combat: 1
};
```

The attached source predates that final cleanup and still contains:

```typescript
const multipliers: MultiplierState = {
    exp: 2,
    combat: 8
};
```

Both arrangements produce the same initial values when the JSON also calls
`inc(8)` and `addExp(2)`, but neutral internal defaults are preferable
because:

- configuration becomes the single source of truth;
- loading the agent directly is predictably neutral;
- changing JSON does not require rebuilding TypeScript; and
- another AI is less likely to update one default but miss the other.

## Installation timing and failure behavior

`Il2Cpp.perform(installHooks)` defers native resolution until the IL2CPP
runtime is ready. Inside that block the agent:

1. resolves `Assembly-CSharp`;
2. installs the AD getter replacements;
3. resolves `CalcDamage` and `AddExp`;
4. resolves the native `IsAlly` offset;
5. constructs original functions and native callbacks;
6. replaces the two native entry points; and
7. sets `ready = true`.

There is no rollback transaction. If an exception occurs after some
`Interceptor.replace()` calls have succeeded, the process may contain a
partial installation. Future work should either resolve and validate every
target before the first replacement or track installed replacements for
explicit rollback.

The combat callback fails closed when:

- the multiplier is neutral;
- the ally offset could not be resolved; or
- the projectile pointer is null.

It then returns the original result unchanged.

## Stability choices

The implementation avoids:

- repeatedly scanning the managed heap;
- polling hero state;
- hard-coded absolute addresses;
- reconstructing the damage formula;
- selecting overloads by name alone;
- assuming `IsAllyTarget` means projectile ownership; and
- reading a boxed value-type offset from an unboxed argument.

Each of those alternatives either caused incorrect behavior during earlier
iterations or would be more fragile across launches.

The remaining sensitive areas are:

- exact native ABI declarations;
- whether the method remains a directly interceptable IL2CPP entry point;
- whether Unity/Burst changes method routing;
- whether value-type layout changes;
- whether field and type names are obfuscated or renamed;
- duplicate/shared native method addresses in generated code; and
- partial installation if a later hook fails.

## Update checklist for a new game build

Before reusing the agent against an updated binary:

1. regenerate IL2CPP metadata/dummy assemblies from matching artifacts;
2. confirm the assembly and fully qualified class names;
3. confirm the complete `CalcDamage` signature and return type;
4. confirm whether `CalcDamage` is still an instance method;
5. confirm the `AddExp(UInt32)` signature;
6. inspect `ProjectileDataComponent` Boolean fields;
7. verify that exact `IsAlly` semantics still represent projectile ownership;
8. verify boxed-to-unboxed offset conversion against the runtime layout;
9. inspect each virtual address with `Process.findRangeByAddress()` and
   `Instruction.parse()` before replacing it;
10. test neutral values first: `inc(1)` and `addExp(1)`;
11. test allied and enemy damage separately at a low multiplier;
12. validate UInt32 EXP behavior and overflow handling;
13. validate AD getters against the current client model without assuming
   server authorization; and
14. confirm `status().ready` only after every required hook is installed.

## Recommended future improvements

### Resolve everything before mutation

Perform all class, method, signature, address, protection, and field-offset
validation before the first `Interceptor.replace()`. This reduces the chance
of a partially installed agent.

### Validate executable memory

Before constructing a native hook:

```typescript
const range = Process.findRangeByAddress(method.virtualAddress);
if (range === null || !range.protection.includes("x")) {
    throw new Error("method address is not executable");
}
```

### Add installation diagnostics

Record resolved class names, method signatures, method handles, addresses,
module names, and native offsets in `status()`. This makes comparisons across
game versions easier.

### Make AD hook installation optional

The attached source installs the AD mock unconditionally with count five.
A cleaner design would start it disabled and enable it only through
`adMock(n)`, or separate it into a test-specific agent.

### Improve lifecycle control

`Interceptor.replace()` is process-wide. A future version should retain enough
state to revert replacements when unloading or explicitly disabling the agent,
provided restoration can be performed safely.

### Use clearer command names while preserving aliases

Future APIs could expose:

```text
setCombatMultiplier(n)
setExpMultiplier(n)
setAdMockCount(n)
```

while keeping `inc`, `addExp`, and `adMock` as compatibility aliases.

## Concise reasoning chain

The final approach follows this reasoning:

1. Dummy DLL methods are metadata reconstructions, so their empty bodies are
   not evidence that the native game method is empty.
2. Dump metadata identifies the exact classes, signatures, fields, and RVA.
3. The live IL2CPP runtime supplies the correctly rebased method addresses.
4. Calling the original method preserves unknown game logic.
5. Modifying the returned damage is simpler than rebuilding its formula.
6. Damage direction requires the projectile's exact `IsAlly` field.
7. Because the projectile component is passed unboxed, its field offset must
   exclude the boxed object header.
8. One shared multiplier can model increased allied attack and reduced incoming
   enemy damage.
9. EXP is safest to alter at the `UInt32` argument while preserving the
   original level-up routine.
10. AD getter replacements affect client availability state only and do not
    establish server authority.
11. Mutable shared state allows settings to change without reinstalling native
    hooks.
12. Global exports let the project launcher apply defaults from JSON, while
    neutral TS defaults prevent duplicated configuration.
