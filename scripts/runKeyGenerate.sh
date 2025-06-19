#!/bin/bash

# 顏色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 函數：顯示提示訊息
prompt() {
    echo -e "${GREEN}$1${NC}"
}

# 函數：顯示警告訊息
warn() {
    echo -e "${YELLOW}$1${NC}"
}

# 函數：顯示信息
print_info() {
    echo -e "${BLUE}[信息] ${NC}$1"
}

# 函數：顯示錯誤
print_error() {
    echo -e "${RED}[錯誤] ${NC}$1"
}

# 函數：讀取輸入並設定預設值（新增 secure 參數）
read_input() {
    local prompt_text="$1"
    local default_value="$2"
    local is_secure="$3"
    local input_value=""

    if [ "$is_secure" = "true" ]; then
        # 使用 -s 參數來隱藏輸入
        read -s -p "$(prompt "$prompt_text: ")" input_value
        echo  # 新增換行
    else
        read -p "$(prompt "$prompt_text [預設: $default_value]: ")" input_value
    fi

    # 如果輸入為空且有預設值，則使用預設值
    if [ -z "$input_value" ] && [ -n "$default_value" ]; then
        echo "$default_value"
    else
        echo "$input_value"
    fi
}

# 函數：是否確認
confirm() {
    local prompt_text="$1"
    local response
    read -p "$(prompt "$prompt_text (y/n): ")" response
    case "$response" in
        [yY]* ) return 0 ;;
        * ) return 1 ;;
    esac
}

# 函數：驗證數字輸入
validate_number() {
    local input="$1"
    local valid_values="$2"
    local default_value="$3"

    if [[ ! " $valid_values " =~ " $input " ]]; then
        warn "無效的輸入值，使用預設值 $default_value"
        echo "$default_value"
    else
        echo "$input"
    fi
}

# 函數：檢查 AWS CLI
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        print_error "未找到 AWS CLI，請先安裝 AWS CLI"
        exit 1
    fi
}

# 函數：載入 AWS 預設值
load_aws_defaults() {
    if [ -f ~/.aws/assume-role-defaults ]; then
        source ~/.aws/assume-role-defaults
    fi
}

# 函數：保存 AWS 預設值
save_aws_defaults() {
    mkdir -p ~/.aws
    echo "LAST_ACCOUNT_ID=\"$ACCOUNT_ID\"" > ~/.aws/assume-role-defaults
    echo "LAST_ROLE=\"$ASSUME_ROLE\"" >> ~/.aws/assume-role-defaults
    echo "LAST_REGION=\"$AWS_REGION\"" >> ~/.aws/assume-role-defaults
}

# 函數：AWS 登入
aws_login() {
    print_info "正在進行 AWS 登入..."

    check_aws_cli
    load_aws_defaults

    # 取得 AWS 帳號資訊
    local caller_identity
    caller_identity=$(aws sts get-caller-identity 2>&1)
    if [ $? -ne 0 ]; then
        print_error "無法取得 AWS 身份資訊，請確認 AWS 配置是否正確"
        print_error "$caller_identity"
        exit 1
    fi

    print_info "當前 AWS 身份:"
    # echo "$caller_identity"

    # 取得 MFA 裝置序號
    local mfa_serial
    mfa_serial=$(aws iam list-mfa-devices --query 'MFADevices[0].SerialNumber' --output text 2>&1)
    if [ $? -ne 0 ] || [ "$mfa_serial" == "None" ]; then
        print_error "無法取得 MFA 裝置資訊"
        print_error "$mfa_serial"
        exit 1
    fi

    # 要求輸入 MFA 代碼
    local token_code
    read -p "$(prompt "請輸入 MFA 代碼: ")" token_code

    # 使用 STS assume-role
    print_info "正在切換到角色: $ASSUME_ROLE"
    local credentials
    credentials=$(aws sts assume-role \
        --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/${ASSUME_ROLE}" \
        --role-session-name "CLI-Session-$(date +%s)" \
        --serial-number "$mfa_serial" \
        --token-code "$token_code" \
        --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
        --output text 2>&1)

    if [ $? -ne 0 ]; then
        print_error "AWS 角色切換失敗"
        print_error "$credentials"
        exit 1
    fi

    # 設置環境變數
    export AWS_ACCESS_KEY_ID=$(echo "$credentials" | awk '{print $1}')
    export AWS_SECRET_ACCESS_KEY=$(echo "$credentials" | awk '{print $2}')
    export AWS_SESSION_TOKEN=$(echo "$credentials" | awk '{print $3}')
    export AWS_DEFAULT_REGION="$AWS_REGION"

    save_aws_defaults

    print_info "驗證新的身份..."
    local new_identity
    new_identity=$(aws sts get-caller-identity 2>&1)
    if [ $? -eq 0 ]; then
        print_info "AWS 登入成功"
        # echo "$new_identity"
    else
        print_error "AWS 身份驗證失敗"
        print_error "$new_identity"
        exit 1
    fi
}

# 開始互動式配置
clear
echo "=== 金鑰生成工具配置 ==="
echo "------------------------"

# 詢問是否需要 AWS 登入
NEED_AWS_LOGIN=false
if confirm "是否需要進行 AWS 登入？"; then
    NEED_AWS_LOGIN=true
fi

