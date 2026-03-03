Below is a structured markdown document summarizing your progress and the exact workflow developed today. You can copy this content and save it as `README.md` or `RE_Workflow.md` for your GitHub repository.

---

# Unity-LuaJIT Game Reverse Engineering Workflow

This repository documents the successful extraction and decompilation process for a Unity-based iOS game utilizing **LuaJIT 2.1** for core logic.

## 🛠 Project Status

* **Engine:** Unity 2022.3.62f2
* **Backend:** IL2CPP (iOS)
* **Scripting:** LuaJIT 2.1.0-beta3 (64-bit)
* **Current Progress:** Successfully decrypted IPA, extracted AssetBundles, and decompiled thousands of `.lua.bytes` files into readable source code.

---

## 🏗 Extraction & Decompilation Pipeline

### 1. Asset Extraction (Static)

The game logic resides within specific Unity AssetBundles.

* **Source File:** `Payload/[App]/Data/Raw/ios/script/script.ab`
* **Tool:** [AssetStudio (Modded/Razviar Fork)](https://github.com/Razviar/AssetStudio)
* **Step:** 1. Load `script.ab` into AssetStudio on Windows.
2. Filter by `TextAsset`.
3. Select all assets and choose **Export Selected Assets (Raw)**.
4. Resulting files: `*.lua.bytes`.

### 2. Bytecode Verification

Before decompilation, verify the header using a Hex Editor (ImHex) or Terminal.

* **Header Signature:** `1B 4C 4A 02 08`
* **Meaning:** * `1B 4C 4A`: LuaJIT Signature
* `02`: Version 2.1
* `08`: 64-bit flags



### 3. Bulk Decompilation (macOS)

To handle 10,000+ files efficiently, use a recursive Python decompiler.

* **Tool:** [Dr-MTN/luajit-decompiler](https://github.com/Dr-MTN/luajit-decompiler)
* **Command:**
```bash
python3 main.py --recursive "/Input/Path/TextAsset" \
                --dir_out "/Output/Path/Lua_Source" \
                --file-extension ".bytes" \
                --catch_asserts

```



---

## 🔍 Key Discoveries (Logic Analysis)

### Shared Instruction & Filtering

Initial memory modification attempts (via H5GG/Cheat Engine) on damage functions caused crashes. Decompiled Lua reveals that the damage function `updateBlood(dt, enemy)` is a **Shared Instruction** used by both players and enemies.

### Critical Logic Points

* **Player Identification:** The game uses properties like `self._domeInvincibleCD` and `self._extraBlood` which are unique to the Player class.
* **The "Invincibility" Gate:**
```lua
if self._domeInvincibleCD and self._domeInvincibleCD > 0 then 
    dt = 0 -- Damage ignored
end

```


* **The Global Data Object (`P`):** A global object `P` manages player state. `P._playerUnion` and `P._player` are primary targets for attribute modification.

### Enemy Types (ID Mapping)

Defined in `BattleDefine.lua`:

* `Normal`: 1
* `Elite`: 2
* `Boss`: 3
* `Death`: 4

---

## 🚀 Next Steps for Modding

1. **Search for `BattlePropEnum**`: Identify the integer IDs for `HP`, `Atk`, and `Def` to find their offsets in the character property table.
2. **Locate `_camp` or `_type**`: Find the specific memory offset for the Team ID to apply a stable filter in H5Frida.
3. **H5GG Search Strategy**:
* Search for the player's current `_blood` (Float).
* Look for the nearby `_domeInvincibleCD` address.
* Freeze `_domeInvincibleCD` at a high value for God Mode.



---

## 🧰 Tools Summary

| Component | Recommendation |
| --- | --- |
| **Asset Explorer** | AssetStudio (net10.0-win) |
| **Bytecode Viewer** | ImHex |
| **Decompiler** | luajit-decompiler-v2 |
| **Code Editor** | Visual Studio Code |
| **Memory Editor** | H5GG / H5Frida |

---