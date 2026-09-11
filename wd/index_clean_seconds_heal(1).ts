import "frida-il2cpp-bridge";

/*
 * Commands: revive(), reroll(96), inc(100), heal(50), read(), god(), god(5),
 * god(false), traceend(), traceend(false), traceendstatus().
 * Only reroll(96) runs automatically on agent load.
 *
 * revive() sets AdReviveTimes to 5; it does not resurrect a hero.
 * inc(percent) increases ATK/DEF proportionally and adds the same outgoing
 * healing percentage through RecoveryRate, for every current player hero once.
 * heal(percent) adds only outgoing healing percentage through RecoveryRate.
 * read() prints HP/ATK/DEF/DEF%/Heal%/SkillSpeed/HPRecovery.
 *
 * LevelEndRequest tracing is opt-in and diagnostic only. It resolves
 * GameApp.NetWork.Send from live metadata, attaches once, and filters by the
 * request object's runtime class before reading Result/CommonParams/Commands.
 * Supported end requests: LevelEndRequest and GoldExpDungeonEndRequest.
 * There is no HP hook, method-pointer patch, or continuous watcher.
 * HybridCLR methods are invoked through il2cpp_runtime_invoke, never hooked.
 * Objects are discovered per command, not cached across battles.
 * Exception: god() holds pinned GC references until god(false). Disable before
 * leaving battle, unloading/reloading the agent, or detaching. No auto-restore.
 * god() adds one InvincibleCount contribution; it does not heal or intercept HP.
 * god(seconds) adds the same contribution with one automatic-disable timer.
 * A new successful god command replaces/cancels the timer. Timing is wall-clock,
 * not simulation time, and can be delayed if the agent or a command is blocked.
 * Balanced game buff increments/decrements preserve our contribution, but
 * resets, object pooling and concurrent game writes can invalidate ownership.
 * Calls retain the uploaded script's Il2Cpp.perform thread behavior; this
 * is not a guarantee of Unity-main-thread execution or freedom from races.
 */

const UI_ASSEMBLY = "HotFix";
const BATTLE_ASSEMBLY = "HotFixBattle";
const BATTLE_UI = "HotFix.Battle.UI.BattleMainUI";
const BATTLE_MANAGER = "HotFix.Battle.BattleLogicMgr";
const LEVELS_TABLE = "LocalModels.Bean.Levels_table";
const DEFAULT_REROLL = 96;
const AD_REVIVES = 5;
const STAT_CAP = 2_000_000_000;
const REROLL_RETRY_MS = 3000;
const REROLL_MAX_ATTEMPTS = 30;
const ATTRIBUTE_KEYS = {
    Attack: 1, Defence: 6, DefencePercent: 7, SkillSpeed: 11,
    HPRecovery: 5, RecoveryRate: 47
} as const;
const ATTRIBUTE_PERCENT_SCALE = 10000; // 10000 raw units = 100%
const MAX_INCREMENT_PERCENT = 1000;

type HeroAttributes = {
    hero: number;
    className: string;
    handle: string;
    CurrentHp: string | null;
    Attack: number | null;
    Defence: number | null;
    DefencePercent: number | null;
    RecoveryRate: number | null;
    SkillSpeed: number | null;
    HPRecovery: number | null;
};
type HeroReport = { heroes: HeroAttributes[]; lines: string[]; errors: string[] };
type CommandError = { ok: false; error: string };
type EndTraceState = {
    installed: boolean;
    networkClass: string | null;
    methodInfo: string | null;
    address: string | null;
    candidateSignatures: string[];
    observedRequestClasses: Record<string, number>;
    sendCalls: number;
    levelEndMatches: number;
    dumps: number;
    errors: number;
    lastError: string | null;
};
type RuntimeInvoke = NativeFunction<
    NativePointer, [NativePointer, NativePointer, NativePointer, NativePointer]
>;

let runtimeInvoke: RuntimeInvoke | null = null;
let objectUnbox: NativeFunction<NativePointer, [NativePointer]> | null = null;
let operationBusy = false;
let rerollTimer: ReturnType<typeof setTimeout> | null = null;
let rerollGeneration = 0;
const godReferences = new Set<Il2Cpp.GCHandle>();
let godFault = false;
let godTimer: ReturnType<typeof setTimeout> | null = null;
let godTimerGeneration = 0;
let pendingGodExpiry: number | null = null;
const endTraceListeners: InvocationListener[] = [];
const endTraceState: EndTraceState = {
    installed: false,
    networkClass: null,
    methodInfo: null,
    address: null,
    candidateSignatures: [],
    observedRequestClasses: {},
    sendCalls: 0,
    levelEndMatches: 0,
    dumps: 0,
    errors: 0,
    lastError: null
};

