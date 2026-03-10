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

/**
 * 1. 快速掃描模組 (Package Scanner)
 */
function scan() {
    console.log("[*] 正在啟動深度掃描... 請在遊戲中執行任意動作 (如點擊按鈕) 以觸發 Hook");
    const listener = Interceptor.attach(addr.lua_pcall, {
        onEnter: function(args) {
            const L = args[0];
            listener.detach();
            try {
                lua_getfield(L, -10002, Memory.allocUtf8String("package")); // LUA_GLOBALSINDEX
                if (lua_type(L, -1) === 5) { // LUA_TTABLE
                    lua_getfield(L, -1, Memory.allocUtf8String("loaded"));
                    if (lua_type(L, -1) === 5) {
                        console.log("\n--- [掃描] package.loaded 匹配清單 ---");
                        lua_pushnil(L); 
                        while (lua_next(L, -2) !== 0) {
                            let keyPtr = lua_tolstring(L, -2, NULL);
                            if (!keyPtr.isNull()) {
                                let keyName = keyPtr.readUtf8String();
                                let lowerKey = keyName.toLowerCase();
                                const filters = ["battle", "enemy", "rebuild", "session", "player", "lottery"];
                                if (filters.some(f => lowerKey.indexOf(f) !== -1)) {
                                    console.log(`[FOUND] ${keyName}`);
                                }
                            }
                            lua_settop(L, -2);
                        }
                        console.log("--- [掃描] 結束 ---\n");
                    }
                }
                lua_settop(L, 0); 
            } catch (e) { console.log("[-] 掃描出錯: " + e); }
        }
    });
}


/**
 * (New) Side Differentiation Function
 * Run this during a PvP match to identify which 'self' is YOU.
 */

function findSide() {
    console.log("[*] 正在啟動 Brute-force 偵測模組：正在抓取所有內部位元...");

    const script = `
        local bsTarget = "battle.Data.BattleSession"
        local BS = package.loaded[bsTarget]
        
        if BS then
            if not _G.__ORIGINAL_UPDATEBLOOD then
                _G.__ORIGINAL_UPDATEBLOOD = BS.updateBlood
            end

            BS.updateBlood = function(self, dt, enemy)
                if dt < 0 then
                    -- 抓取當前實例的所有 Key 並串成字串
                    local dump = ""
                    for k, v in pairs(self) do
                        if type(v) == "number" or type(v) == "boolean" or type(v) == "string" then
                            dump = dump .. k .. ":" .. tostring(v) .. " | "
                        end
                    end
                    _G.__DOME_DUMP = dump
                end
                return _G.__ORIGINAL_UPDATEBLOOD(self, dt, enemy)
            end
            return "DUMP_HOOK_READY"
        end
        return "NOT_FOUND"
    `;

    executeInLua(script, (res) => {
        if (res === "DUMP_HOOK_READY") {
            console.log("[★★★] 偵測模組已掛載。請在戰鬥中讓敵人攻擊你...");
            
            const pollId = setInterval(() => {
                executeInLua('local d = _G.__DOME_DUMP; _G.__DOME_DUMP = nil; return d', (dump) => {
                    if (dump && dump !== "nil") {
                        console.log("\n[!!!] 捕獲到受傷數據波形:");
                        console.log(dump);
                        // 如果抓到了數據，我們停止輪詢以免洗版
                        // clearInterval(pollId); 
                    }
                });
            }, 1000);
        } else {
            console.log("[-] 失敗：找不到 BattleSession。");
        }
    });
}


/**
 * 2. 智能戰鬥模組 (無敵 + 倍傷 + 敵我辨識 + 刷新)
 */

function god() {
    console.log("[*] 正在開啟『智能偵錯』戰鬥模組...");

    const script = `
        local bsTarget = "battle.Data.BattleSession"
        local brTarget = "battle.Data.BattleRouge"  
        local beTarget = "battle.Data.entity.BattleEnemy.BattleEnemy"

        local BS = package.loaded[bsTarget]
        local BR = package.loaded[brTarget]
        local BE = package.loaded[beTarget]
        local res = ""
        if BS then
            if not _G.__ORIGINAL_UPDATEBLOOD then
                _G.__ORIGINAL_UPDATEBLOOD = BS.updateBlood
            end

            BS.updateBlood = function(self, dt, enemy)
  
                -- 修改後的無敵邏輯：移除 BE.attackPlayer 避免全域卡死
                if self._index == 1 then
                    dt = 0               -- You are invincible
                elseif self._index == 2 then
                    self._domeImmuneDmgNum = 0
                    dt = dt * 10          -- Enemy takes 5x damage
                end

                return _G.__ORIGINAL_UPDATEBLOOD(self, dt, enemy)
            end
            
            -- 備份並代理 multipyDamage (5倍傷害)
            if not _G.__ORIGINAL_MULTIPY then
                _G.__ORIGINAL_MULTIPY = BE.multipyDamage
            end
            BE.multipyDamage = function(self, damage, skill, ...)
                local val = _G.__ORIGINAL_MULTIPY(self, damage, skill, ...)
                if _G.__DAMAGE_AMP_ENABLED then
                    return val * 7
                end
                return val
            end

            res = res .. "BattleEnemy_OK "
        end

        -- 處理 肉鴿刷新 (BR)
        if BR then
            BR.getLeftAdRefreshNum = function(self)
                return 7
            end
            res = res .. "BattleRouge_OK"
        end

        _G.__GOD_MODE_ENABLED = true
        _G.__DAMAGE_AMP_ENABLED = true
        return (res ~= "" and res or "NOT_FOUND")
    `;

    executeInLua(script, (res) => {
        if (res !== "NOT_FOUND") {
            console.log("[★★★] 戰鬥模組啟動成功:✅ " + res);
        } else {
            console.log("[-] 失敗：找不到 BattleEnemy 或 BattleRouge，請確認是否在戰鬥中。");
        }
    });
}

