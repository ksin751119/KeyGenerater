#!/bin/bash

# 設置必要的環境變量
export KMS_KEY_ARN=""
export SECRET_ARN=""
export BITWARDEN_COLLECTION_NAME=""
export BITWARDEN_ITEM_NAME=""
export AWS_REGION=""
export BW_SERVER=""

# 新增 BITWARDEN_ENABLED 環境變數
export BITWARDEN_ENABLED=false




# 詢問是否使用 Bitwarden
read -p "是否需要使用 Bitwarden？(y/n): " use_bitwarden

if [ "$use_bitwarden" = "y" ]; then
    export BITWARDEN_ENABLED=true
    if ! bw login --check; then
        echo "Bitwarden 未登入，正在進行登入操作..."

        # 嘗試登出（如果已登錄）
        bw logout || true

        # 設置服務器配置
        bw config server $BW_SERVER

        # 登錄 Bitwarden
        bw login

        echo "Bitwarden 登入成功。"
    else
        echo "Bitwarden 已經登入。"
    fi

    # 獲取會話密鑰並設置為環境變量
    export BW_SESSION=$(bw unlock --raw)

    # 如果 unlock 失敗，則退出腳本
    if [ $? -ne 0 ]; then
        echo "無法解鎖 Bitwarden vault。請檢查您的主密碼。"
        exit 1
    fi

    echo "Bitwarden vault 已解鎖。會話已設置。"
else
    echo "不使用 Bitwarden。"
fi

# 運行 keyGenerate.ts
npx ts-node keyGenerate.ts