function expireGod(generation: number): void {
    if (generation !== godTimerGeneration) return;
    if (operationBusy) {
        // Finish immediately after the active command releases the lock.
        // Do not start a polling loop or lose the automatic disable request.
        pendingGodExpiry = generation;
        return;
    }
    void godCommand(false).then(result => {
        if (!(result as { ok?: boolean }).ok) {
            log("god auto-disable failed: " + JSON.stringify(result));
        }
    });
}

function setGodTimer(seconds: number | null): void {
    if (godTimer !== null) clearTimeout(godTimer);
    godTimer = null;
    pendingGodExpiry = null;
    const generation = ++godTimerGeneration;
    if (seconds === null) return;
    godTimer = setTimeout(() => {
        if (generation !== godTimerGeneration) return;
        godTimer = null;
        expireGod(generation);
    }, Math.ceil(seconds * 1000));
    log("No God in " + seconds + " seconds");
}

function invincibleFields(hero: Il2Cpp.Object) {
    const field = hero.field<Il2Cpp.ValueType>("<InvincibleCount>k__BackingField");
    if (field.isStatic || field.type.name !== "HotFix.Battle.ObfuscatedInt") {
        throw new Error("InvincibleCount is not the expected ObfuscatedInt field");
    }
    const value = field.value;
    const encoded = value.field<number>("_obfuscatedValue");
    const key = value.field<number>("_xorKey");
    if (encoded.type.name !== "System.Int32" || key.type.name !== "System.Int32") {
        throw new Error("unexpected ObfuscatedInt layout");
    }
    return { encoded, key };
}

function readInvincibleCount(hero: Il2Cpp.Object): number {
    const { encoded, key } = invincibleFields(hero);
    const k = key.value;
    const v = encoded.value;
    if (key.value !== k) throw new Error("InvincibleCount changed during read");
    return v ^ k;
}

// One write preserving the current signed Int32 XOR key. This is not atomic
// with game-side struct replacement; a verification error must not be retried
// blindly. No constructor call, field-offset guess, native hook or polling.
function adjustInvincibleCount(hero: Il2Cpp.Object, delta: number): number {
    const { encoded, key } = invincibleFields(hero);
    const k = key.value;
    const raw = encoded.value;
    const before = raw ^ k;
    const after = before + delta;
    if (before < 0 || after < 0 || after > 0x7fffffff) {
        throw new Error("invalid/overflowing InvincibleCount: " + before);
    }
    if (key.value !== k || encoded.value !== raw) {
        throw new Error("InvincibleCount changed before write");
    }
    encoded.value = after ^ k;
    if (readInvincibleCount(hero) !== after) {
        throw new Error("InvincibleCount verification failed; restart before retrying god");
    }
    return after;
}

function godCommand(value: boolean | number = true): Promise<object> {
    if (typeof value !== "boolean" &&
        (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 86400)) {
        return Promise.resolve({ ok: false,
            error: "use god(), god(false), or god(seconds) with 0 < seconds <= 86400" });
    }
    const enabled = value !== false;
    const seconds = typeof value === "number" ? value : null;
    return runCommand("god", () => {
        if (godFault) throw new Error("previous god operation failed; restart game before retrying");
        const errors: string[] = [];
        const counts: { hero: string; count: number }[] = [];
        let changed = 0;
        if (enabled) {
            const heroes = collectHeroes();
            if (heroes.length === 0) throw new Error("no player heroes; enter battle first");
            for (const hero of heroes) {
                if ([...godReferences].some(ref => ref.target?.handle.equals(hero.handle))) continue;
                // Pin before mutation so identity cannot be recycled while enabled.
                const reference = hero.ref(true);
                godReferences.add(reference);
                try {
                    const count = adjustInvincibleCount(hero, 1);
                    counts.push({ hero: hero.handle.toString(), count });
                    changed++;
                } catch (error) {
                    // A failed write/verification has uncertain ownership.
                    // Keep the reference and forbid another add/subtract.
                    godFault = true;
                    errors.push(hero.handle + ": " + error);
                    break;
                }
            }
        } else {
            // Use owned references, not current UI membership; a hero may have
            // been removed from the party since enable. Never force count to zero.
            for (const reference of [...godReferences]) {
                try {
                    const hero = reference.target;
                    if (hero === null) throw new Error("pinned hero is unavailable");
                    const count = adjustInvincibleCount(hero, -1);
                    counts.push({ hero: hero.handle.toString(), count });
                    reference.free();
                    godReferences.delete(reference);
                    changed++;
                } catch (error) { godFault = true; errors.push(String(error)); break; }
            }
        }
        log("End god " + (enabled ? "enable" : "disable") + ": changed=" + changed +
            ", tracked=" + godReferences.size + ", errors=" + errors.length);
        if (errors.length === 0) setGodTimer(enabled ? seconds : null);
        return { ok: errors.length === 0, changed, trackedHeroes: godReferences.size,
            counts, autoDisableSeconds: enabled ? seconds : null,
            restartRequired: godFault, errors };
    });
}