/**
 * 3. 抽獎模組 (Ark / Week)
 */
function lottery() {
    console.log("[*] 正在執行綜合抽獎模組 Hook...");
    const script = `
        local targets = {
            BA = "app.gameplay.module.player.common.PlayerArkRebuildLottery",
            W1 = "app.gameplay.module.player.common.PlayerWeekLottery",
            W2 = "app.gameplay.module.player.common.PlayerWeekLottery2"
        }
        local res = ""
        for k, path in pairs(targets) do
            local M = package.loaded[path]
            if M then
                M.haveFree = function() return true end
                res = res .. k .. "_OK "
            end
        end
        return (res ~= "" and res or "NOT_FOUND")
    `;
    executeInLua(script, (res) => console.log(res !== "NOT_FOUND" ? "[★★★] 抽獎 Hook 成功: ✅ " + res : "[-] 失敗"));
}

/**
 * 4. BattlePass 解鎖模組
 */
function bp() {
    console.log("[*] 正在修改 BattlePass 基類邏輯...");
    const script = `
        local baseTarget = "app.gameplay.module.player.common.PlayerBattlePassBase"
        local Base = package.loaded[baseTarget]
        if Base then
            Base.isStepUnlock = function() return true end
            if Base.getCurRewardLevel then
                Base.getCurRewardLevel = function(self) return self:readMaxLevel() end
            end
            return "BP_BASE_PATCHED"
        end
        return "NOT_FOUND"
    `;
    executeInLua(script, (res) => console.log(res === "BP_BASE_PATCHED" ? "[★★★] BP 修改成功！ ✅" : "[-] 失敗"));
}

function freeDuel() {
    console.log("[*] 正在開啟『免費對決』模組...");

    const script = `
        local target = "app.gameplay.module.player.common.PlayerActivitySparkScout" -- 請用 scan() 確認路徑
        local M = package.loaded[target]
        
        if M then
            if not _G.__ORIGINAL_TRYDUELCOST then
                _G.__ORIGINAL_TRYDUELCOST = M.tryDuelCost
            end

            M.tryDuelCost = function(self)
                if self:isDuelCosted() then return end

                -- 核心修改：將扣除數量從 1 改為 0
                P._playerAsset:decreaseAssetNum(D.ResType.spark_scout_duel_ticket, 0, D.LogWay.spark_scout_duel)
                
                -- 保持後續邏輯完整，確保 UI 不會卡死
                self:setDuelCosted(true)
                SimpleEvent.emit("spark.duel.cost")
                
                print("[LUA] Duel ticket bypass triggered: Cost set to 0")
            end
            return "DUEL_PATCH_OK"
        end
        return "NOT_FOUND"
    `;

    executeInLua(script, (res) => {
        if (res === "DUEL_PATCH_OK") {
            console.log("[★★★] 免費對決啟動成功！ ✅");
        } else {
            console.log("[-] 失敗：找不到 PlayerDuel。請先點開對決頁面再執行。");
        }
    });
}

function a(){
    god();
    freeDuel();
}

function b(){
    lottery();
    bp();
}

/**
 * Helper: Execute Lua in Game State
 */
function executeInLua(luaCode, callback) {
    const listener = Interceptor.attach(addr.lua_pcall, {
        onEnter: function(args) {
            const L = args[0];
            Interceptor.detachAll(); 
            const cStr = Memory.allocUtf8String(luaCode);
            if (luaL_loadstring(L, cStr) === 0) {
                if (lua_pcall(L, 0, 1, 0) === 0) {
                    const lua_tolstring = new NativeFunction(addr.lua_tolstring, 'pointer', ['pointer', 'int', 'pointer']);
                    const resPtr = lua_tolstring(L, -1, NULL);
                    if (callback && !resPtr.isNull()) callback(resPtr.readUtf8String());
                }
            }
        }
    });
}



/**
 * Console Menu
 */
console.log("-----------------------------------------");
console.log("  Galaxy Defense 綜合工具箱 (V5)");
console.log("-----------------------------------------");
console.log("  a()      -> Combo of god()+ freeDuel()");
console.log("  b()      -> Combo of lottery()+ bp()");
console.log("-----------------------------------------");
console.log("  findSide() -> 抓取當前實例的所有 Key 並串成字串");
console.log("  scan()     -> 掃描目前載入的 Lua 類別");
console.log("  god()      -> 智能戰鬥 (無敵/倍傷/對手脆化)");
console.log("  bp()       -> 解鎖 BattlePass 獎勵+lottery 免費抽獎");
console.log("  lottery()  -> 免費抽獎 (Ark/Week)");
console.log("  freeDuel()  -> 啟『免費對決』模組");
console.log("-----------------------------------------");