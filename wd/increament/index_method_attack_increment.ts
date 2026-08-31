import "frida-il2cpp-bridge";

/*
 * Frida TypeScript port of the behavior recovered from
 * wittledefender(2).dylib / IDA sub_39C50.
 *
 * Confirmed managed path:
 *   BattleMainUI
 *     -> _mechaSkillNode
 *     -> _myCamp
 *     -> _heroList
 *     -> each hero
 *
 * God mode calls ChangeHp(-9,999,999,999). The managed implementation uses
 * CurrentHp -= hp, so this negative Int64 heals. It is not a ChangeHp hook.
 *
 * Attack mode calls GetRoleAttr(), obtains its AttributeMap field (a
 * Dictionary<int,int>), reads key 1 with get_Item, and raises it with set_Item.
 *
 * No method.virtualAddress is intercepted: HybridCLR methods may share an
 * interpreter/native thunk, so attaching to such an address is not reliably
 * method-specific.
 */

const ASSEMBLY_NAME = "HotFix";
const BATTLE_UI_NAME = "HotFix.Battle.UI.BattleMainUI";
const MECHA_NODE_NAME = "HotFix.Battle.UI.MechaSkillNode";

const WATCH_INTERVAL_MS = 500;
const LOAD_RETRY_MS = 500;
const ATTACK_KEY = 1;
const DEFENCE_KEY = 6;
const DEFENCE_PERCENT_KEY = 7;
const SKILL_SPEED_KEY = 11;
const HP_RECOVERY_KEY = 5;

const ATTACK_CAP = 2_000_000_000;
const GOD_MODE_HP_ARGUMENT = new Int64("-99");

type RuntimeInvokeFunction = NativeFunction<
    NativePointer,
    [NativePointer, NativePointer, NativePointer, NativePointer]
>;

let runtimeInvokeFunction: RuntimeInvokeFunction | null = null;
let objectUnboxFunction: NativeFunction<
    NativePointer,
    [NativePointer]
> | null = null;

type ChangeHpNativeFunction = NativeFunction<
    Int64,
    [NativePointer, Int64, NativePointer]
>;

let changeHpMethod: Il2Cpp.Method<Int64> | null = null;
let changeHpPointerSlot: NativePointer | null = null;
let changeHpOriginalAddress: NativePointer | null = null;
let changeHpOriginal: ChangeHpNativeFunction | null = null;
let changeHpReplacement: NativeCallback<any, any> | null = null;
let changeHpHookInstalled = false;
let changeHpHookHits = 0;
let blockedDamageCalls = 0;
let foreignMethodInfoCalls = 0;
let hookErrors = 0;
let tickBusy = false;

type Settings = {
    godMode: boolean;
    attackEnabled: boolean;
    attackValue: number;
};

type TickStats = {
    battleUis: number;
    heroes: number;
    healed: number;
    attackChanged: number;
};

type HeroStatus = {
    hero: string;
    className: string;
    handle: string;
    healed: boolean;
    attackBefore: number | null;
    attackAfter: number | null;
    attackChanged: boolean;
    lastAttackChange: {
        from: number;
        to: number;
        at: string;
    } | null;
};

type AttackResult = {
    before: number | null;
    after: number | null;
    changed: boolean;
};

type HeroAttributes = {
    hero: number;
    className: string;
    handle: string;
    CurrentHp: string | null;
    Attack: number | null;
    Defence: number | null;
    DefencePercent: number | null;
    SkillSpeed: number | null;
    HPRecovery: number | null;
};



const settings: Settings = {
    godMode: false,
    attackEnabled: false,
    attackValue: 200
};

let battleUiClass: Il2Cpp.Class | null = null;
let watcher: ReturnType<typeof setInterval> | null = null;
let bootstrapTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastError = "";
let lastErrorAt = 0;
let lastStats: TickStats = emptyStats();
let lastHeroStatuses: HeroStatus[] = [];
const attackHistory = new Map<
    string,
    { from: number; to: number; at: string }
>();

function emptyStats(): TickStats {
    return { battleUis: 0, heroes: 0, healed: 0, attackChanged: 0 };
}

function log(message: string, ...values: unknown[]): void {
    console.log("[WittleDefender] " + message, ...values);
}

function logError(context: string, error: unknown): void {
    const text = context + ": " + String(error);
    const now = Date.now();
    if (text !== lastError || now - lastErrorAt >= 3000) {
        lastError = text;
        lastErrorAt = now;
        console.error("[WittleDefender] " + text);
    }
}