function log(message: string): void {
    console.log("[WittleDefender] " + message);
}

// Lock before Il2Cpp.perform awaits initialization. Overlapping requests are
// rejected rather than accumulating delayed stat writes. Always release it.
async function runCommand<T>(
    name: string, operation: () => T
): Promise<T | CommandError> {
    if (operationBusy) {
        return { ok: false, error: "another IL2CPP operation is running; try again" };
    }
    operationBusy = true;
    try {
        return await Il2Cpp.perform((): T | CommandError => {
            try {
                return operation();
            } catch (error) {
                const message = name + ": " + String(error);
                log(message);
                return { ok: false, error: message };
            }
        });
    } catch (error) {
        const message = name + ": " + String(error);
        log(message);
        return { ok: false, error: message };
    } finally {
        operationBusy = false;
        if (pendingGodExpiry !== null) {
            const generation = pendingGodExpiry;
            pendingGodExpiry = null;
            setImmediate(() => expireGod(generation));
        }
    }
}

function findClass(assemblyName: string, className: string): Il2Cpp.Class | null {
    const assembly = Il2Cpp.domain.assemblies.find(a => a.name === assemblyName);
    return assembly === undefined ? null : assembly.image.class(className);
}

function findClassAnywhere(classNames: string[]): Il2Cpp.Class | null {
    for (const assembly of Il2Cpp.domain.assemblies) {
        for (const className of classNames) {
            const klass = assembly.image.tryClass(className);
            if (klass !== null) return klass;
        }
    }
    return null;
}

function objectField(object: Il2Cpp.Object, name: string): Il2Cpp.Object | null {
    const value = object.field<Il2Cpp.Object>(name).value;
    return value === null || value.handle.isNull() ? null : value;
}

function int32Field(object: Il2Cpp.Object, name: string): Il2Cpp.BoundField<number> {
    const field = object.field<number>(name);
    if (field.isStatic || field.type.name !== "System.Int32") {
        throw new Error("refusing non-instance-Int32 access: " + name);
    }
    return field;
}

function findExport(name: string): NativePointer {
    const moduleApi = Module as any;
    const address = moduleApi.findGlobalExportByName?.(name)
        ?? moduleApi.findExportByName?.(null, name) ?? null;
    if (address === null) throw new Error("missing export: " + name);
    return address;
}

// argument storage contains Int32 values, not pointers to managed objects.
function runtimeInvokeRaw(
    object: Il2Cpp.Object, name: string, args: number[] = []
): NativePointer {
    if (runtimeInvoke === null) {
        const invoke = new NativeFunction(findExport("il2cpp_runtime_invoke"),
            "pointer", ["pointer", "pointer", "pointer", "pointer"]) as RuntimeInvoke;
        const unbox = new NativeFunction(findExport("il2cpp_object_unbox"),
            "pointer", ["pointer"]) as NativeFunction<NativePointer, [NativePointer]>;
        runtimeInvoke = invoke;
        objectUnbox = unbox;
    }
    const method = object.method(name, args.length);
    const exceptionSlot = Memory.alloc(Process.pointerSize).writePointer(NULL);
    const values = args.map(value => Memory.alloc(4).writeS32(value));
    const argv = values.length === 0 ? NULL : Memory.alloc(values.length * Process.pointerSize);
    values.forEach((value, i) => argv.add(i * Process.pointerSize).writePointer(value));
    const result = runtimeInvoke(method.handle, object.handle, argv, exceptionSlot);
    const exception = exceptionSlot.readPointer();
    if (!exception.isNull()) {
        throw new Error(object.class.name + "." + name + " managed exception at " + exception);
    }
    return result;
}

function invokeObject(object: Il2Cpp.Object, name: string, ...args: number[]): Il2Cpp.Object | null {
    const result = runtimeInvokeRaw(object, name, args);
    return result.isNull() ? null : new Il2Cpp.Object(result);
}

function invokeInt32(object: Il2Cpp.Object, name: string, ...args: number[]): number {
    const boxed = runtimeInvokeRaw(object, name, args);
    if (boxed.isNull()) throw new Error(name + " returned null instead of Int32");
    const value = objectUnbox!(boxed);
    if (value.isNull()) throw new Error("cannot unbox " + name);
    return value.readS32();
}

function safeScalarField(object: Il2Cpp.Object | null, names: string[]): unknown {
    if (object === null) return null;
    for (const name of names) {
        try {
            const value = object.field<any>(name).value as any;
            if (value === null || value === undefined) return null;
            if (typeof value === "number" || typeof value === "boolean" ||
                typeof value === "string") return value;
            return value.toString();
        } catch (_) { /* try the next generated/backing-field name */ }
    }
    return null;
}

