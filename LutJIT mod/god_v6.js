
/**
 * Constants & Addresses
 */
const targetModule = "UnityFramework";
const module = Process.getModuleByName(targetModule);

const addr = {
    luaL_loadstring: module.findExportByName('luaL_loadstring'),
    lua_pcall: module.findExportByName('lua_pcall'),
    lua_tolstring: module.findExportByName('lua_tolstring'),
    lua_getfield: module.findExportByName('lua_getfield'),
    lua_type: module.findExportByName('lua_type'),
    lua_settop: module.findExportByName('lua_settop'),
    lua_next: module.findExportByName('lua_next'),
    lua_pushnil: module.findExportByName('lua_pushnil')
};
/**
 * 1. 中心化狀態對象
 */
 var hookStatus = {
    // --- Combat ---
    blood: false,             // God Mode (updateBlood)
    damageAmp: false,         // Multiplier (multipyDamage)
    cardRefresh: false,       // Ad Refresh (getLeftAdRefreshNum)
    currentMultiplier_god: 7,     // Display value for the UI
    currentMultiplier_damage:7,

    // --- System/Economy ---
    lottery: false,           // Free Summons (haveFree)
    bp: false,                // BattlePass Unlocks (isStepUnlock)
    assetFree: false,         // Global 0-Cost (decreaseAssetNum)

    // --- Activities ---
    sparkScout: false,        // SparkScout Module Loaded (ScoutM)
    upgradeScout: false,        // ATK Upgrade 1-Cost (getAtkUpgradeCost) <--- ADDED THIS
    upgradeArkRebuild: false

};

// Native Function Wrappers
const luaL_loadstring = new NativeFunction(addr.luaL_loadstring, 'int', ['pointer', 'pointer']);
const lua_pcall = new NativeFunction(addr.lua_pcall, 'int', ['pointer', 'int', 'int', 'int']);
const lua_tolstring = new NativeFunction(addr.lua_tolstring, 'pointer', ['pointer', 'int', 'pointer']);
const lua_getfield = new NativeFunction(addr.lua_getfield, 'void', ['pointer', 'int', 'pointer']);
const lua_type = new NativeFunction(addr.lua_type, 'int', ['pointer', 'int']);
const lua_settop = new NativeFunction(addr.lua_settop, 'void', ['pointer', 'int']);
const lua_next = new NativeFunction(addr.lua_next, 'int', ['pointer', 'int']);
const lua_pushnil = new NativeFunction(addr.lua_pushnil, 'void', ['pointer']);

var hitMonitor = null;