function findFieldInHierarchy(
    klass: Il2Cpp.Class,
    fieldName: string
): Il2Cpp.Field | null {
    let current: Il2Cpp.Class | null = klass;

    while (current !== null) {
        try {
            return current.field(fieldName);
        } catch (_) {
            current = current.parent;
        }
    }

    return null;
}
function readObfuscatedLongField(
    instance: Il2Cpp.Object,
    fieldName: string
): Int64 | null {
    try {
        const field = findFieldInHierarchy(instance.class, fieldName);
        if (field === null) {
            throw new Error("field not found");
        }

        // ObfuscatedLong is stored inline inside EntityRoleBase.
        const structAddress = instance.handle.add(field.offset);

        // RefreshKey() can update these fields while we read them.
        // Read the key twice and retry if it changed.
        for (let attempt = 0; attempt < 3; attempt++) {
            const keyBefore = structAddress.add(8).readS32();
            const obfuscated = structAddress.readS64();
            const keyAfter = structAddress.add(8).readS32();

            if (keyBefore !== keyAfter) {
                continue;
            }

            // Converting the signed int through its decimal string produces
            // the required sign-extended 64-bit representation.
            const extendedKey = new Int64(keyBefore.toString());
            return obfuscated.xor(extendedKey);
        }

        throw new Error("xor key changed during read");
    } catch (error) {
        logError(instance.class.name + "." + fieldName, error);
        return null;
    }
}

function readCurrentHp(hero: Il2Cpp.Object): string | null {
    const hp = readObfuscatedLongField(hero, "CurrentHp");

    // Return a string because JavaScript numbers cannot represent every Int64.
    return hp === null ? null : hp.toString();
}


function isAlive(object: Il2Cpp.Object | null | undefined): object is Il2Cpp.Object {
    return object !== null && object !== undefined && !object.handle.isNull();
}

function objectField(
    object: Il2Cpp.Object,
    name: string
): Il2Cpp.Object | null {
    try {
        // The bridge generic describes the non-null managed field type.
        // A null object reference is still possible at runtime, so check it below.
        const value = object.field<Il2Cpp.Object>(name).value;
        return isAlive(value) ? value : null;
    } catch (error) {
        logError(object.class.name + "." + name, error);
        return null;
    }
}

function findIl2CppExport(name: string): NativePointer {
    const moduleApi = Module as any;
    const address =
        moduleApi.findGlobalExportByName?.(name) ??
        moduleApi.findExportByName?.(null, name) ??
        null;

    if (address === null) {
        throw new Error("could not resolve " + name);
    }
    return address;
}

function initializeRuntimeInvoke(): void {
    if (runtimeInvokeFunction !== null) {
        return;
    }

    runtimeInvokeFunction = new NativeFunction(
        findIl2CppExport("il2cpp_runtime_invoke"),
        "pointer",
        ["pointer", "pointer", "pointer", "pointer"]
    ) as RuntimeInvokeFunction;

    objectUnboxFunction = new NativeFunction(
        findIl2CppExport("il2cpp_object_unbox"),
        "pointer",
        ["pointer"]
    ) as NativeFunction<NativePointer, [NativePointer]>;
}

function runtimeInvokeRaw(
    object: Il2Cpp.Object,
    name: string,
    parameterCount: number,
    argumentPointers: NativePointer[]
): NativePointer {
    initializeRuntimeInvoke();

    const method = object.method(name, parameterCount);
    const exceptionSlot = Memory.alloc(Process.pointerSize);
    exceptionSlot.writePointer(NULL);

    let argv = NULL;
    if (argumentPointers.length > 0) {
        argv = Memory.alloc(Process.pointerSize * argumentPointers.length);
        argumentPointers.forEach((argument, index) => {
            argv.add(index * Process.pointerSize).writePointer(argument);
        });
    }

    const result = runtimeInvokeFunction!(
        method.handle,
        object.handle,
        argv,
        exceptionSlot
    );

    const exception = exceptionSlot.readPointer();
    if (!exception.isNull()) {
        throw new Error(
            "managed exception from " + object.class.name + "." + name +
            " at " + exception
        );
    }
    return result;
}

function int32Argument(value: number): NativePointer {
    return Memory.alloc(4).writeS32(value);
}

function int64Argument(value: Int64): NativePointer {
    return Memory.alloc(8).writeS64(value);
}