function safeNamedObjectField(
    object: Il2Cpp.Object | null, names: string[]
): Il2Cpp.Object | null {
    if (object === null) return null;
    for (const name of names) {
        try {
            const value = object.field<Il2Cpp.Object>(name).value;
            if (value !== null && !value.handle.isNull()) return value;
        } catch (_) { /* try the next generated/backing-field name */ }
    }
    return null;
}

function safeCollectionCount(collection: Il2Cpp.Object | null): number | null {
    if (collection === null) return null;
    try { return invokeInt32(collection, "get_Count"); }
    catch (_) { return null; }
}

function dumpInt32Collection(collection: Il2Cpp.Object | null): number[] {
    const result: number[] = [];
    const count = safeCollectionCount(collection);
    if (count === null || count < 0) return result;
    for (let index = 0; index < Math.min(count, 1024); index++) {
        try { result.push(invokeInt32(collection!, "get_Item", index)); }
        catch (_) { break; }
    }
    return result;
}

function dumpRewards(collection: Il2Cpp.Object | null): object[] {
    const result: object[] = [];
    const count = safeCollectionCount(collection);
    if (count === null || count < 0) return result;
    for (let index = 0; index < Math.min(count, 256); index++) {
        try {
            const reward = invokeObject(collection!, "get_Item", index);
            if (reward === null) continue;
            result.push({
                index,
                configId: safeScalarField(reward, ["configId_", "<ConfigId>k__BackingField"]),
                count: safeScalarField(reward, ["count_", "<Count>k__BackingField"])
            });
        } catch (error) {
            result.push({ index, error: String(error) });
        }
    }
    return result;
}

function dumpBattleResult(result: Il2Cpp.Object): object {
    const levelInfo = safeNamedObjectField(result,
        ["levelInfo_", "<LevelInfo>k__BackingField"]);
    const statistic = safeNamedObjectField(result,
        ["statistic_", "<Statistic>k__BackingField"]);
    const frameStatistics = safeNamedObjectField(result,
        ["frameStatistics_", "<FrameStatistics>k__BackingField"]);
    const rewards = safeNamedObjectField(result,
        ["battleRewards_", "<BattleRewards>k__BackingField"]);
    const skillUpgradeIds = safeNamedObjectField(result,
        ["skillUpgradeIds_", "<SkillUpgradeIds>k__BackingField"]);
    const starIndex = safeNamedObjectField(result,
        ["starIndex_", "<StarIndex>k__BackingField"]);
    const conditionStars = safeNamedObjectField(result,
        ["conditionChapterStarIndex_", "<ConditionChapterStarIndex>k__BackingField"]);
    const kongYuStars = safeNamedObjectField(result,
        ["kongYuStarIndex_", "<KongYuStarIndex>k__BackingField"]);
    const pvpStatistics = safeNamedObjectField(result,
        ["pvpStatistics_", "<PvpStatistics>k__BackingField"]);

    const report = {
        className: result.class.name,
        handle: result.handle.toString(),
        levelInfo: {
            className: levelInfo?.class.name ?? null,
            levelId: safeScalarField(levelInfo, ["levelId_", "<LevelId>k__BackingField"])
        },
        battleVersion: safeScalarField(result,
            ["battleVersion_", "<BattleVersion>k__BackingField"]),
        maxWave: safeScalarField(result, ["maxWave_", "<MaxWave>k__BackingField"]),
        endReason: safeScalarField(result, ["endReason_", "<EndReason>k__BackingField"]),
        rewards: dumpRewards(rewards),
        statistic: {
            className: statistic?.class.name ?? null,
            bossHpChangeAll: safeScalarField(statistic,
                ["bossHpChangeAll_", "<BossHpChangeAll>k__BackingField"]),
            passTime: safeScalarField(statistic, ["passTime_", "<PassTime>k__BackingField"]),
            bossHpPercent: safeScalarField(statistic,
                ["bossHpPercent_", "<BossHpPercent>k__BackingField"])
        },
        frameStatistics: {
            className: frameStatistics?.class.name ?? null,
            resultHashCode: safeScalarField(frameStatistics,
                ["resultHashCode_", "<ResultHashCode>k__BackingField"])
        },
        skillUpgradeIds: dumpInt32Collection(skillUpgradeIds),
        starIndex: dumpInt32Collection(starIndex),
        conditionChapterStarIndex: dumpInt32Collection(conditionStars),
        kongYuStarIndex: dumpInt32Collection(kongYuStars),
        hasPvpStatistics: pvpStatistics !== null
    };

    console.log("\n[BuildBattleResult -> BattleResultDto]\n" +
        JSON.stringify(report, null, 2));
    return report;
}

