/**
 * GALAXY DEFENSE - 終極分析導出版
 */
const targetModule = "UnityFramework";
const modulePtr = Process.getModuleByName(targetModule);

const addr = {
    luaL_loadbufferx: modulePtr.findExportByName('luaL_loadbufferx'),
    lua_pcall: modulePtr.findExportByName('lua_pcall') || ptr("0x110d6cd48"),
    luaL_loadstring: modulePtr.findExportByName('luaL_loadstring'),
};

function startLogDump() {
    Interceptor.attach(addr.luaL_loadbufferx, {
        onEnter: function(args) {
            const buffer = args[1];
            const size = args[2].toInt32();
            if (size <= 0) return;

            const fileName = args[3].readUtf8String();
            
            // 只要是戰鬥、配置、屬性相關的，通通噴出來
            if (fileName.includes("stats") || fileName.includes("battle") || fileName.includes("config")) {
                console.log("---DUMP_START---");
                console.log("NAME:" + fileName);
                console.log("SIZE:" + size);
                // 把整個檔案轉成不換行的 Hex 字串
                const data = buffer.readByteArray(size);
                const uint8 = new Uint8Array(data);
                let hex = "";
                for (let i = 0; i < uint8.length; i++) {
                    hex += uint8[i].toString(16).padStart(2, '0');
                }
                console.log("HEX:" + hex);
                console.log("---DUMP_END---");
            }
        }
    });
}

function triggerForceLoad() {
    const mods = ["config.battle_const", "game.stats.player_stats", "game.stats.character_stats"];
    const luaCode = `for _, m in ipairs({${mods.map(m => `"${m}"`).join(",")}}) do package.loaded[m] = nil pcall(require, m) end`;
    const listener = Interceptor.attach(addr.lua_pcall, {
        onEnter: function(args) {
            listener.detach();
            const _loadstring = new NativeFunction(addr.luaL_loadstring, 'int', ['pointer', 'pointer']);
            const _pcall = new NativeFunction(addr.lua_pcall, 'int', ['pointer', 'int', 'int', 'int']);
            if (_loadstring(args[0], Memory.allocUtf8String(luaCode)) === 0) {
                _pcall(args[0], 0, 0, 0);
                console.log("[+] 指令已發送");
            }
        }
    });
}

startLogDump();