if [ "$NEED_AWS_LOGIN" = "true" ]; then
    aws configure

    # AWS 相關配置
    ACCOUNT_ID=""
    while true; do
        # 清除前一次的錯誤訊息
        if [ -n "$ACCOUNT_ID" ]; then
            echo "錯誤：AWS Account ID 必須是 12 位數字"
        fi

        # 讀取輸入
        read -s -p "請輸入 AWS Account ID: " ACCOUNT_ID
        echo  # 換行

        # 驗證輸入
        if [[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
            break
        fi
    done

    ASSUME_ROLE=$(read_input "請輸入 Role 名稱" "")
    AWS_REGION=$(read_input "請輸入 AWS Region" "")

    # 執行 AWS 登入
    aws_login
else
    print_info "跳過 AWS 登入流程，請手動輸入 AWS 配置參數..."
    AWS_REGION=$(read_input "請輸入 AWS Region" "eu-central-1")
fi

# KMS 和 Secret 配置（修改這部分）
KMS_KEY_ARN=$(read_input "請輸入 KMS_KEY_ARN" "" "true")
while [ -z "$KMS_KEY_ARN" ]; do
    warn "KMS_KEY_ARN 不能為空"
    KMS_KEY_ARN=$(read_input "請輸入 KMS_KEY_ARN" "" "true")
done

SECRET_ARN=$(read_input "請輸入 SECRET_ARN" "" "true")
while [ -z "$SECRET_ARN" ]; do
    warn "SECRET_ARN 不能為空"
    SECRET_ARN=$(read_input "請輸入 SECRET_ARN" "" "true")
done

# Bitwarden 配置
BITWARDEN_ENABLED=false
if confirm "是否需要使用 Bitwarden？"; then
    BITWARDEN_ENABLED=true

    BITWARDEN_COLLECTION_NAME=$(read_input "請輸入 BITWARDEN_COLLECTION_NAME" "")
    BITWARDEN_ITEM_NAME=$(read_input "請輸入 BITWARDEN_ITEM_NAME" "")
    BW_SERVER=$(read_input "請輸入 BW_SERVER" "")

    # Bitwarden 登入處理
    if ! bw login --check; then
        prompt "Bitwarden 未登入，正在進行登入操作..."
        bw logout || true
        bw config server $BW_SERVER
        bw login
        prompt "Bitwarden 登入成功。"
    else
        prompt "Bitwarden 已經登入。"
    fi

    # 解鎖 Bitwarden
    export BW_SESSION=$(bw unlock --raw)
    if [ $? -ne 0 ]; then
        warn "無法解鎖 Bitwarden vault。請檢查您的主密碼。"
        exit 1
    fi
    prompt "Bitwarden vault 已解鎖。會話已設置。"
fi

# 金鑰類型配置
echo -e "\n請選擇金鑰類型："
echo "1) private-key"
echo "2) mnemonic"
read -p "$(prompt "請輸入選項 (1/2): ")" key_type_choice

case "$key_type_choice" in
    1) KEY_TYPE="private-key" ;;
    2) KEY_TYPE="mnemonic" ;;
    *)
        warn "無效的選擇，預設使用 mnemonic"
        KEY_TYPE="mnemonic"
        ;;
esac

# 自定義 seed 配置
CUSTOM_SEED=""
if confirm "是否要使用自定義 seed？"; then
    CUSTOM_SEED=$(read_input "請輸入自定義 seed" "")
fi

# 助記詞長度配置
MNEMONIC_LENGTH="24"
if [ "$KEY_TYPE" = "mnemonic" ]; then
    read -p "$(prompt "請選擇助記詞長度 (12 或 24): ")" input_length
    MNEMONIC_LENGTH=$(validate_number "$input_length" "12 24" "24")
fi

# 顯示配置摘要
echo -e "\n=== 配置摘要 ==="
echo "AWS 配置:"
if [ "$NEED_AWS_LOGIN" = "true" ]; then
    echo "  AWS_LOGIN: 已執行"
    echo "  ASSUME_ROLE: $ASSUME_ROLE"
else
    echo "  AWS_LOGIN: 跳過"
fi
echo "  AWS_REGION: $AWS_REGION"
echo "  KMS_KEY_ARN: ${KMS_KEY_ARN:0:20}...${KMS_KEY_ARN: -20}"
echo "  SECRET_ARN: ${SECRET_ARN:0:20}...${SECRET_ARN: -20}"
echo "金鑰配置:"
echo "  BITWARDEN_ENABLED: $BITWARDEN_ENABLED"
echo "  KEY_TYPE: $KEY_TYPE"
if [ "$KEY_TYPE" = "mnemonic" ]; then
    echo "  MNEMONIC_LENGTH: $MNEMONIC_LENGTH"
fi
if [ -n "$CUSTOM_SEED" ]; then
    echo "  使用自定義 SEED: 是"
fi

# 確認執行
if ! confirm "是否確認執行？"; then
    echo "操作已取消"
    exit 0
fi

# 建構命令列參數
CMD="npx ts-node keyGenerate.ts"
CMD="$CMD --keyType $KEY_TYPE"
CMD="$CMD --kmsKeyArn $KMS_KEY_ARN"
CMD="$CMD --secretArn $SECRET_ARN"
CMD="$CMD --awsRegion $AWS_REGION"

if [ "$BITWARDEN_ENABLED" = "true" ]; then
    CMD="$CMD --bitwardenEnable"
    CMD="$CMD --bitwardenCollectionName \"$BITWARDEN_COLLECTION_NAME\""
    CMD="$CMD --bitwardenItemName \"$BITWARDEN_ITEM_NAME\""
    CMD="$CMD --bitwardenSession $BW_SESSION"
fi

if [ "$KEY_TYPE" = "mnemonic" ]; then
    CMD="$CMD --mnemonicLength $MNEMONIC_LENGTH"
fi

if [ -n "$CUSTOM_SEED" ]; then
    CMD="$CMD --customSeed \"$CUSTOM_SEED\""
fi

# 執行命令
eval $CMD