function describeRequestField(request: Il2Cpp.Object, names: string[]): object | null {
    for (const name of names) {
        try {
            const field = request.field<any>(name);
            const value = field.value as any;
            const description: Record<string, unknown> = {
                field: name,
                type: field.type.name
            };
            if (value === null || value === undefined) {
                description.value = null;
            } else if (typeof value === "number" || typeof value === "boolean" ||
                typeof value === "string") {
                description.value = value;
            } else {
                description.handle = value.handle?.toString?.() ?? null;
                description.className = value.class?.name ?? null;
                let length: number | null = null;
                for (const getter of ["get_Length", "get_Count", "get_Size"]) {
                    try { length = invokeInt32(value as Il2Cpp.Object, getter); break; }
                    catch (_) { /* try the next size getter */ }
                }
                description.length = length;
            }
            return description;
        } catch (_) { /* try the next generated/backing-field name */ }
    }
    return null;
}

function dumpLevelEndRequest(request: Il2Cpp.Object): object {
    const result = safeNamedObjectField(request, ["result_", "<Result>k__BackingField"]);
    const commonParams = safeNamedObjectField(request,
        ["commonParams_", "<CommonParams>k__BackingField"]);
    const report = {
        requestClass: request.class.name,
        requestNamespace: request.class.namespace,
        requestHandle: request.handle.toString(),
        type: safeScalarField(request, ["type_", "<Type>k__BackingField"]),
        commonParams: commonParams === null ? null : {
            className: commonParams.class.name,
            namespace: commonParams.class.namespace,
            handle: commonParams.handle.toString()
        },
        commands: describeRequestField(request, ["commands_", "<Commands>k__BackingField"]),
        result: result === null ? null : dumpBattleResult(result)
    };
    console.log("\n[NetWork.Send -> " + request.class.name + "]\n" +
        JSON.stringify(report, null, 2));
    return report;
}

function resolveNetworkSends(): { klass: Il2Cpp.Class; methods: Il2Cpp.Method[] } {
    const gameApp = findClassAnywhere(["Framework.GameApp", "GameApp"]);
    if (gameApp === null) throw new Error("GameApp class was not found in loaded assemblies");
    const getter = gameApp.methods.find(method =>
        method.name === "get_NetWork" && method.parameterCount === 0);
    if (getter === undefined) throw new Error(gameApp.name + ".get_NetWork() was not found");
    const networkClass = getter.returnType.class;
    const candidates = networkClass.methods.filter(method => {
        if (method.name !== "Send" || method.parameterCount !== 6) return false;
        const firstType = method.parameters[0]?.type.name ?? "";
        return firstType === "Google.Protobuf.IMessage" || firstType.endsWith(".IMessage") ||
            firstType === "IMessage";
    });
    if (candidates.length === 0) {
        throw new Error("no six-parameter Send(IMessage, ...) overload found on " +
            networkClass.name);
    }
    return { klass: networkClass, methods: candidates };
}

function traceEndCommand(enabled: boolean = true): Promise<object> {
    return runCommand("traceend", () => {
        if (!enabled) {
            for (const listener of endTraceListeners.splice(0)) listener.detach();
            endTraceState.installed = false;
            log("LevelEndRequest network trace detached");
            return { ok: true, ...endTraceState };
        }
        if (endTraceListeners.length > 0) return { ok: true, ...endTraceState };

        const { klass, methods } = resolveNetworkSends();
        endTraceState.networkClass = klass.namespace + "." + klass.name;
        endTraceState.candidateSignatures = methods.map(method => method.toString());
        endTraceState.observedRequestClasses = {};
        endTraceState.sendCalls = 0;
        endTraceState.levelEndMatches = 0;
        endTraceState.dumps = 0;
        endTraceState.errors = 0;
        endTraceState.lastError = null;
        const unique = new Map<string, Il2Cpp.Method>();
        for (const method of methods) unique.set(method.virtualAddress.toString(), method);
        const addresses: string[] = [];
        const methodInfos: string[] = [];
        for (const method of unique.values()) {
            const address = method.virtualAddress;
            if (address.isNull()) continue;
            const range = Process.findRangeByAddress(address);
            if (range === null || !range.protection.includes("x")) continue;
            const requestArgumentIndex = method.isStatic ? 0 : 1;
            addresses.push(address.toString());
            methodInfos.push(method.handle.toString());
            endTraceListeners.push(Interceptor.attach(address, {
                onEnter(args) {
                    endTraceState.sendCalls++;
                    const pointer = args[requestArgumentIndex];
                    if (pointer.isNull()) return;
                    try {
                        const request = new Il2Cpp.Object(pointer);
                        const fullName = (request.class.namespace
                            ? request.class.namespace + "." : "") + request.class.name;
                        const previous = endTraceState.observedRequestClasses[fullName] ?? 0;
                        endTraceState.observedRequestClasses[fullName] = previous + 1;
                        if (previous === 0) log("NetWork.Send request observed: " + fullName);
                        if (request.class.name !== "LevelEndRequest" &&
                            request.class.name !== "GoldExpDungeonEndRequest") return;
                        endTraceState.levelEndMatches++;
                        dumpLevelEndRequest(request);
                        endTraceState.dumps++;
                    } catch (error) {
                        endTraceState.errors++;
                        endTraceState.lastError = String(error);
                        if (endTraceState.errors <= 5) log("NetWork.Send inspect: " + error);
                    }
                }
            }));
        }
        if (endTraceListeners.length === 0) {
            throw new Error("no executable Send(IMessage, ...) entry points found");
        }
        endTraceState.methodInfo = methodInfos.join(", ");
        endTraceState.address = addresses.join(", ");
        endTraceState.installed = true;
        log("LevelEndRequest network trace installed: " + endTraceState.networkClass +
            ".Send overloads=" + methods.length + " uniqueAddresses=" + addresses.length);
        return { ok: true, ...endTraceState };
    });
}

