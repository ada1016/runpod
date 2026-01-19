#!/bin/bash
echo "--- STARTING MODEL ALIGNMENT ---"

# 定義你的實體模型存放處 (你的磁碟)
SOURCE_DIR="/workspace/temp/models/loras"

# 1. 對接標準路徑
mkdir -p /workspace/loras
ln -sfn $SOURCE_DIR /workspace/loras


# 3. 檢查連結是否成功 (這會出現在 Log 裡)
echo "Checking /workspace/loras content:"
ls /workspace/loras

echo "--- ALIGNMENT COMPLETE, LAUNCHING HANDLER ---"
python -u /handler.py

#docker command:  /bin/bash /workspace/pre_start.sh