const scripts = {
    god: {
        name: "戰鬥模組 (God/Blood)",
        lua: (amp = 7) => `
            local status = ""
            local BS = package.loaded["battle.Data.BattleSession"]
            if BS then
                _G.__ORIGINAL_UPDATEBLOOD = _G.__ORIGINAL_UPDATEBLOOD or BS.updateBlood                
                BS.updateBlood = function(self, dt, enemy)
                    if self._index == 1 then 
                        dt = 0 -- 無敵
                    elseif self._index == 2 then 
                        dt = dt * ${amp} -- 倍傷
                        self._domeImmuneDmgNum = 0
                    end
                    -- 必須呼叫原函數！
                    return _G.__ORIGINAL_UPDATEBLOOD(self, dt, enemy)
                end
                _G.__GOD_MODE_ENABLED = true
                status = status .. "BLOOD_OK|"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.blood = ret.includes("BLOOD_OK");
        }
    },
    damageAmp: {
        name: "倍傷模組 (Damage)",
        lua: (amp = 7) => `
            local status = ""
            local BE = package.loaded["battle.Data.entity.BattleEnemy.BattleEnemy"]
            if BE then
                _G.__ORIGINAL_MULTIPY = _G.__ORIGINAL_MULTIPY or BE.multipyDamage
                BE.multipyDamage = function(self, damage, skill, ...)
                    local val = _G.__ORIGINAL_MULTIPY(self, damage, skill, ...)
                    return _G.__DAMAGE_AMP_ENABLED and (val * ${amp}) or val
                end
                _G.__DAMAGE_AMP_ENABLED = true
                status = status .. "DAMAGE_OK|"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.damageAmp = ret.includes("DAMAGE_OK");
        }
    },
    cardRefresh: {
        name: "刷新模組 (Refresh)",
        lua: (refreshCount = 7) => `
            local status = ""
            local BR = package.loaded["battle.Data.BattleRouge"]
            if BR then
                _G.__ORIGINAL_REFRESH = _G.__ORIGINAL_REFRESH or BR.getLeftAdRefreshNum
                BR.getLeftAdRefreshNum = function() return ${refreshCount} end

                status = status .. "REFRESH_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.cardRefresh = ret.includes("REFRESH_OK");
        }
    },   
    lottery: {
        name: "抽獎模組 (Lottery)",
        lua: () => `
            local status = ""
            local targets = {
                "app.gameplay.module.player.common.PlayerArkRebuildLottery",
                "app.gameplay.module.player.common.PlayerWeekLottery",
                "app.gameplay.module.player.common.PlayerWeekLottery2"
            }
            local foundCount = 0

            for _, path in ipairs(targets) do
                local M = package.loaded[path]
                if M then 
                    -- 1. 備份原始函數 (如果還沒備份過)
                    _G["_orig_free_" .. path] = _G["_orig_free_" .. path] or M.haveFree
                    
                    -- 2. 注入 Hook
                    M.haveFree = function() return true end 
                    
                    foundCount = foundCount + 1
                end
            end

            if foundCount > 0 then
                status = "LOTTERY_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            // 修正：對應到專屬的 lottery 狀態位
            hookStatus.lottery = ret.includes("LOTTERY_OK");
        }
    },
    battlePass: {
        name: "戰令模組 (BattlePass)",
        lua: () => `
            local status = ""
            local Base = package.loaded["app.gameplay.module.player.common.PlayerBattlePassBase"]
            
            if Base then
                -- 1. 處理步驟解鎖 (Step Unlock)
                _G.__ORIGINAL_BP_UNLOCK = _G.__ORIGINAL_BP_UNLOCK or Base.isStepUnlock
                Base.isStepUnlock = function() return true end
                
                -- 2. 處理當前獎勵等級 (Cur Reward Level)
                if Base.getCurRewardLevel then
                    _G.__ORIGINAL_BP_LEVEL = _G.__ORIGINAL_BP_LEVEL or Base.getCurRewardLevel
                    Base.getCurRewardLevel = function(self) 
                        -- 直接回傳最大等級，達到「全領取」效果
                        return self:readMaxLevel() 
                    end
                end
                
                status = "BP_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            // 更新專屬的 bp 狀態位
            hookStatus.bp = ret.includes("BP_OK");
        }
    },
    assetFree: {
        name: "資源全免 (Asset)",
        lua: () => `
            local status = ""
            local AssetM = package.loaded["app.gameplay.module.player.common.PlayerAsset"]
            if AssetM then
                _G.__ORIGINAL_DECREASE = _G.__ORIGINAL_DECREASE or AssetM.decreaseAssetNum
                
                AssetM.decreaseAssetNum = function(self, rid, num, logway)
                    return _G.__ORIGINAL_DECREASE(self, rid, 0, logway)
                end
                status = "ASSET_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.assetFree = ret.includes("ASSET_OK");
        }
    },
    sparkScout: {
        name: "對決模組 (SparkScout)",
        lua: () => `
            local status = ""
            local ScoutM = package.loaded["app.gameplay.module.player.common.PlayerActivitySparkScout"]
            if ScoutM then
                -- 1. 備份與攔截對決消耗 (Duel Cost)
                _G.__ORIGINAL_TRYDUEL = _G.__ORIGINAL_TRYDUEL or ScoutM.tryDuelCost
                ScoutM.tryDuelCost = function(self)
                    if self.setDuelCosted then self:setDuelCosted(true) end
                    local SimpleEvent = package.loaded["app.utils.SimpleEvent"] or _G.SimpleEvent
                    if SimpleEvent then SimpleEvent.emit("spark.duel.cost") end
                    return true
                end

                -- 2. 備份與攔截 ATK 升級消耗 (Upgrade Atk)
                _G.__ORIGINAL_UPGRADE_ATK = _G.__ORIGINAL_UPGRADE_ATK or ScoutM.tryUpgradeAtkLevel
                ScoutM.tryUpgradeAtkLevel = function(self, resType)
                    -- 手動增加等級，繞過資源檢查
                    self._data.atkLevel = self._data.atkLevel + 1
                    if resType == D.ResType.spark_scout_wafer then
                        self._data.atkCost1Level = self._data.atkCost1Level + 1
                    end

                    -- 調用 0 消耗扣除
                    P._playerAsset:increaseAssetNum(resType, 0, D.LogWay.spark_scout_upgrade_atk)
                    return ResultCode.OK
                end
                
                status = "SCOUT_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.sparkScout = ret.includes("SCOUT_OK");
        }
    },
    upgradeScout: {
        name: "升級模組 (Scout)",
        lua: () => `
            local status = ""
            local ScoutM = package.loaded["app.gameplay.module.player.common.PlayerActivitySparkScout"]
            local AssetM = package.loaded["app.gameplay.module.player.common.PlayerAsset"]

            if ScoutM and AssetM then
                -- 1. 攔截獲取成本 (Get Cost)
                _G.__ORIGINAL_GET_COST = _G.__ORIGINAL_GET_COST or ScoutM.getAtkUpgradeCost
                ScoutM.getAtkUpgradeCost = function(self, resType)
                    if _G.__UPGRADE_HACK_ENABLED then
                        return 1 -- 強制改為 1
                    else
                        return _G.__ORIGINAL_GET_COST(self, resType)
                    end
                end

                -- 2. 攔截資產檢查 (Asset Enough Check)
                _G.__ORIGINAL_ENOUGH = _G.__ORIGINAL_ENOUGH or AssetM.isAssetEnough
                AssetM.isAssetEnough = function(self, rid, num)
                    if _G.__UPGRADE_HACK_ENABLED then
                        -- 這裡假設 1001/1002 是升級資源 ID
                        if rid == 1001 or rid == 1002 then return true end
                    end
                    return _G.__ORIGINAL_ENOUGH(self, rid, num)
                end

                _G.__UPGRADE_HACK_ENABLED = true
                status = "UPGRADE_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.upgradeScout = ret.includes("UPGRADE_OK");
        }
    },
    upgradeArkRebuild: {
        name: "方舟重建升級 (ArkRebuild)",
        lua: () => `
            local status = ""
            -- 修正：分別使用正確的變數名
            local ArkM = package.loaded["app.gameplay.module.player.common.PlayerActivityArkRebuild"]
            local AssetM = package.loaded["app.gameplay.module.player.common.PlayerAsset"]

            if ArkM and AssetM then
                -- 1. 攔截 ArkRebuild 的獲取成本 (需確保 ArkM 裡面有這個函數名)
                -- 注意：如果 ArkM 的升級函數不叫 getAtkUpgradeCost，你需要掃描正確的函數名
                _G.__ORIGINAL_ARK_COST = _G.__ORIGINAL_ARK_COST or ArkM.getAtkUpgradeCost
                if ArkM.getAtkUpgradeCost then
                    ArkM.getAtkUpgradeCost = function(self, resType)
                        if _G.__UPGRADE_HACK_ENABLED then
                            return 1 
                        else
                            return _G.__ORIGINAL_ARK_COST(self, resType)
                        end
                    end
                end

                -- 2. 攔截資產檢查
                _G.__ORIGINAL_ENOUGH = _G.__ORIGINAL_ENOUGH or AssetM.isAssetEnough
                AssetM.isAssetEnough = function(self, rid, num)
                    if _G.__UPGRADE_HACK_ENABLED then
                        -- 這裡建議增加一個 print(rid) 來確認 ArkRebuild 到底用哪些資源 ID
                        if rid == 1001 or rid == 1002 then return true end
                    end
                    return _G.__ORIGINAL_ENOUGH(self, rid, num)
                end

                _G.__UPGRADE_HACK_ENABLED = true
                status = "ARK_UPGRADE_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.upgradeArkRebuild = ret.includes("ARK_UPGRADE_OK");
        }
    },
    freeUpgrade: {
        name: "終極免費模式 (Unlock + Free Upgrade)",
        lua: () => `
            local status = ""
            local ArmoryM = package.loaded["app.gameplay.module.player.core.PlayerArmory"]
            local AssetM = package.loaded["app.gameplay.module.player.common.PlayerAsset"]

            if ArmoryM and AssetM then
                -- 1. 繞過武器等級解鎖限制 (isWeaponUnlocked)
                _G.__ORIGINAL_IS_WEAPON_UNLOCKED = _G.__ORIGINAL_IS_WEAPON_UNLOCKED or ArmoryM.isWeaponUnlocked
                ArmoryM.isWeaponUnlocked = function(self, id)
                    if _G.__FREE_MODE_ENABLED then
                        return true -- 讓所有武器無視等級直接解鎖
                    else
                        return _G.__ORIGINAL_IS_WEAPON_UNLOCKED(self, id)
                    end
                end

                -- 2. 繞過資產充足檢查 (isAssetEnough)
                _G.__ORIGINAL_IS_ASSET_ENOUGH = _G.__ORIGINAL_IS_ASSET_ENOUGH or AssetM.isAssetEnough
                AssetM.isAssetEnough = function(self, rid, num)
                    if _G.__FREE_MODE_ENABLED then
                        return true -- 無視資源是否足夠
                    else
                        return _G.__ORIGINAL_IS_ASSET_ENOUGH(self, rid, num)
                    end
                end

                -- 3. 強制扣除數值為 0 (increaseAssetNum)
                _G.__ORIGINAL_INCREASE_ASSET = _G.__ORIGINAL_INCREASE_ASSET or AssetM.increaseAssetNum
                AssetM.increaseAssetNum = function(self, rid, num, logway, isDrop)
                    local finalNum = num
                    -- 只有在 num 為負數（代表扣費）時才攔截
                    if _G.__FREE_MODE_ENABLED and type(num) == "number" and num < 0 then
                        print(string.format("[🛡️] 攔截扣除: ID=%s, 數量=%d -> 已歸零", tostring(rid), num))
                        finalNum = 0
                    end
                    return _G.__ORIGINAL_INCREASE_ASSET(self, rid, finalNum, logway, isDrop)
                end

                _G.__FREE_MODE_ENABLED = true
                status = "ULTIMATE_FREE_OK"
            end
            return (status ~= "" and status or "FAIL")
        `,
        onSuccess: (ret) => { 
            hookStatus.freeUpgrade = ret.includes("ULTIMATE_FREE_OK");
        }
    }
};

/**
 * 2. Centralized Execution Method
 * This handles the "Hook -> Execute -> Update Status" pipeline.
 */
function h(key, val) {

    // 1. 處理預設值 (如果沒傳入 val，預設為 7)
    if (key === 'g') key = 'god';
    if (key === 'd') key = 'damageAmp';
    const finalVal = (val !== undefined) ? val : 7;

    // 2. 快捷鍵映射與狀態紀錄
    if (key === 'god') { 
        hookStatus.currentMultiplier_god = finalVal; 
    }
    if (key === 'damageAmp') {
        hookStatus.currentMultiplier_damage = finalVal;
    }
    const config = scripts[key];
    if (!config) return console.log(`[-] Script ${key} not found.`);


    const luaCode = config.lua(finalVal);

    console.log(`[*] 正在部署: ${config.name}...${finalVal}`);
    
    executeInLua(luaCode, (ret) => {
        if (ret !== "FAIL") {
            config.onSuccess(ret);
            console.log(`[✅] ${config.name} 激活成功`);
        } else {
            console.log(`[❌] ${config.name} 激活失敗 (模組未加載)`);
        }
    });
}

// 在 Frida 控制台執行，搜索哪個 Config 包含這個名稱
function findItemIdByName(name) {
    const luaCode = `
        local target = "${name}"
        for k, v in pairs(package.loaded) do
            if type(v) == "table" then
                for id, data in pairs(v) do
                    if type(data) == "table" and (data.name == target or data.Text == target) then
                        print("找到匹配！ 模組: " .. k .. " | ID: " .. tostring(id))
                    end
                end
            end
        end
        return "SEARCH_DONE"
    `;
    executeInLua(luaCode, console.log);
}
/**
 * 3. Consolidating the "all()" function
 */
function new_all(multiplier) {
    const amp = multiplier || 7;
    
    console.log(`[🚀] 啟動全模組部署 (倍率: ${amp}x)...`);  
// Deploy core combat
    h('god', amp);
    h('damageAmp', amp);   
    h('cardRefresh', 15);

    
    // Manual delay for the UI since we aren't using await
    setTimeout(checkCurrentActivationState, 1000);
}

/**
 * 2. 狀態顯示器 (The Menu UI)
 */
function checkCurrentActivationState() {
    console.log("\n" + "=".repeat(50));
    console.log("      🚀 GALAXY DEFENSE 實時監控中心 🚀");
    console.log("=".repeat(50));
    
    // Status helpers
    const statusIcon = (bool) => bool ? "🟢 [已激活]" : "🔴 [待加載]";
    const subIcon = (bool) => bool ? "  ├ ✅ " : "  ├ ❌ ";
    const ampTxt_god = `(當前: ${hookStatus.currentMultiplier_god}x)`;
    const ampTxt_damage = `(當前: ${hookStatus.currentMultiplier_damage}x)`;

    // --- 1. 核心戰鬥 (Combat Core) ---
    const isCombatReady = hookStatus.blood || hookStatus.damageAmp || hookStatus.cardRefresh;
    console.log(`${statusIcon(isCombatReady)} 核心戰鬥指令 [ a ]`);
    console.log(`${subIcon(hookStatus.blood)} [ g ] 無敵鎖血 ${ampTxt_god}`);
    console.log(`${subIcon(hookStatus.damageAmp)} [ d ] 傷害倍率 ${ampTxt_damage}`);
    console.log(`${subIcon(hookStatus.cardRefresh)} [ c ] 戰鬥刷新 (Refresh)`);

    console.log("-".repeat(50));

    // --- 2. 系統福利 (System Benefits) ---
    console.log(`${statusIcon(hookStatus.lottery)} [ lo ] 抽獎福利 (Lottery)`);
    console.log(`${statusIcon(hookStatus.bp)} [ b ] 戰令系統 (BattlePass)`);
    console.log(`${statusIcon(hookStatus.assetFree)} [ F ] 全域資源 (Asset 0-Cost)`);
    
    console.log("-".repeat(50));

    // --- 3. 限定活動 (Event Specific) ---
    console.log(`${statusIcon(hookStatus.sparkScout)} [ sp ] 對決活動 (SparkScout)`);
    console.log(`${subIcon(hookStatus.upgradeHack)} [ up ]升級消耗修改 (1-Cost)`);
    
    console.log("=".repeat(50));
    console.log(" 💡 指令提示: 直接輸入括號內的字母 (如 'g') 即可切換");
    console.log(" 輸入 [ l ] 查看完整指令清單");
    console.log("=".repeat(50) + "\n");
}



const shortcuts = {
    's': () => checkCurrentActivationState(),
    'a': () => new_all(7),
    'g': () => h('god'),
    'd': () => h('damageAmp'),
    'c': () => h('cardRefresh'),
    'F': () => h('assetFree'), 
    'b': () => h('battlePass'),
    'lo': () => h('lottery'),
    'sp': () => h('sparkScout'),
    'up': () => h('upgradeScout'),
    'uk': () => h('upgradeArkRebuild'),
    'l': () => list()
};

// Apply the getters
Object.keys(shortcuts).forEach(key => {
    Object.defineProperty(globalThis, key, {
        get: function() {
            return shortcuts[key]();
        },
        configurable: true
    });
});


/**
 * 4. Instruction Manual
 * Reflecting the new centralized design and shortcuts.
 */
function list() {
    console.log("\n" + "=".repeat(45));
    console.log("   📜 GALAXY DEFENSE 指令清單 (v2.0)");
    console.log("=".repeat(45));
    
    console.log(" [ 核心 ]");
    console.log("  a                        :  🚀 戰鬥(🛡️ 無敵 +⚔️ 倍傷+🔄 戰鬥卡刷新, 7x)");
    console.log("       - '(g)od'           :  🛡️ 無敵 (val supported) ");
    console.log("       - '(d)amageAmp'     :  ⚔️ 純倍傷(val supported)");
    console.log("       - '(c)ardRefresh'   :  🔄 戰鬥卡刷新");  
    console.log("  asset(F)ree              :  💰 全域 0 消耗");  
    console.log("  (b)attlePass             :  🏆 戰令解鎖");  
    console.log("  (lo)ttery                :  🎫 免費抽獎");   
    console.log("-".repeat(50));   
    console.log("[ 每週活動 ]");     
    console.log("  (sp)arkScout              :  ⚡ 對決修改"); 
    console.log("  (up)gradeScout            :  ⚡ 升級修改"); 
    console.log("  (uk)upgradeArkRebuild     :  ⚡ 升級Ark修改"); 
    console.log("[ 輔助工具 ]");
    console.log("  s                        : 📊 查看實時監控中心 (Status)");
    console.log("  l                        : 📜 顯示此指令清單 (List)");
    console.log("  h(key,val): ⚡ 以 val 倍率重新執行全部");    
    console.log("  scan()                   : 🔍 掃描 package.loaded");
    console.log("  findSide()               : ⚔️ 戰鬥數據深度分析");

    
    console.log("=".repeat(45));
    console.log(" 💡 提示: 直接輸入字母 (如 's') 並按 Enter 即可觸發");
    console.log("=".repeat(45) + "\n");
}

function executeInLua(luaCode, callback) {
    // 我們改用一個一次性的 Interceptor，但確保它能處理連發的請求
    const listener = Interceptor.attach(addr.lua_pcall, {
        onEnter: function(args) {
            const L = args[0];
            // 立即中斷 Hook，避免進入無窮遞迴 (因為我們下面會再次呼叫 lua_pcall)
            listener.detach(); 
            
            const cStr = Memory.allocUtf8String(luaCode);
            
            // 1. 將 Lua 字串加載到棧中
            if (luaL_loadstring(L, cStr) === 0) {
                // 2. 執行加載的腳本
                if (lua_pcall(L, 0, 1, 0) === 0) {
                    // 3. 取得回傳值 (從棧頂 -1 取出)
                    const resPtr = lua_tolstring(L, -1, NULL);
                    if (callback && !resPtr.isNull()) {
                        callback(resPtr.readUtf8String());
                    }
                    // 4. 清理棧，移除回傳值
                    lua_settop(L, -2);
                }
            }
        }
    });
}



// 初始化清單

list();