function traceEndStatus(): object {
    return { ...endTraceState };
}

// Same player-object path as the uploaded script. Duplicate UI references
// must not cause the same hero to receive an increment twice.
function collectHeroes(): Il2Cpp.Object[] {
    const klass = findClass(UI_ASSEMBLY, BATTLE_UI);
    if (klass === null) throw new Error("battle UI is not loaded yet");
    const heroes: Il2Cpp.Object[] = [];
    const seen = new Set<string>();
    for (const ui of Il2Cpp.gc.choose(klass)) {
        if (ui.handle.isNull()) continue;
        const node = objectField(ui, "_mechaSkillNode");
        const camp = node === null ? null : objectField(node, "_myCamp");
        const list = camp === null ? null : objectField(camp, "_heroList");
        if (list === null) continue;
        const count = invokeInt32(list, "get_Count");
        if (count < 0 || count > 4096) throw new Error("invalid hero-list count: " + count);
        for (let index = 0; index < count; index++) {
            const hero = invokeObject(list, "get_Item", index);
            if (hero === null || seen.has(hero.handle.toString())) continue;
            seen.add(hero.handle.toString());
            heroes.push(hero);
        }
    }
    return heroes;
}

function attributeMap(hero: Il2Cpp.Object): Il2Cpp.Object | null {
    const roleAttributes = invokeObject(hero, "GetRoleAttr");
    return roleAttributes === null ? null : objectField(roleAttributes, "AttributeMap");
}

function readCurrentHp(hero: Il2Cpp.Object): string {
    // The bridge resolves the inline struct's field offsets from metadata.
    const hp = hero.field<Il2Cpp.ValueType>("CurrentHp").value;
    const keyField = hp.field<number>("_xorKey");
    const valueField = hp.field<Int64>("_obfuscatedValue");
    for (let attempt = 0; attempt < 3; attempt++) {
        const keyBefore = keyField.value;
        const obfuscated = valueField.value;
        if (keyBefore === keyField.value) {
            // C# sign-extends the signed Int32 key before XOR with the Int64.
            return obfuscated.xor(new Int64(keyBefore.toString())).toString();
        }
    }
    throw new Error("CurrentHp xor key changed during read");
}

function collectHeroAttributes(heroes: Il2Cpp.Object[]): HeroReport {
    const result: HeroAttributes[] = [];
    const errors: string[] = [];
    heroes.forEach((hero, index) => {
        try {
            const map = attributeMap(hero);
            const readValue = (label: string, key: number): number | null => {
                if (map === null) return null;
                try { return invokeInt32(map, "get_Item", key); }
                catch (error) { errors.push("Hero " + index + " " + label + ": " + error); return null; }
            };
            let hp: string | null = null;
            try { hp = readCurrentHp(hero); }
            catch (error) { errors.push("Hero " + index + " HP: " + error); }
            result.push({
                hero: index, className: hero.class.name, handle: hero.handle.toString(), CurrentHp: hp,
                Attack: readValue("ATK", ATTRIBUTE_KEYS.Attack),
                Defence: readValue("DEF", ATTRIBUTE_KEYS.Defence),
                DefencePercent: readValue("DEF%", ATTRIBUTE_KEYS.DefencePercent),
                RecoveryRate: readValue("Heal%", ATTRIBUTE_KEYS.RecoveryRate),
                SkillSpeed: readValue("SkillSpeed", ATTRIBUTE_KEYS.SkillSpeed),
                HPRecovery: readValue("HPRecovery", ATTRIBUTE_KEYS.HPRecovery)
            });
        } catch (error) { errors.push("Hero " + index + ": " + error); }
    });
    const lines = result.map(a => [
        "Hero " + a.hero + ":", "HP=" + (a.CurrentHp ?? "N/A"),
        "ATK=" + (a.Attack ?? "N/A"), "DEF=" + (a.Defence ?? "N/A"),
        "DEF%=" + (a.DefencePercent ?? "N/A"),
        "Heal%=" + (a.RecoveryRate === null ? "N/A"
            : (a.RecoveryRate / 100).toFixed(2) + "%"),
        "SkillSpeed=" + (a.SkillSpeed ?? "N/A"),
        "HPRecovery=" + (a.HPRecovery ?? "N/A")
    ].join(" "));
    console.log("\n[Hero Attributes]\n" + (lines.join("\n") || "No heroes found"));
    return { heroes: result, lines, errors };
}

