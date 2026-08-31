import "frida-il2cpp-bridge";

/*
 * WittleDefender / HybridCLR diagnostic
 *
 * Known object chain:
 *
 * HotFix.Battle.UI.MechaSkillNode
 *      |
 *      +-- _myCamp
 *              |
 *              +-- HotFix.Battle.PlayerCampData
 *                      |
 *                      +-- _heroList
 *                              |
 *                              +-- List<EntityHero>
 *
 * EntityHero
 *   -> EntityRole
 *   -> EntityRoleBase
 *
 * EntityRoleBase:
 *   CanChangeHp()
 *   ChangeHp(long)
 *   GetRoleAttr()
 *
 * RoleAttributeGroup:
 *   AttributeMap : Dictionary<int, int>
 *
 * RoleAttributeType.Attack = 1
 *
 * IMPORTANT:
 * HotFixBattle uses HybridCLR.
 *
 * For HybridCLR interpreted methods:
 *   DO NOT use method.invoke()
 *
 * Use:
 *   il2cpp_runtime_invoke()
 *
 * This script is diagnostic/read-only except ChangeHp(0),
 * which does not change HP.
 */

console.log("[+] New run");

Il2Cpp.perform(() => {

    /*
     * =========================================================
     * 1. Resolve il2cpp_runtime_invoke
     * =========================================================
     */

    const runtimeInvokePtr =
        Module.findGlobalExportByName(
            "il2cpp_runtime_invoke"
        );

    if (runtimeInvokePtr === null) {
        console.log(
            "[-] il2cpp_runtime_invoke not found"
        );
        return;
    }

    console.log(
        "[+] il2cpp_runtime_invoke =",
        runtimeInvokePtr
    );

    const nativeRuntimeInvoke = new NativeFunction(
        runtimeInvokePtr,
        "pointer",
        [
            "pointer", // MethodInfo *
            "pointer", // object
            "pointer", // void **params
            "pointer"  // Il2CppException **
        ]
    );


    /*
     * =========================================================
     * 2. HybridCLR runtime invoke helper
     * =========================================================
     */

    function runtimeInvoke(
        method: Il2Cpp.Method,
        obj: Il2Cpp.Object,
        args: NativePointer[] = []
    ): NativePointer {

        let params: NativePointer = ptr(0);

        if (args.length > 0) {

            params = Memory.alloc(
                Process.pointerSize * args.length
            );

            for (let i = 0; i < args.length; i++) {

                params
                    .add(i * Process.pointerSize)
                    .writePointer(args[i]);
            }
        }

        const exc =
            Memory.alloc(Process.pointerSize);

        exc.writePointer(ptr(0));

        const result =
            nativeRuntimeInvoke(
                method.handle,
                obj.handle,
                params,
                exc
            ) as NativePointer;

        const exception =
            exc.readPointer();

        if (!exception.isNull()) {

            throw new Error(
                "Managed exception: " +
                exception.toString()
            );
        }

        return result;
    }


    /*
     * =========================================================
     * 3. Helpers for boxed values
     * =========================================================
     */

    function readBoxedBool(
        obj: NativePointer
    ): boolean {

        if (obj.isNull())
            return false;

        return (
            obj
                .add(Process.pointerSize * 2)
                .readU8()
            !== 0
        );
    }


    function readBoxedInt64(
        obj: NativePointer
    ): Int64 {

        return obj
            .add(Process.pointerSize * 2)
            .readS64();
    }


    /*
     * =========================================================
     * 4. Resolve assemblies
     * =========================================================
     */

    const hotfix =
        Il2Cpp.domain.assembly("HotFix");

    const battle =
        Il2Cpp.domain.assembly("HotFixBattle");

    console.log(
        "[+] HotFix image:",
        hotfix.image.name
    );

    console.log(
        "[+] HotFixBattle image:",
        battle.image.name
    );


    /*
     * =========================================================
     * 5. Resolve classes
     * =========================================================
     */

    const MechaSkillNode =
        hotfix.image.class(
            "HotFix.Battle.UI.MechaSkillNode"
        );

    const EntityRoleBase =
        battle.image.class(
            "HotFix.Battle.EntityRoleBase"
        );

    console.log(
        "[+] MechaSkillNode class found"
    );

    console.log(
        "[+] EntityRoleBase class found"
    );


    /*
     * =========================================================
     * 6. Resolve EntityRoleBase methods
     * =========================================================
     */

    const canChangeHp =
        EntityRoleBase.method(
            "CanChangeHp",
            0
        );

    const changeHp =
        EntityRoleBase.method(
            "ChangeHp",
            1
        );

    const getRoleAttr =
        EntityRoleBase.method(
            "GetRoleAttr",
            0
        );

    console.log(
        "\n=== MethodInfo ==="
    );

    console.log(
        "[+] CanChangeHp:",
        canChangeHp.handle,
        "VA =",
        canChangeHp.virtualAddress
    );

    console.log(
        "[+] ChangeHp:",
        changeHp.handle,
        "VA =",
        changeHp.virtualAddress
    );

    console.log(
        "[+] GetRoleAttr:",
        getRoleAttr.handle,
        "VA =",
        getRoleAttr.virtualAddress
    );


    /*
     * =========================================================
     * 7. Find live MechaSkillNode
     * =========================================================
     */

    console.log(
        "\n=== Finding MechaSkillNode ==="
    );

    const nodes =
        Il2Cpp.gc.choose(
            MechaSkillNode
        );

    console.log(
        "[+] instances:",
        nodes.length
    );

    if (nodes.length === 0) {

        console.log(
            "[-] No live MechaSkillNode"
        );

        console.log(
            "[-] Enter a battle and run again"
        );

        return;
    }

    const node =
        nodes[0];

    console.log(
        "[+] node =",
        node.handle
    );

    console.log(
        "[+] class =",
        node.class.fullName
    );


    /*
     * =========================================================
     * 8. MechaSkillNode -> _myCamp
     * =========================================================
     */

    console.log(
        "\n=== Reading _myCamp ==="
    );

    const camp =
        node
            .field<Il2Cpp.Object>(
                "_myCamp"
            )
            .value;

    if (camp === null) {

        console.log(
            "[-] _myCamp is null"
        );

        return;
    }

    console.log(
        "[+] _myCamp =",
        camp.handle
    );

    console.log(
        "[+] class =",
        camp.class.fullName
    );


    /*
     * =========================================================
     * 9. PlayerCampData -> _heroList
     * =========================================================
     */

    console.log(
        "\n=== Reading _heroList ==="
    );

    const heroList =
        camp
            .field<Il2Cpp.Object>(
                "_heroList"
            )
            .value;

    if (heroList === null) {

        console.log(
            "[-] _heroList is null"
        );

        return;
    }

    console.log(
        "[+] _heroList =",
        heroList.handle
    );

    console.log(
        "[+] class =",
        heroList.class.fullName
    );

    const heroCount =
        Number(
            heroList
                .method(
                    "get_Count",
                    0
                )
                .invoke()
        );

    console.log(
        "[+] hero count =",
        heroCount
    );

    if (heroCount === 0) {

        console.log(
            "[-] Hero list is empty"
        );

        return;
    }


    /*
    * =========================================================
    * 10. Collect heroes
    * =========================================================
    */

    console.log(
        "\n=== Heroes ==="
    );

    const heroes: Il2Cpp.Object[] = [];

    for (let i = 0; i < heroCount; i++) {

        const hero = heroList
            .method("get_Item", 1)
            .invoke(i) as Il2Cpp.Object;

        heroes.push(hero);

        console.log(
            `[${i}]`,
            "handle =", hero.handle,
            "class =", hero.class.fullName
        );
    }

    
    /*
     * =========================================================
     * 11. Inspect EVERY hero
     * =========================================================
     */

    console.log(
        "\n======================================"
    );

    console.log(
        "=== ALL HERO DIAGNOSTICS ==="
    );

    console.log(
        "======================================"
    );


    for (
        let i = 0;
        i < heroes.length;
        i++
    ) {

        const hero =
            heroes[i];

        console.log(
            `\n========== HERO ${i} ==========`
        );

        console.log(
            "[+] handle =",
            hero.handle
        );

        console.log(
            "[+] class =",
            hero.class.fullName
        );


        /*
         * -----------------------------------------
         * CanChangeHp()
         * -----------------------------------------
         */

        try {

            const result =
                runtimeInvoke(
                    canChangeHp,
                    hero
                );

            console.log(
                "[+] CanChangeHp() =",
                readBoxedBool(result)
            );

        }
        catch (e) {

            console.log(
                "[-] CanChangeHp failed:",
                e
            );
        }


        /*
         * -----------------------------------------
         * ChangeHp(0)
         *
         * Safe diagnostic.
         * Does not change HP.
         * -----------------------------------------
         */

        try {

            const hpArg =
                Memory.alloc(8);

            hpArg.writeS64(
                new Int64(0)
            );

            const result =
                runtimeInvoke(
                    changeHp,
                    hero,
                    [hpArg]
                );

            if (!result.isNull()) {

                const delta =
                    readBoxedInt64(
                        result
                    );

                console.log(
                    "[+] ChangeHp(0) returned =",
                    delta.toString()
                );
            }

        }
        catch (e) {

            console.log(
                "[-] ChangeHp(0) failed:",
                e
            );
        }
        /*
         * -----------------------------------------
         * getInvincibleCount()
         * -----------------------------------------
         */
        const getInvincibleCount =
            EntityRoleBase.method("get_InvincibleCount", 0);

        const result = runtimeInvoke(
            getInvincibleCount,
            hero
        );

        if (!result.isNull()) {

            const payload =
                result.add(Process.pointerSize * 2);

            const obfuscatedValue =
                payload.readS32();

            const xorKey =
                payload.add(4).readS32();

            const value =
                obfuscatedValue ^ xorKey;

            console.log(
                `[Hero ${i}]`,
                "InvincibleCount =", value,
                `(obf=${obfuscatedValue}, key=${xorKey})`
            );
        }

        /*
         * -----------------------------------------
         * GetRoleAttr()
         * -----------------------------------------
         */

        try {

            const attrPtr =
                runtimeInvoke(
                    getRoleAttr,
                    hero
                );

            if (attrPtr.isNull()) {

                console.log(
                    "[-] GetRoleAttr returned null"
                );

                continue;
            }

            const attr =
                new Il2Cpp.Object(
                    attrPtr
                );

            console.log(
                "[+] RoleAttr =",
                attr.handle
            );

            console.log(
                "[+] RoleAttr class =",
                attr.class.fullName
            );


            /*
             * -------------------------------------
             * AttributeMap
             * -------------------------------------
             */

            const attributeMap =
                attr
                    .field<Il2Cpp.Object>(
                        "AttributeMap"
                    )
                    .value;

            console.log(
                "[+] AttributeMap =",
                attributeMap.handle
            );

            const attributeCount =
                Number(
                    attributeMap
                        .method(
                            "get_Count",
                            0
                        )
                        .invoke()
                );

            console.log(
                "[+] AttributeMap count =",
                attributeCount
            );


            /*
             * RoleAttributeType.Attack = 1
             */

            try {

                const attack =
                    attributeMap
                        .method(
                            "get_Item",
                            1
                        )
                        .invoke(1);

                console.log(
                    "[+] Attack [key=1] =",
                    attack
                );

            }
            catch (e) {

                console.log(
                    "[-] Attack lookup failed:",
                    e
                );
            }


            /*
             -------------------------------------
              Useful early attributes
             
              Read-only.
             -------------------------------------
             

            console.log(
                "\n--- Attribute keys 0-30 ---"
            );

            for (
                let key = 0;
                key <= 30;
                key++
            ) {

                try {

                    const contains =
                        attributeMap
                            .method(
                                "ContainsKey",
                                1
                            )
                            .invoke(key);

                    if (!contains)
                        continue;

                    const value =
                        attributeMap
                            .method(
                                "get_Item",
                                1
                            )
                            .invoke(key);

                    console.log(
                        `[ATTR] key=${key} value=${value}`
                    );

                }
                catch (_) {
                }
            }
            */

        }
        catch (e) {

            console.log(
                "[-] GetRoleAttr failed:",
                e
            );
        }
    }


    /*
     * =========================================================
     * 12. Summary: Attack + InvincibleCount for every hero
     * =========================================================
     */

    console.log(
        "\n======================================"
    );

    console.log(
        "=== HERO STATUS SUMMARY ==="
    );

    console.log(
        "======================================"
    );

    const getInvincibleCountSummary =
        EntityRoleBase.method("get_InvincibleCount", 0);

    for (
        let i = 0;
        i < heroes.length;
        i++
    ) {

        const hero =
            heroes[i];

        try {

            /*
             * Attack
             */
            const attrPtr =
                runtimeInvoke(
                    getRoleAttr,
                    hero
                );

            if (attrPtr.isNull()) {
                console.log(`[Hero ${i}] GetRoleAttr returned null`);
                continue;
            }

            const attr =
                new Il2Cpp.Object(
                    attrPtr
                );

            const map =
                attr
                    .field<Il2Cpp.Object>(
                        "AttributeMap"
                    )
                    .value;

            const attack =
                map
                    .method(
                        "get_Item",
                        1
                    )
                    .invoke(1);

            /*
             * InvincibleCount (ObfuscatedInt)
             */
            const invResult =
                runtimeInvoke(
                    getInvincibleCountSummary,
                    hero
                );

            let invincibleCount = 0;

            if (!invResult.isNull()) {
                const payload =
                    invResult.add(Process.pointerSize * 2);

                const obfuscatedValue =
                    payload.readS32();

                const xorKey =
                    payload.add(4).readS32();

                invincibleCount =
                    obfuscatedValue ^ xorKey;
            }

            console.log(
                `[Hero ${i}] Attack=${attack} InvincibleCount=${invincibleCount}`
            );

        }
        catch (e) {

            console.log(
                `[Hero ${i}] read failed:`,
                e
            );
        }
    }


    /*
     * =========================================================
     * Finished
     * =========================================================
     */

    console.log(
        "\n=== Diagnostic finished ==="
    );
});