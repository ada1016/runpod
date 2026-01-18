FROM runpod/comfyui:latest

# 1. 確保基礎依賴
RUN apt-get update && apt-get install -y --no-install-recommends \
    git wget curl cmake build-essential libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 2. 將 ComfyUI 安裝在完全獨立的根目錄 (避開所有官方掛載點)
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /workspace/ComfyUI

# 3. 安裝您指定的插件
#WORKDIR /workspace/ComfyUI/custom_nodes
#RUN git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Manager.git && \
#    git clone --depth 1 https://github.com/rgthree/rgthree-comfy.git && \
#    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Pack.git
# Create a backup/template folder for your nodes
RUN mkdir -p /opt/custom_nodes_defaults

WORKDIR /opt/custom_nodes_defaults
RUN git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Manager.git
RUN git clone --depth 1 https://github.com/rgthree/rgthree-comfy.git
RUN git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Pack.git

# 4. 預裝依賴，避免開機時下載
WORKDIR /workspace/ComfyUI
RUN pip install --no-cache-dir -r requirements.txt

# 5. 複製路徑設定檔 (base_path 仍設為 /workspace)
COPY extra_model_paths.yaml /workspace/ComfyUI/extra_model_paths.yaml

# 6. 抹除 Entrypoint，不給官方 /start.sh 執行的機會
ENTRYPOINT []
ENV SHELL=/bin/bash

# 7. 啟動指令：直接啟動，不經過任何腳本
# Change your CMD to this:
CMD ["/bin/bash", "-c", "mkdir -p /workspace/ComfyUI/custom_nodes && cp -r /opt/custom_nodes_defaults/* /workspace/ComfyUI/custom_nodes/ && cd /workspace/ComfyUI && python3 main.py --listen 0.0.0.0 --port 8188 & jupyter lab --allow-root --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='' --notebook-dir=/ --ServerApp.allow_origin='*'"]