function readCommand(): Promise<HeroReport | CommandError> {
    return runCommand("read", () => collectHeroAttributes(collectHeroes()));
}

function incrementCommand(percent: number): Promise<object> {
    const healingRawIncrement = Math.round(percent * ATTRIBUTE_PERCENT_SCALE / 100);
    if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_INCREMENT_PERCENT ||
        !Number.isSafeInteger(healingRawIncrement) || healingRawIncrement <= 0) {
        return Promise.resolve({ ok: false,
            error: "inc(percent) requires 0 < percent <= " + MAX_INCREMENT_PERCENT });
    }
    return runCommand("inc", () => {
        const heroes = collectHeroes();
        if (heroes.length === 0) throw new Error("no player heroes found; enter a battle first");
        let changedHeroes = 0;
        let changedAttributes = 0;
        const errors: string[] = [];
        heroes.forEach((hero, index) => {
            let changed = false;
            try {
                const map = attributeMap(hero);
                if (map === null) throw new Error("AttributeMap is null");
                for (const key of [ATTRIBUTE_KEYS.Attack, ATTRIBUTE_KEYS.Defence,
                    ATTRIBUTE_KEYS.RecoveryRate]) {
                    try {
                        const before = invokeInt32(map, "get_Item", key);
                        // ATK/DEF receive a relative percentage increase. RecoveryRate
                        // is itself a percentage attribute, so add percentage points;
                        // multiplying a normal zero baseline would have no effect.
                        const added = key === ATTRIBUTE_KEYS.RecoveryRate
                            ? healingRawIncrement
                            : Math.round(before * percent / 100);
                        const after = before >= STAT_CAP ? before
                            : Math.min(STAT_CAP, before + added);
                        if (after === before) continue;
                        runtimeInvokeRaw(map, "set_Item", [key, after]);
                        if (invokeInt32(map, "get_Item", key) !== after) {
                            throw new Error("write verification failed");
                        }
                        changed = true;
                        changedAttributes++;
                    } catch (error) { errors.push("Hero " + index + " key " + key + ": " + error); }
                }
            } catch (error) { errors.push("Hero " + index + ": " + error); }
            if (changed) changedHeroes++;
        });
        // Reuse this discovery pass; do not perform a second heap scan.
        const report = collectHeroAttributes(heroes);
        return { ok: errors.length === 0, percent, healingRawIncrement, heroes: heroes.length,
            changedHeroes, changedAttributes, errors, readErrors: report.errors };
    });
}

function healCommand(percent: number): Promise<object> {
    const healingRawIncrement = Math.round(percent * ATTRIBUTE_PERCENT_SCALE / 100);
    if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_INCREMENT_PERCENT ||
        !Number.isSafeInteger(healingRawIncrement) || healingRawIncrement <= 0) {
        return Promise.resolve({ ok: false,
            error: "heal(percent) requires 0 < percent <= " + MAX_INCREMENT_PERCENT });
    }
    return runCommand("heal", () => {
        const heroes = collectHeroes();
        if (heroes.length === 0) throw new Error("no player heroes found; enter a battle first");
        let changedHeroes = 0;
        const errors: string[] = [];
        heroes.forEach((hero, index) => {
            try {
                const map = attributeMap(hero);
                if (map === null) throw new Error("AttributeMap is null");
                const before = invokeInt32(map, "get_Item", ATTRIBUTE_KEYS.RecoveryRate);
                const after = before >= STAT_CAP ? before
                    : Math.min(STAT_CAP, before + healingRawIncrement);
                if (after === before) return;
                runtimeInvokeRaw(map, "set_Item", [ATTRIBUTE_KEYS.RecoveryRate, after]);
                if (invokeInt32(map, "get_Item", ATTRIBUTE_KEYS.RecoveryRate) !== after) {
                    throw new Error("write verification failed");
                }
                changedHeroes++;
            } catch (error) {
                errors.push("Hero " + index + " Heal%: " + error);
            }
        });
        // Reuse this discovery pass; do not perform another heap scan.
        const report = collectHeroAttributes(heroes);
        return { ok: errors.length === 0, percent, healingRawIncrement,
            heroes: heroes.length, changedHeroes, errors, readErrors: report.errors };
    });
}

