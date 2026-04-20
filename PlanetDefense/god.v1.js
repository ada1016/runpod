/**
 * GALAXY DEFENSE - 全自動解密分析工具
 */

const targetModule = "UnityFramework";
const modulePtr = Process.getModuleByName(targetModule);

const addr = {
    luaL_loadbufferx: modulePtr.findExportByName('luaL_loadbufferx'),
    lua_pcall: modulePtr.findExportByName('lua_pcall') || ptr("0x110d6cd48"),
    luaL_loadstring: modulePtr.findExportByName('luaL_loadstring'),
    lua_settop: modulePtr.findExportByName('lua_settop')
};

/**
 * 核心：批量 Dump 與解密監控
 */
function startEnhancedDump() {
    if (!addr.luaL_loadbufferx) {
        console.error("[-] 找不到 luaL_loadbufferx，請確認遊戲是否已啟動 Lua 環境。");
        return;
    }

    Interceptor.attach(addr.luaL_loadbufferx, {
        onEnter: function(args) {
            const buffer = args[1];
            const size = args[2].toInt32();
            const fileName = args[3].readUtf8String();

            if (size > 0) {
                // 讀取解密後的二進制數據
                const data = buffer.readByteArray(size);
                
                // 這裡我們直接把解密後的數據傳送回電腦端 (如果你有配合的 Python 接收器)
                // 或者在控制台印出基本資訊
                console.log(`\n[解密成功] 檔案: ${fileName} | 大小: ${size} bytes`);
                
                // 檢查是否為字節碼
                const uint8 = new Uint8Array(data);
                if (uint8[0] === 0x1b && uint8[1] === 0x4c) {
                    console.log(" >> 格式: LuaJIT Bytecode (\x1bLJ)");
                } else {
                    console.log(" >> 格式: Plain Text");
                    // console.log(buffer.readUtf8String(size)); // 如果想直接看明文可開啟
                }
            }
        }
    });
}

/**
 * 核心：注入 Lua 強制加載指令
 */
function triggerForceLoad() {
    // 根據 all_files.txt 整理出的精確內部路徑
    const mods = [
        "config.battle_const",
        "config.battle_skill_config",
        "config.battle_const_config",
        "game.battle.BattleSession",
        "game.battle.BattleRouge",
        "game.battle.BattleController",
        "entity.BattleEnemy.BattleEnemy",
        "entity.BattleHero.BattleHero",
        "data.BattleData",
        "helper.BattleHelper",
        "service.BattleService"
    ];

    const luaCode = `
        local mods = {${mods.map(m => `"${m}"`).join(",")}}
        print("--- 開始強制拉取核心數據 ---")
        for _, m in ipairs(mods) do 
            package.loaded[m] = nil -- 清除緩存確保觸發 loadbuffer
            local status, err = pcall(require, m)
            if status then
                print("[+] 成功觸發加載: " .. m)
            else
                -- 如果加載失敗，嘗試補全路徑格式
                print("[-] 無法直接加載: " .. m)
            end
        end
    `;

    console.log("[*] 正在向 Lua 虛擬機注入【核心全量】加載指令...");

    const listener = Interceptor.attach(addr.lua_pcall, {
        onEnter: function(args) {
            const L = args[0];
            listener.detach();

            const _loadstring = new NativeFunction(addr.luaL_loadstring, 'int', ['pointer', 'pointer']);
            const _pcall = new NativeFunction(addr.lua_pcall, 'int', ['pointer', 'int', 'int', 'int']);
            const _settop = new NativeFunction(addr.lua_settop, 'void', ['pointer', 'int']);

            const cStr = Memory.allocUtf8String(luaCode);
            if (_loadstring(L, cStr) === 0) {
                _pcall(L, 0, 0, 0); // 執行強制加載
                console.log("[+] 指令已送達。請密切注意 Dump 輸出...");
            }
        }
    });
}
// 啟動流程
startEnhancedDump();
console.log("[*] 監聽中。輸入 triggerForceLoad() 來強制拉取關鍵檔案。");