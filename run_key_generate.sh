#!/bin/bash

# 基本環境變數設置
read -p "請輸入 ASSUME_ROLE (預設: across-admin): " input_assume_role
ASSUME_ROLE="${input_assume_role:-across-admin}"

read -p "請輸入 KMS_KEY_ARN: " input_kms_key_arn
export KMS_KEY_ARN="${input_kms_key_arn}"

read -p "請輸入 SECRET_ARN: " input_secret_arn
export SECRET_ARN="${input_secret_arn}"

read -p "請輸入 AWS_REGION (預設: us-east-1): " input_aws_region
export AWS_REGION="${input_aws_region:-us-east-1}"

# 設置預設值
export BITWARDEN_ENABLED=false

# 詢問是否使用 Bitwarden
read -p "是否需要使用 Bitwarden？(y/n): " use_bitwarden

if [ "$use_bitwarden" = "y" ]; then
    export BITWARDEN_ENABLED=true

    # 只在啟用 Bitwarden 時才詢問相關設定
    read -p "請輸入 BITWARDEN_COLLECTION_NAME (預設: Solver Key): " input_bw_collection
    export BITWARDEN_COLLECTION_NAME="${input_bw_collection:-Solver Key}"

    read -p "請輸入 BITWARDEN_ITEM_NAME (預設: Across Barn Key): " input_bw_item
    export BITWARDEN_ITEM_NAME="${input_bw_item:-Across Barn Key}"

    read -p "請輸入 BW_SERVER (預設: https://vault.bitwarden.eu): " input_bw_server
    export BW_SERVER="${input_bw_server:-https://vault.bitwarden.eu}"

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


# 詢問使用者要使用哪種金鑰類型
read -p "請選擇金鑰類型 (1: privateKey, 2: mnemonic): " key_type_choice

# 設定金鑰類型
if [ "$key_type_choice" = "1" ]; then
    key_type="privateKey"
elif [ "$key_type_choice" = "2" ]; then
    key_type="mnemonic"
else
    echo "無效的選擇，預設使用 mnemonic"
    key_type="mnemonic"
fi

read -p "是否要使用自定義 seed？(y/n): " use_custom_seed

# 如果選擇了 mnemonic，詢問助記詞長度
if [ "$key_type" = "mnemonic" ]; then
    read -p "請選擇助記詞長度 (12 或 24，預設為 24): " mnemonic_length

    # 驗證輸入的長度是否有效
    case "$mnemonic_length" in
        12|24)
            ;;
        "")
            mnemonic_length="24"  # 使用預設值
            ;;
        *)
            echo "無效的助記詞長度，使用預設值 24"
            mnemonic_length="24"
            ;;
    esac
fi

if [ "$use_custom_seed" = "y" ]; then
    read -p "請輸入自定義 seed: " custom_seed

    if [ "$key_type" = "mnemonic" ]; then
        eval $(assume-role $ASSUME_ROLE)
        npx ts-node keyGenerate.ts --keyType "$key_type" --customSeed "$custom_seed" --mnemonicLength "$mnemonic_length"
    else
        eval $(assume-role $ASSUME_ROLE)
        npx ts-node keyGenerate.ts --keyType "$key_type" --customSeed "$custom_seed"
    fi
else
    if [ "$key_type" = "mnemonic" ]; then
        eval $(assume-role $ASSUME_ROLE)
        npx ts-node keyGenerate.ts --keyType "$key_type" --mnemonicLength "$mnemonic_length"
    else
        eval $(assume-role $ASSUME_ROLE)
        npx ts-node keyGenerate.ts --keyType "$key_type"
    fi
fi
