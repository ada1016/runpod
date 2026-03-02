To attach from Frida, workaround
    LLDB console
    pgrep -i "GalaxyDefense"
    lldb -p 5123

Frida console
    frida -p 5123

LLDB console
    Exit


Basic logic on LuaJIT mod



These messages come from:  lua_load / luaL_loadbuffer (internals)

“attempt to load chunk with wrong mode”
“cannot load incompatible bytecode”


the code to display app location
(function() {
    var path = ObjC.classes.NSBundle.mainBundle().bundlePath().toString();
    console.log("[+] 遊戲完整路徑: " + path);
})();



# 進入該目錄下的 Frameworks 尋找主邏輯庫
cd "/你的完整路徑/Frameworks/UnityFramework.framework"

# 執行關鍵字掃描
strings UnityFramework | grep -Ei "xlua_|tolua_|slua_|luajit_" | head -n 20


the code to display method once identified by IDA
var moduleBase = Module.findBaseAddress("UnityFramework");
var targetAddr = moduleBase.add(0xYOUR_OFFSET); 
Interceptor.attach(targetAddr, {
    onEnter: function(args) {
        console.log("Lua script loading...");
        console.log(hexdump(args[1])); // 打印出 Bytecode 內容
    }
});



