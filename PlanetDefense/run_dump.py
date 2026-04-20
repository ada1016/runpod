import re
import binascii
import os

# 建立輸出資料夾
output_dir = "./restored_files"
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

print(f"[*] 正在從 frida_dump.log 提取檔案...")

with open("frida_dump.log", "r", encoding="utf-8", errors="ignore") as f:
    log_content = f.read()

# 使用與你日誌完全相符的正則表達式
# 匹配 ---DUMP_START--- 到 ---DUMP_END--- 之間的內容
pattern = re.compile(
    r"---DUMP_START---\nNAME:(.*?)\nSIZE:(.*?)\nHEX:(.*?)\n---DUMP_END---", 
    re.DOTALL
)

matches = pattern.findall(log_content)

count = 0
for name, size, hex_data in matches:
    try:
        name = name.strip()
        # 處理檔名：如果是長字串（匿名函數），截斷它以免檔名太長報錯
        if len(name) > 50:
            safe_name = "anon_" + name[:30].replace(" ", "_")
        else:
            safe_name = name.replace('@', '').replace('/', '_').replace(' ', '_')
            
        # 移除非法字元
        safe_name = "".join([c for c in safe_name if c.isalnum() or c in ('_', '.')]).rstrip('.')
        
        # 辨識 Header 決定副檔名
        hex_data = hex_data.strip()
        binary_data = binascii.unhexlify(hex_data)
        
        ext = ".luac" if binary_data.startswith(b'\x1b') else ".lua"
        file_path = os.path.join(output_dir, safe_name + ext)
        
        with open(file_path, "wb") as f:
            f.write(binary_data)
        
        print(f"[+] 成功還原: {safe_name}{ext} ({len(binary_data)} bytes)")
        count += 1
    except Exception as e:
        print(f"[-] 跳過檔案 {name[:20]}... 錯誤: {e}")

print(f"\n[*] 完成！共還原 {count} 個檔案到 {output_dir} 資料夾。")