function findMethodPointerSlot(method: Il2Cpp.Method): NativePointer | null {
    const methodAddress = method.handle;
    const virtualAddress = method.virtualAddress;
    const range = Process.findRangeByAddress(methodAddress);
    if (range === null || !range.protection.includes("r")) {
        return null;
    }

    const maximumBytes = Math.min(0x80, range.base.add(range.size).sub(methodAddress).toInt32());
    for (let offset = 0; offset + Process.pointerSize <= maximumBytes;
         offset += Process.pointerSize) {
        const candidate = methodAddress.add(offset);
        try {
            if (candidate.readPointer().equals(virtualAddress)) {
                return candidate;
            }
        } catch (_) {
            return null;
        }
    }
    return null;
}

function installChangeHpMethodInfoHook(hero: Il2Cpp.Object): boolean {
    if (changeHpHookInstalled) {
        return true;
    }

    try {
        const method = hero.method<Int64>("ChangeHp", 1);
        const originalAddress = method.virtualAddress;
        const executable = Process.findRangeByAddress(originalAddress);
        if (executable === null || !executable.protection.includes("x")) {
            throw new Error("ChangeHp virtualAddress is not executable");
        }

        const pointerSlot = findMethodPointerSlot(method);
        if (pointerSlot === null) {
            throw new Error("could not locate ChangeHp method-pointer slot");
        }

        const original = new NativeFunction(
            originalAddress,
            "int64",
            ["pointer", "int64", "pointer"]
        ) as ChangeHpNativeFunction;

        const methodInfo = method.handle;
        const replacement = new NativeCallback(
            (
                instance: NativePointer,
                hp: Int64,
                suppliedMethodInfo: NativePointer
            ): Int64 => {
                changeHpHookHits++;

                // A shared HybridCLR thunk needs the exact hidden MethodInfo*.
                // Only mutate calls that prove they belong to ChangeHp.
                if (!suppliedMethodInfo.equals(methodInfo)) {
                    foreignMethodInfoCalls++;
                    return original(instance, hp, suppliedMethodInfo);
                }

                const forwardedHp =
                    settings.godMode && hp.compare(new Int64(0)) > 0
                        ? GOD_MODE_HP_ARGUMENT
                        : hp;

                if (settings.godMode && hp.compare(new Int64(0)) > 0) {
                    blockedDamageCalls++;
                }

                try {
                    return original(instance, forwardedHp, suppliedMethodInfo);
                } catch (_) {
                    hookErrors++;
                    return new Int64(0);
                }
            },
            "int64",
            ["pointer", "int64", "pointer"]
        );

        const slotRange = Process.findRangeByAddress(pointerSlot);
        if (slotRange === null) {
            throw new Error("ChangeHp method-pointer slot is unmapped");
        }
        if (!slotRange.protection.includes("w")) {
            if (!Memory.protect(pointerSlot, Process.pointerSize, "rw-")) {
                throw new Error("could not make ChangeHp method-pointer writable");
            }
        }

        pointerSlot.writePointer(replacement);

        changeHpMethod = method;
        changeHpPointerSlot = pointerSlot;
        changeHpOriginalAddress = originalAddress;
        changeHpOriginal = original;
        changeHpReplacement = replacement;
        changeHpHookInstalled = true;

        log(
            "installed MethodInfo ChangeHp hook: method=" + method.handle +
            " slot=" + pointerSlot + " original=" + originalAddress
        );
        return true;
    } catch (error) {
        logError("install ChangeHp MethodInfo hook", error);
        return false;
    }
}

function uninstallChangeHpMethodInfoHook(): boolean {
    if (!changeHpHookInstalled ||
        changeHpPointerSlot === null ||
        changeHpOriginalAddress === null) {
        return true;
    }

    try {
        changeHpPointerSlot.writePointer(changeHpOriginalAddress);
        changeHpHookInstalled = false;
        log("restored original ChangeHp method pointer");
        return true;
    } catch (error) {
        logError("uninstall ChangeHp MethodInfo hook", error);
        return false;
    }
}

function invokeObject(
    object: Il2Cpp.Object,
    name: string,
    parameterCount: number,
    ...args: number[]
): Il2Cpp.Object | null {
    try {
        const result = runtimeInvokeRaw(
            object,
            name,
            parameterCount,
            args.map(int32Argument)
        );
        if (result.isNull()) {
            return null;
        }
        const managedObject = new Il2Cpp.Object(result);
        return isAlive(managedObject) ? managedObject : null;
    } catch (error) {
        logError(object.class.name + "." + name, error);
        return null;
    }
}