function reviveCommand(): Promise<object> {
    return runCommand("revive", () => {
        const klass = findClass(BATTLE_ASSEMBLY, BATTLE_MANAGER);
        if (klass === null) throw new Error("battle manager is not loaded yet");
        const seen = new Set<string>();
        let changed = 0;
        for (const manager of Il2Cpp.gc.choose(klass)) {
            if (manager.handle.isNull()) continue;
            const attr = objectField(manager, "InGameAttr");
            if (attr === null || seen.has(attr.handle.toString())) continue;
            seen.add(attr.handle.toString());
            const field = int32Field(attr, "AdReviveTimes");
            if (field.value === AD_REVIVES) continue;
            field.value = AD_REVIVES;
            if (field.value !== AD_REVIVES) throw new Error("AdReviveTimes write verification failed");
            changed++;
        }
        if (seen.size === 0) throw new Error("no InGameAttr found; enter a battle first");
        log("AdReviveTimes=" + AD_REVIVES + "; groups=" + seen.size + ", changed=" + changed);
        return { ok: true, target: AD_REVIVES, groups: seen.size, changed };
    });
}

function patchReroll(value: number): { instances: number; changed: number } {
    const klass = findClass(BATTLE_ASSEMBLY, LEVELS_TABLE);
    if (klass === null) return { instances: 0, changed: 0 };
    let instances = 0;
    let changed = 0;
    for (const object of Il2Cpp.gc.choose(klass)) {
        if (object.handle.isNull()) continue;
        const field = int32Field(object, "<extraReroll>k__BackingField");
        instances++;
        if (field.value === value) continue;
        field.value = value;
        if (field.value !== value) throw new Error("extraReroll write verification failed");
        changed++;
    }
    return { instances, changed };
}

function rerollCommand(value: number = DEFAULT_REROLL): object {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) {
        throw new Error("reroll(n) requires a non-negative Int32 integer");
    }
    if (rerollTimer !== null) clearTimeout(rerollTimer);
    rerollTimer = null;
    const generation = ++rerollGeneration;
    let attempts = 0;
    const retry = (): void => {
        if (attempts >= REROLL_MAX_ATTEMPTS) {
            log("reroll not applied after " + attempts + " attempts; call reroll(" + value + ") when ready");
            return;
        }
        rerollTimer = setTimeout(() => { rerollTimer = null; void attempt(); }, REROLL_RETRY_MS);
    };
    const attempt = async (): Promise<void> => {
        if (generation !== rerollGeneration) return;
        attempts++;
        if (operationBusy) { retry(); return; }
        const result = await runCommand("reroll", () => generation === rerollGeneration
            ? patchReroll(value) : { instances: 0, changed: 0 });
        if (generation !== rerollGeneration || "error" in result) return;
        if (result.instances > 0) {
            log("extraReroll=" + value + "; tables=" + result.instances + ", changed=" + result.changed);
        } else {
            retry();
        }
    };
    void attempt();
    return { scheduled: true, value };
}

// REPL shortcuts and corresponding RPC entry points.
const shortcuts = globalThis as typeof globalThis & {
    god: typeof godCommand;
    revive: typeof reviveCommand;
    reroll: typeof rerollCommand;
    inc: typeof incrementCommand;
    heal: typeof healCommand;
    read: typeof readCommand;
    traceend: typeof traceEndCommand;
    traceendstatus: typeof traceEndStatus;
};
shortcuts.revive = reviveCommand;
shortcuts.reroll = rerollCommand;
shortcuts.inc = incrementCommand;
shortcuts.heal = healCommand;
shortcuts.read = readCommand;
shortcuts.god = godCommand;
shortcuts.traceend = traceEndCommand;
shortcuts.traceendstatus = traceEndStatus;

rpc.exports = {
    god: godCommand,
    revive: reviveCommand,
    reroll: rerollCommand,
    inc: incrementCommand,
    heal: healCommand,
    traceend: traceEndCommand,
    traceendstatus: traceEndStatus,
    readHeroAttributes: readCommand
};

setImmediate(() => {
    log("ready: revive(), reroll(96), inc(n), heal(percent), read(), god(), god(seconds), god(false), traceend(), traceend(false), traceendstatus(); automatic reroll(96) scheduled");
    rerollCommand(DEFAULT_REROLL);
});
