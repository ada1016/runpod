/**
 * 核心地址定義與符號探測
 */
const targetModule = "UnityFramework";
const modulePtr = Process.getModuleByName(targetModule);

// 建立 addr 物件並進行符號驗證
const addr = {};
const symbols = [
    'luaL_loadstring', 'lua_pcall', 'lua_tolstring', 
    'lua_getfield', 'lua_type', 'lua_settop', 
    'lua_next', 'lua_pushnil'
];

symbols.forEach(name => {
    // 優先尋找導出符號
    let ptr = modulePtr.findExportByName(name);
    
    // 如果找不到導出符號，這裡通常需要填入 IDA 找到的靜態偏移 (Offset)
    // 例如：if (!ptr) ptr = modulePtr.base.add(0x123456); 
    
    addr[name] = ptr;

    if (ptr) {
        console.log(`[+] 成功定位符號: ${name} -> ${ptr}`);
    } else {
        console.error(`[-] 警告: 找不到符號 ${name}，請檢查是否被剝離 (Stripped)`);
    }
});

// 檢查核心地址 0x110d6cd48 (你之前掃描到的地址) 是否為其中之一
// 假設它就是 lua_pcall
if (!addr.lua_pcall) {
    addr.lua_pcall = ptr("0x110d6cd48");
    console.log(`[*] 使用掃描地址作為 lua_pcall: ${addr.lua_pcall}`);
}

/**
 * Native Function Wrappers (帶有安全檢查)
 */
function getNative(name, ret, args) {
    if (addr[name] && !addr[name].isNull()) {
        return new NativeFunction(addr[name], ret, args);
    }
    return null;
}

const _luaL_loadstring = getNative('luaL_loadstring', 'int', ['pointer', 'pointer']);
const _lua_pcall       = getNative('lua_pcall', 'int', ['pointer', 'int', 'int', 'int']);
const _lua_tolstring   = getNative('lua_tolstring', 'pointer', ['pointer', 'int', 'pointer']);
const _lua_settop      = getNative('lua_settop', 'void', ['pointer', 'int']);

// 檢查核心工具是否就緒
const isReady = _luaL_loadstring && _lua_pcall;

/**
 * 執行 Lua 腳本
 * @param {string} luaCode - 要執行的代碼
 * @param {function} callback - 處理回傳值的回調
 */
function executeInLua(luaCode, callback) {
    if (!isReady) {
        console.error("[-] 核心 Lua API 未就緒，無法執行腳本。");
        return;
    }

    // 攔截 lua_pcall 以獲取當前有效的 L (lua_State)
    const listener = Interceptor.attach(addr.lua_pcall, {
        onEnter: function(args) {
            const L = args[0];
            
            // 立即 detach 以免無限遞迴
            listener.detach(); 

            try {
                const cStr = Memory.allocUtf8String(luaCode);
                
                // 1. 加載腳本 (成功返回 0)
                if (_luaL_loadstring(L, cStr) === 0) {
                    
                    // 2. 執行腳本 (0 參數, 1 回傳值)
                    if (_lua_pcall(L, 0, 1, 0) === 0) {
                        
                        // 3. 取得結果
                        if (_lua_tolstring && callback) {
                            const resPtr = _lua_tolstring(L, -1, NULL);
                            if (!resPtr.isNull()) {
                                callback(resPtr.readUtf8String());
                            }
                        }
                        
                        // 4. 平衡棧 (移除我們加載的結果)
                        if (_lua_settop) _lua_settop(L, -2);
                        
                        console.log("[+] Lua 代碼執行成功");
                    } else {
                        console.error("[-] Lua 執行失敗 (pcall error)");
                    }
                } else {
                    console.error("[-] Lua 加載失敗 (syntax error)");
                }
            } catch (e) {
                console.error("[-] executeInLua 發生異常: " + e);
            }
        }
    });
}