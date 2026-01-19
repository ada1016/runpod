#!/bin/bash

# 切換到 /workspace
cd /workspace

# --- 第一部分：環境安裝 (僅在資料夾不存在時執行) ---
if [ ! -d "/workspace/ComfyUI" ]; then
    echo "--- 偵測到首次啟動，開始完整安裝流程 ---"

    echo "正在下載 ComfyUI-Manager 安裝腳本..."
    wget https://github.com/ltdrdata/ComfyUI-Manager/raw/main/scripts/install-comfyui-venv-linux.sh -O install-comfyui-venv-linux.sh
    chmod +x install-comfyui-venv-linux.sh
    
    echo "執行官方環境安裝 (這會建立 venv 並下載 ComfyUI)..."
    ./install-comfyui-venv-linux.sh

    echo "安裝指定的 Custom Nodes..."
    git -C /workspace/ComfyUI/custom_nodes clone https://github.com/ada1016/comfyui-model-downloader.git
    git -C /workspace/ComfyUI/custom_nodes clone https://github.com/ada1016/ComfyUI-RunpodDirect.git
    git -C /workspace/ComfyUI/custom_nodes clone https://github.com/rgthree/rgthree-comfy.git
    git -C /workspace/ComfyUI/custom_nodes clone https://github.com/ltdrdata/ComfyUI-Impact-Pack.git

    echo "安裝依賴套件 (pip install)..."
    /workspace/ComfyUI/venv/bin/python -m pip install --no-cache-dir -r /workspace/ComfyUI/requirements.txt
    /workspace/ComfyUI/venv/bin/python -m pip install --no-cache-dir -r /workspace/ComfyUI/custom_nodes/ComfyUI-Impact-Pack/requirements.txt

    echo "清理安裝臨時檔案..."
    rm -f install-comfyui-venv-linux.sh run_cpu.sh
else
    echo "--- 偵測到已有 ComfyUI 環境，跳過安裝過程 ---"
fi

# --- 第二部分：路徑與配置 (每次開機執行) ---
echo "--- 正在更新模型路徑配置 (extra_model_paths.yaml) ---"
wget https://raw.githubusercontent.com/ada1016/runpod/main/runpod_template/extra_model_paths.yaml -O /workspace/ComfyUI/extra_model_paths.yaml

echo "--- 正在預建模型子目錄以對齊 YAML 配置 ---"
mkdir -p /workspace/temp/models/{checkpoints,clip,clip_vision,configs,controlnet,embeddings,diffusion_models,loras,upscale_models,vae,unet,text_encoders}
mkdir -p /workspace/temp/user/default/workflows

echo "--- 正在連結 Workflows 持久化路徑 ---"
if [ -d "/workspace/ComfyUI/user" ] && [ ! -L "/workspace/ComfyUI/user" ]; then
    rm -rf /workspace/ComfyUI/user
fi
[ ! -L "/workspace/ComfyUI/user" ] && ln -s /workspace/temp/user /workspace/ComfyUI/user

# --- 第三部分：私有 LoRA 模型同步 (Python API 版) ---
if [ -n "$HF_TOKEN" ]; then
    echo "--- 正在檢查並同步私有 LoRA 模型 ---"
    
    # 1. 強制升級套件 (解決 1.3.2 過舊且缺少模組的問題)
    /workspace/ComfyUI/venv/bin/python -m pip install -U huggingface_hub -q

    LORA_DIR="/workspace/loras"
    HF_REPO="ada1016/difusion-pipe-train"
    
    files=(
        "zimage_lora_sks_alice.safetensors"
        "zimage_lora_sks_ava.safetensors"
        "zimage_lora_sks_angie.safetensors"
        "zimage_lora_sks_apple.safetensors"
    )

    for file in "${files[@]}"; do
        if [ ! -f "$LORA_DIR/$file" ]; then
            echo "偵測到缺失檔案: $file，正在下載..."
            # 使用官方文檔推薦的 hf_hub_download 函數
            /workspace/ComfyUI/venv/bin/python -c "
import os
from huggingface_hub import hf_hub_download

# 設定環境變數供 Python 讀取
token = os.getenv('HF_TOKEN')
repo_id = '$HF_REPO'
filename = '$file'
local_dir = '$LORA_DIR'

try:
    # 根據官方 doc: 指定 local_dir 時，建議 local_dir_use_symlinks=False 以獲得實體檔案
    path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=local_dir,
        token=token,
        local_dir_use_symlinks=False
    )
    print(f'成功下載至: {path}')
except Exception as e:
    print(f'下載 $file 失敗: {str(e)}')
"
        else
            echo "檔案已存在: $file"
        fi
    done
else
    echo "警告: 未偵測到 HF_TOKEN，跳過私有模型同步。"
fi

# --- 第四部分：啟動服務 ---
echo "--- 正在以正確參數啟動服務 ---"
pkill -f main.py

# 啟動 Runpod 核心系統服務 (Jupyter/SSH)
/start.sh &

# 進入目錄並啟動 ComfyUI
cd /workspace/ComfyUI
# 在啟動 main.py 之前加入這行
echo "正在強制修正環境依賴衝突..."
/workspace/ComfyUI/venv/bin/python -m pip install --upgrade transformers tokenizers huggingface_hub packaging
./venv/bin/python main.py --listen 0.0.0.0 --port 8188 --preview-method auto