function invokeInt32(
    object: Il2Cpp.Object,
    name: string,
    parameterCount: number,
    ...args: number[]
): number | null {
    try {
        const boxed = runtimeInvokeRaw(
            object,
            name,
            parameterCount,
            args.map(int32Argument)
        );
        if (boxed.isNull()) {
            return null;
        }
        return objectUnboxFunction!(boxed).readS32();
    } catch (error) {
        logError(object.class.name + "." + name, error);
        return null;
    }
}

function getHeroes(battleUi: Il2Cpp.Object): Il2Cpp.Object[] {
    const mechaSkillNode = objectField(battleUi, "_mechaSkillNode");
    if (mechaSkillNode === null) {
        return [];
    }

    const myCamp = objectField(mechaSkillNode, "_myCamp");
    if (myCamp === null) {
        return [];
    }

    const heroList = objectField(myCamp, "_heroList");
    if (heroList === null) {
        return [];
    }

    const count = invokeInt32(heroList, "get_Count", 0);
    if (count === null || count <= 0 || count > 4096) {
        return [];
    }

    const heroes: Il2Cpp.Object[] = [];
    for (let index = 0; index < count; index++) {
        const hero = invokeObject(heroList, "get_Item", 1, index);
        if (hero !== null) {
            heroes.push(hero);
        }
    }
    return heroes;
}


function attackIncrement(): number {
    return Math.min(
        ATTACK_CAP,
        Math.max(1, Math.round(settings.attackValue))
    );
}

function applyAttack(
    hero: Il2Cpp.Object,
    increment: number
): AttackResult {
    const roleAttributes = invokeObject(
        hero,
        "GetRoleAttr",
        0
    );

    if (roleAttributes === null) {
        return {
            before: null,
            after: null,
            changed: false
        };
    }

    const map = objectField(
        roleAttributes,
        "AttributeMap"
    );

    if (map === null) {
        return {
            before: null,
            after: null,
            changed: false
        };
    }

    const currentAttack = invokeInt32(
        map,
        "get_Item",
        1,
        ATTACK_KEY
    );

    const currentDefence = invokeInt32(
        map,
        "get_Item",
        1,
        DEFENCE_KEY
    );

    if (
        currentAttack === null ||
        currentDefence === null
    ) {
        return {
            before: currentAttack,
            after: currentAttack,
            changed: false
        };
    }

    const updatedAttack = Math.min(
        ATTACK_CAP,
        currentAttack + increment
    );

    const updatedDefence = Math.min(
        ATTACK_CAP,
        currentDefence + increment
    );

    if (
        updatedAttack === currentAttack &&
        updatedDefence === currentDefence
    ) {
        return {
            before: currentAttack,
            after: currentAttack,
            changed: false
        };
    }

    try {
        // AttributeMap[Attack] += increment
        runtimeInvokeRaw(
            map,
            "set_Item",
            2,
            [
                int32Argument(ATTACK_KEY),
                int32Argument(updatedAttack)
            ]
        );

        // AttributeMap[Defence] += increment
        runtimeInvokeRaw(
            map,
            "set_Item",
            2,
            [
                int32Argument(DEFENCE_KEY),
                int32Argument(updatedDefence)
            ]
        );

        log(
            "Stats +" + increment +
            ": ATK " + currentAttack +
            " -> " + updatedAttack +
            ", DEF " + currentDefence +
            " -> " + updatedDefence
        );

        return {
            before: currentAttack,
            after: updatedAttack,
            changed: true
        };
    } catch (error) {
        logError(
            map.class.name + ".set_Item(ATK/DEF)",
            error
        );

        return {
            before: currentAttack,
            after: currentAttack,
            changed: false
        };
    }
}

