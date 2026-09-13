import "frida-il2cpp-bridge";

// Keep this agent compilable even when the local project does not include
// frida-il2cpp-bridge's TypeScript declaration files. The bridge provides this
// global at runtime.
declare const Il2Cpp: any;

type MultiplierState = {
    exp: number;
    combat: number;
};

const multipliers: MultiplierState = { exp: 1, combat: 1 };

let ready = false;
let projectileIsAllyOffset: number | null = null;

function expMultiplier(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 5)
        throw new Error("EXP multiplier must be an integer from 1 to 5");
    return value;
}

function combatMultiplier(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 20)
        throw new Error("combat multiplier must be an integer from 1 to 20");
    return value;
}

function selectMethod(klass: any, name: string,
                      parameterTypes: string[]): any {
    const method = klass.methods.find((candidate: any) => {
        if (candidate.name !== name || candidate.parameters.length !== parameterTypes.length)
            return false;
        return candidate.parameters.every((parameter: any, index: number) =>
            parameter.type.name === parameterTypes[index]);
    });

    if (method === undefined) {
        const available = klass.methods
            .filter((candidate: any) => candidate.name === name)
            .map((candidate: any) => `${candidate.name}(${candidate.parameters.map((p: any) => p.type.name).join(", ")})`)
            .join("; ");
        throw new Error(`method not found: ${klass.type.name}.${name}(${parameterTypes.join(", ")}); candidates: ${available}`);
    }
    return method;
}

function findProjectileIsAllyOffset(image: any): number | null {
    const projectile = image.class("LS.ProjectileDataComponent");

    // Bridge field offsets for value types describe their boxed layout and
    // include the two-pointer IL2CPP object header. CalcDamage receives this
    // component unboxed, so convert the metadata offset to the native struct
    // offset before reading it.
    const toNativeOffset = (metadataOffset: number): number =>
        metadataOffset - (Process.pointerSize * 2);

    // IsAllyTarget is a different flag. Prefer the exact ownership flag used
    // by CalcDamage before considering fuzzy fallback candidates.
    const exact = projectile.fields.find((field: any) =>
        field.name === "IsAlly" && field.type.name === "System.Boolean");
    if (exact !== undefined) {
        const nativeOffset = toNativeOffset(exact.offset);
        console.log(`[+] ProjectileDataComponent.IsAlly metadata offset: 0x${exact.offset.toString(16)}`);
        console.log(`[+] ProjectileDataComponent.IsAlly native offset: 0x${nativeOffset.toString(16)}`);
        return nativeOffset;
    }

    const candidates = projectile.fields.filter((field: any) =>
        /ally/i.test(field.name) && field.type.name === "System.Boolean");

    if (candidates.length === 1) {
        const nativeOffset = toNativeOffset(candidates[0].offset);
        console.log(`[+] ProjectileDataComponent.${candidates[0].name} metadata offset: 0x${candidates[0].offset.toString(16)}`);
        console.log(`[+] ProjectileDataComponent.${candidates[0].name} native offset: 0x${nativeOffset.toString(16)}`);
        return nativeOffset;
    }

    console.log("[-] Could not uniquely resolve ProjectileDataComponent's ally Boolean.");
    console.log("    Boolean fields: " + projectile.fields
        .filter((field: any) => field.type.name === "System.Boolean")
        .map((field: any) => `${field.name}@0x${field.offset.toString(16)}`)
        .join(", "));
    return null;
}

function installHooks(): void {
    const image = Il2Cpp.domain.assembly("Assembly-CSharp").image;

    const hitProcess = image.class("LS.HitProcessSystem");
    const calcDamage = selectMethod(hitProcess, "CalcDamage", [
        "Unity.Entities.SystemState&",
        "LS.ProjectileDataComponent",
        "Unity.Entities.Entity"
    ]);

    const summoner = image.class("LS.Battle.Models.Summoner");
    const addExp = selectMethod(summoner, "AddExp", ["System.UInt32"]);

    projectileIsAllyOffset = findProjectileIsAllyOffset(image);

    // Create the callable original before replacing the entry point. Regular
    // replace() is more compatible with PlayCover/Darwin than replaceFast().
    const originalCalcDamage: any = new NativeFunction(
        calcDamage.virtualAddress, "double",
        ["pointer", "pointer", "pointer", "pointer"]);
    const calcDamageReplacement = new NativeCallback(
        (self: NativePointer, state: NativePointer,
         projectileData: NativePointer, targetEntity: NativePointer): number => {
            const result = originalCalcDamage(self, state, projectileData, targetEntity) as number;
            if (multipliers.combat === 1 || projectileIsAllyOffset === null || projectileData.isNull())
                return result;

            // One combat multiplier controls both sides, matching the original
            // tweak: allied outgoing damage is multiplied while enemy incoming
            // damage is divided by the same value.
            const isAlly = projectileData.add(projectileIsAllyOffset).readU8() !== 0;
            return isAlly
                ? result * multipliers.combat
                : result / multipliers.combat;
        },
        "double",
        ["pointer", "pointer", "pointer", "pointer"]
    );
    Interceptor.replace(calcDamage.virtualAddress, calcDamageReplacement);

    const originalAddExp: any = new NativeFunction(
        addExp.virtualAddress, "void", ["pointer", "uint"]);
    const addExpReplacement = new NativeCallback(
        (self: NativePointer, exp: number): void => {
            // Keep uint32 behavior, matching Summoner.AddExp(uint).
            const adjusted = Math.min(0xffffffff, exp * multipliers.exp) >>> 0;
            originalAddExp(self, adjusted);
        },
        "void",
        ["pointer", "uint"]
    );
    Interceptor.replace(addExp.virtualAddress, addExpReplacement);

    ready = true;
    console.log(`[+] CalcDamage hooked at ${calcDamage.virtualAddress}`);
    console.log(`[+] Summoner.AddExp(uint) hooked at ${addExp.virtualAddress}`);
}

const api = {
    addExp(value: number): MultiplierState {
        multipliers.exp = expMultiplier(value);
        console.log(`[+] EXP multiplier: x${multipliers.exp}`);
        return { ...multipliers };
    },

    inc(value: number): MultiplierState {
        multipliers.combat = combatMultiplier(value);
        console.log(`[+] combat x${multipliers.combat}: outgoing x${multipliers.combat}, incoming /${multipliers.combat}`);
        return { ...multipliers };
    },

    status(): object {
        return {
            ready,
            ...multipliers,
            projectileIsAllyOffset
        };
    }
};

rpc.exports = api;

// Also make addExp(2) / inc(2) directly callable in Frida's REPL.
Object.assign(globalThis, api);

Il2Cpp.perform(installHooks);
