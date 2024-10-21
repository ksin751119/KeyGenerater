# keyGenerate.ts 安裝指南

本指南將幫助您在全新的電腦上設置並運行 `keyGenerate.ts` 腳本。

## 前置需求

- Node.js
- yarn
- AWS CLI

## 安裝步驟

1. 安裝 yarn (如果尚未安裝):
   ```
   npm install -g yarn
   ```

2. 安裝 TypeScript:
   ```
   yarn global add typescript
   ```

3. 初始化專案:
   ```
   yarn init -y
   ```

4. 安裝專案依賴:
   ```
   yarn add @aws-sdk/client-secrets-manager @aws-sdk/client-kms ethers dotenv
   ```

5. 安裝 Bitwarden CLI:
   ```
   npm install -g @bitwarden/cli
   ```

6. 安裝 AWS CLI:
   根據您的操作系統,按照 [AWS CLI 安裝指南](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) 進行安裝。

## AWS 憑證設置

使用 AWS CLI 的 assume-role 功能來設置臨時憑證:

1. 確保您的 AWS CLI 已正確配置基本憑證。

2. 運行以下命令來獲取臨時憑證:
   ```
   aws sts assume-role --role-arn arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME --role-session-name SOME_SESSION_NAME
   ```

3. 將輸出的臨時憑證設置為環境變量:
   ```
   export AWS_ACCESS_KEY_ID=<臨時訪問密鑰>
   export AWS_SECRET_ACCESS_KEY=<臨時秘密訪問密鑰>
   export AWS_SESSION_TOKEN=<臨時會話令牌>
   ```

## 環境變量設置

確保設置以下環境變量:
- BW_SESSION
- AWS_REGION
- KMS_KEY_ARN
- SECRET_ARN
- BITWARDEN_COLLECTION_NAME
- BITWARDEN_ITEM_NAME
- BW_SERVER

這些可以在 `.env` 文件中設置,或直接在系統環境變量中設置。

## 運行腳本

1. 編譯 TypeScript:
   ```
   tsc keyGenerate.ts
   ```

2. 運行腳本:
   ```
   node keyGenerate.js
   ```

## 注意事項

- 確保 yarn 的全局 bin 目錄已添加到系統的 PATH 中。
- 在運行腳本之前,請確保已正確配置所有必要的 AWS 服務和權限,並已登錄到 Bitwarden CLI。
- 由於此腳本涉及敏感操作(如生成和加密私鑰),請確保在安全的環境中運行,並遵循所有相關的安全最佳實踐。
- 使用 assume-role 獲取的臨時憑證有效期通常為 1 小時。如果腳本運行時間較長,可能需要重新獲取臨時憑證。

## 可能需要的額外步驟

- 如果在專案中使用 TypeScript,可能需要安裝 TypeScript 的類型定義文件:
  ```
  yarn add -D @types/node
  ```
- 確保 `tsconfig.json` 文件正確配置,以便正確編譯 TypeScript 代碼。

如果在安裝或運行過程中遇到任何問題,請參考相關文檔或尋求進一步的技術支持。