function readHeroAttributes(
    hero: Il2Cpp.Object,
    heroIndex: number
): HeroAttributes | null {
    const roleAttributes = invokeObject(hero, "GetRoleAttr", 0);
    if (roleAttributes === null) {
        return null;
    }

    const map = objectField(roleAttributes, "AttributeMap");

    if (map === null) {
        return null;
    }
    // Read CurrentHp directly from EntityRoleBase.
    const currentHp = readCurrentHp(hero);

    return {
        hero: heroIndex,
        className: hero.class.name,
        handle: hero.handle.toString(),
        CurrentHp: currentHp,
        Attack: invokeInt32(map, "get_Item", 1, ATTACK_KEY),
        Defence: invokeInt32(map, "get_Item", 1, DEFENCE_KEY),
        DefencePercent: invokeInt32(map,"get_Item",1,DEFENCE_PERCENT_KEY),
        SkillSpeed: invokeInt32(map, "get_Item", 1, SKILL_SPEED_KEY),
        HPRecovery: invokeInt32(map,"get_Item",1,HP_RECOVERY_KEY),
    };
}

function formatAttributeValue(
    value: number | string | null
): string {
    return value === null ? "N/A" : String(value);
}

function formatHeroAttributes(attributes: HeroAttributes): string {
    return [
        "Hero " + attributes.hero + ":",
        "HP=" + formatAttributeValue(attributes.CurrentHp),
        "ATK=" + formatAttributeValue(attributes.Attack),
        "DEF=" + formatAttributeValue(attributes.Defence),
        "DEF%=" + formatAttributeValue(attributes.DefencePercent),
        "SkillSpeed=" + formatAttributeValue(attributes.SkillSpeed),
        "HPRecovery=" + formatAttributeValue(attributes.HPRecovery),
    ].join(" ");
}

function collectHeroAttributes(): {
    heroes: HeroAttributes[];
    lines: string[];
} {
    const result: HeroAttributes[] = [];
    if (battleUiClass === null) {
        return { heroes: result, lines: [] };
    }

    let battleUis: Il2Cpp.Object[] = [];
    try {
        battleUis = Il2Cpp.gc.choose(battleUiClass);
    } catch (error) {
        logError("heroStatus gc.choose(BattleMainUI)", error);
        return { heroes: result, lines: [] };
    }

    let heroIndex = 0;
    for (const battleUi of battleUis) {
        if (!isAlive(battleUi)) {
            continue;
        }

        for (const hero of getHeroes(battleUi)) {
            const attributes = readHeroAttributes(hero, heroIndex++);
            if (attributes !== null) {
                result.push(attributes);
            }
        }
    }

    const lines = result.map(formatHeroAttributes);
    if (lines.length > 0) {
        // Leading newline separates output from the Frida prompt.
        // One console call prevents output from interleaving.
        console.log(
            "\n[Hero Attributes]\n" +
            lines.join("\n")
        );
    } else {
        console.log("\n[Hero Attributes]\nNo heroes found");
    }
    return { heroes: result, lines };
}

function processOnce(): TickStats {
    const stats = emptyStats();
    const discoverGodHook = settings.godMode && !changeHpHookInstalled;
    if (battleUiClass === null || (!discoverGodHook && !settings.attackEnabled)) {
        return stats;
    }

    const increment = attackIncrement();
    const heroStatuses: HeroStatus[] = [];
    let heroNumber = 0;
    let battleUis: Il2Cpp.Object[] = [];
    try {
        battleUis = Il2Cpp.gc.choose(battleUiClass);
    } catch (error) {
        logError("Il2Cpp.gc.choose(BattleMainUI)", error);
        return stats;
    }

    stats.battleUis = battleUis.length;
    for (const battleUi of battleUis) {
        if (!isAlive(battleUi)) {
            continue;
        }
        const heroes = getHeroes(battleUi);
        stats.heroes += heroes.length;

        for (const hero of heroes) {
            heroNumber++;
            if (discoverGodHook && !changeHpHookInstalled) {
                installChangeHpMethodInfoHook(hero);
            }
            const healed = false;

            const attack = settings.attackEnabled
                ? applyAttack(hero, increment)
                : { before: null, after: null, changed: false };

            if (attack.changed) {
                stats.attackChanged++;
            }

            const handle = hero.handle.toString();
            if (attack.changed &&
                attack.before !== null &&
                attack.after !== null) {
                attackHistory.set(handle, {
                    from: attack.before,
                    to: attack.after,
                    at: new Date().toISOString()
                });
            }

            heroStatuses.push({
                hero: "hero" + heroNumber,
                className: hero.class.name,
                handle,
                healed,
                attackBefore: attack.before,
                attackAfter: attack.after,
                attackChanged: attack.changed,
                lastAttackChange: attackHistory.get(handle) ?? null
            });
        }
    }

    lastStats = stats;
    lastHeroStatuses = heroStatuses;
    // Attack is an exact one-shot update. Keeping it enabled would bring back
    // the expensive gc.choose/dictionary polling loop.
    if (settings.attackEnabled && stats.heroes > 0) {
        settings.attackEnabled = false;
    }
    return stats;
}

function tick(): void {
    if (!running || tickBusy) {
        return;
    }
    tickBusy = true;
    try {
        Il2Cpp.perform(() => {
            try {
                processOnce();
            } finally {
                tickBusy = false;
            }
        });
    } catch (error) {
        tickBusy = false;
        logError("tick", error);
    }
}

function resolveClasses(): boolean {
    try {
        const assembly = Il2Cpp.domain.assemblies.find(
            candidate => candidate.name === ASSEMBLY_NAME
        );
        if (assembly === undefined) {
            return false;
        }

        // Resolve both names because the original Domain::wait requires both.
        const battle = assembly.image.class(BATTLE_UI_NAME);
        assembly.image.class(MECHA_NODE_NAME);
        battleUiClass = battle;
        return true;
    } catch (_) {
        return false;
    }
}

function startWatcher(): void {
    if (watcher !== null) {
        return;
    }
    running = true;
    watcher = setInterval(tick, WATCH_INTERVAL_MS);
    log("watcher started; mutations are disabled until enabled through RPC");
}

function statusSnapshot(): object {
    return {
        running,
        resolved: battleUiClass !== null,
        settings: { ...settings },
        attackIncrement: attackIncrement(),
        lastStats: { ...lastStats },
        changeHpHook: {
            installed: changeHpHookInstalled,
            methodInfo: changeHpMethod?.handle.toString() ?? null,
            pointerSlot: changeHpPointerSlot?.toString() ?? null,
            originalAddress: changeHpOriginalAddress?.toString() ?? null,
            hits: changeHpHookHits,
            blockedDamageCalls,
            foreignMethodInfoCalls,
            errors: hookErrors
        }
    };
}


function bootstrap(): void {
    if (bootstrapTimer !== null) {
        return;
    }

    const attempt = (): void => {
        Il2Cpp.perform(() => {
            if (!resolveClasses()) {
                return;
            }
            if (bootstrapTimer !== null) {
                clearInterval(bootstrapTimer);
                bootstrapTimer = null;
            }
            log("resolved " + BATTLE_UI_NAME + " and " + MECHA_NODE_NAME);
            startWatcher();
        });
    };

    bootstrapTimer = setInterval(attempt, LOAD_RETRY_MS);
    attempt();
}

rpc.exports = {
    readattributes(): Promise<object> {
        return new Promise(resolve => {
            Il2Cpp.perform(() => {
                if (tickBusy) {
                    resolve({
                        error: "another IL2CPP operation is currently running",
                        heroes: [],
                        lines: []
                    });
                    return;
                }

                tickBusy = true;
                try {
                    resolve(collectHeroAttributes());
                } finally {
                    tickBusy = false;
                }
            });
        });
    },

    
    status(): object {
        return statusSnapshot();
    },

    configure(options: Partial<Settings>): object {
        if (typeof options.godMode === "boolean") {
            settings.godMode = options.godMode;
        }
        if (typeof options.attackEnabled === "boolean") {
            settings.attackEnabled = options.attackEnabled;
        }
        if (typeof options.attackValue === "number" &&
            Number.isFinite(options.attackValue)) {
            settings.attackValue = Math.max(
                1,
                Math.round(options.attackValue)
            );
        }
        log("settings updated", settings);
        return statusSnapshot();
    },

    setgodmode(enabled: boolean): object {
        settings.godMode = Boolean(enabled);
        return statusSnapshot();
    },

    inc_att(enabled: boolean, value?: number): object {
        settings.attackEnabled = Boolean(enabled);
        if (typeof value === "number" && Number.isFinite(value)) {
            settings.attackValue = Math.max(1, Math.round(value));
        }
        return statusSnapshot();
    },

    applyonce(): Promise<TickStats> {
        return new Promise(resolve => {
            Il2Cpp.perform(() => resolve(processOnce()));
        });
    },

    stop(): object {
        running = false;
        if (watcher !== null) {
            clearInterval(watcher);
            watcher = null;
        }
        uninstallChangeHpMethodInfoHook();
        return statusSnapshot();
    },

    unhookchangehp(): object {
        settings.godMode = false;
        uninstallChangeHpMethodInfoHook();
        return statusSnapshot();
    }
};

setImmediate(bootstrap);
