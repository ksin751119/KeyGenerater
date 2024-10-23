import {
  SecretsManagerClient,
  CreateSecretCommand,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  KMSClient,
  EncryptCommand,
} from "@aws-sdk/client-kms";
import { Wallet, HDNodeWallet } from "ethers";
import crypto from "crypto";
import dotenv from "dotenv";
import { execSync } from "child_process";
import { encryptData } from "./CryptoExUtils";
import os from 'os';
import readline from 'readline';

dotenv.config();

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION });

function runCommand(command: string): string {
  return execSync(command, { encoding: 'utf-8' });
}

function getUserInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function listCollections(): void {
  console.log("Retrieving all collections...");
  const listCollectionsCommand = `bw list collections --session ${process.env.BW_SESSION}`;
  const collectionsOutput = runCommand(listCollectionsCommand);
  const collections = JSON.parse(collectionsOutput);

  if (collections.length === 0) {
    console.log("There are no collections in your vault.");
  } else {
    console.log("Collections in your vault:");
    collections.forEach((collection: any, index: number) => {
      console.log(`${index + 1}. ${collection.name} (ID: ${collection.id})`);
    });
  }
}

function getHardwareInfo(): string {
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  const cpus = os.cpus();
  const totalMemory = os.totalmem();

  return `${platform}-${release}-${arch}-${cpus[0].model}-${totalMemory}`;
}

async function generateSecrets(customSeed?: string): Promise<Buffer> {
  const hardwareInfo = getHardwareInfo();
  const timestamp = Date.now().toString();
  const randomData = crypto.randomBytes(32);

  let combinedData = Buffer.concat([
    Buffer.from(hardwareInfo),
    Buffer.from(timestamp),
    randomData
  ]);

  if (customSeed) {
    combinedData = Buffer.concat([combinedData, Buffer.from(customSeed)]);
  }

  return crypto.createHash('sha256').update(combinedData).digest();
}

async function generatePrivateKey(customSeed?: string): Promise<string> {
  const hardwareInfo = getHardwareInfo();
  const timestamp = Date.now().toString();
  const randomData = crypto.randomBytes(32);

  let combinedData = Buffer.concat([
    Buffer.from(hardwareInfo),
    Buffer.from(timestamp),
    randomData
  ]);

  if (customSeed) {
    combinedData = Buffer.concat([combinedData, Buffer.from(customSeed)]);
  }

  const seed = crypto.createHash('sha256').update(combinedData).digest();
  const hdNode = HDNodeWallet.fromSeed(seed);
  return hdNode.privateKey;
}

function encryptPrivateKey(privateKey: string, secrets: Buffer): string {
  const encryptedPrivateKey = encryptData(Buffer.from(privateKey), secrets);
  return encryptedPrivateKey.toString('base64');
}

async function encryptSecretsWithKMS(secrets: Buffer, kmsKeyArn: string): Promise<string> {
  const command = new EncryptCommand({
    KeyId: kmsKeyArn,
    Plaintext: secrets,
  });
  const response = await kmsClient.send(command);
  return Buffer.from(response.CiphertextBlob as Uint8Array).toString('base64');
}

async function saveToSecretsManager(data: any, secretArn: string) {
  const secretString = JSON.stringify(data);
  try {
    await secretsClient.send(
      new UpdateSecretCommand({
        SecretId: secretArn,
        SecretString: secretString,
      })
    );
    console.log("Successfully updated secret");
  } catch (error) {
    if ((error as any).name === 'ResourceNotFoundException') {
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretArn.split(':').pop(), // Extract secret name from ARN
          SecretString: secretString,
        })
      );
      console.log("Successfully created new secret");
    } else {
      throw error;
    }
  }
}

async function updateOrCreateBitwardenItem(wallet: Wallet, itemName: string, collectionName: string) {
  try {
    // Get collection ID
    console.log("Getting collection ID...");
    const getCollectionCommand = `bw list collections --search "${collectionName}" --session ${process.env.BW_SESSION}`;
    const collectionOutput = runCommand(getCollectionCommand);
    const collections = JSON.parse(collectionOutput);
    if (collections.length === 0) {
      throw new Error(`Collection "${collectionName}" not found`);
    }
    const collectionId = collections[0].id;

    // Read existing item
    console.log("Reading item...");
    const getItemCommand = `bw get item "${itemName}" --session ${process.env.BW_SESSION}`;
    let item;
    try {
      const itemJson = runCommand(getItemCommand);
      item = JSON.parse(itemJson);
    } catch (error) {
      console.log("Item does not exist, will create a new item");
    }

    const itemJson = runCommand(getItemCommand);
    let itemData = JSON.parse(itemJson);

    // Modify item
    itemData.fields = [
      {
        name: "address",
        value: wallet.address,
        type: 0
      },
      {
        name: "privateKey",
        value: wallet.privateKey,
        type: 1
      }
    ];



    let command;
    if (item) {
      const encodeCommand = `echo '${JSON.stringify(itemData)}' | bw encode`;
    const encodedItem = runCommand(encodeCommand);
    console.log("Updating test item...");
    const updateItemCommand = `bw edit item ${itemData.id} ${encodedItem} --session ${process.env.BW_SESSION}`;
    runCommand(updateItemCommand);


      console.log("Successfully updated wallet information in Bitwarden");
    } else {
      // Create new item
      const encodeCommand = `echo '${JSON.stringify(itemData)}' | bw encode`;
      const encodedItem = runCommand(encodeCommand);
      command = `bw create item ${encodedItem} --session ${process.env.BW_SESSION}`;
      runCommand(command);
      console.log("Successfully created new wallet item in Bitwarden");
    }
  } catch (error) {
    console.error("Failed to operate Bitwarden:", error);
    throw error;
  }
}

async function generateAndEncryptWallet() {
  log("開始生成和加密錢包");
  // 詢問使用者是否要輸入自定義種子
  const useCustomSeed = await getUserInput("Do you want to enter a custom seed? (y/n): ");
  let customSeed: string | undefined;

  if (useCustomSeed.toLowerCase() === 'y') {
    customSeed = await getUserInput("Enter your custom seed: ");
  }

  log("生成秘密和錢包");
  const secrets = await generateSecrets(customSeed);
  const wallet = new Wallet(await generatePrivateKey(customSeed));

  log("加密私鑰和秘密");
  const encryptedPrivateKey = encryptPrivateKey(wallet.privateKey, secrets);
  const kmsKeyArn = process.env.KMS_KEY_ARN!;
  const encryptedSecrets = await encryptSecretsWithKMS(secrets, kmsKeyArn);

  log("錢包生成和加密完成");
  return { wallet, kmsKeyArn, encryptedPrivateKey, encryptedSecrets };
}

async function saveToSecretsManagerAndBitwarden(wallet: Wallet, jsonData: any) {
  log("開始保存到 Secrets Manager 和 Bitwarden");

  // 保存到 Secrets Manager
  const secretArn = process.env.SECRET_ARN!;
  log("保存到 Secrets Manager");
  await saveToSecretsManager(jsonData, secretArn);

  // 檢查 BITWARDEN_ENABLED 環境變數
  if (process.env.BITWARDEN_ENABLED === 'true') {
    log("Bitwarden 已啟用，開始 Bitwarden 操作");
    const bitwardenCollectionName = await getBitwardenCollectionName();
    const bitwardenItemName = await getBitwardenItemName();
    log(`更新或創建 Bitwarden 項目: ${bitwardenItemName}`);
    await updateOrCreateBitwardenItem(wallet, bitwardenItemName, bitwardenCollectionName);
  } else {
    log("Bitwarden 未啟用，跳過 Bitwarden 操作");
  }

  log("保存操作完成");
}

async function getBitwardenCollectionName(): Promise<string> {
  listCollections();
  let bitwardenCollectionName = process.env.BITWARDEN_COLLECTION_NAME || '';
  const inputCollectionName = await getUserInput(`Enter Bitwarden collection name (press Enter to use default "${bitwardenCollectionName}"): `);
  return inputCollectionName || bitwardenCollectionName;
}

async function getBitwardenItemName(): Promise<string> {
  let bitwardenItemName = process.env.BITWARDEN_ITEM_NAME || '';
  const inputItemName = await getUserInput(`Enter Bitwarden item name (press Enter to use default "${bitwardenItemName}"): `);
  return inputItemName || bitwardenItemName;
}

// 添加一個簡單的日誌函數
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const main = async () => {
  log("開始主程序");

  try {
    log("檢查必要的環境變量");
    checkRequiredEnvVars();

    const { wallet, kmsKeyArn, encryptedPrivateKey, encryptedSecrets } = await generateAndEncryptWallet();

    log("準備 JSON 數據");
    const jsonData = { kmsArn: kmsKeyArn, encryptedPrivateKey, encryptedSecrets };

    log("開始保存數據");
    await saveToSecretsManagerAndBitwarden(wallet, jsonData);

    log("所有操作已成功完成");
  } catch (error) {
    console.error("發生錯誤:", error);
  }
};

function checkRequiredEnvVars() {
  const requiredEnvVars = ['KMS_KEY_ARN', 'SECRET_ARN'];

  // 只有在 BITWARDEN_ENABLED 為 true 時才檢查 Bitwarden 相關的環境變量
  if (process.env.BITWARDEN_ENABLED === 'true') {
    requiredEnvVars.push('BW_SESSION', 'BITWARDEN_COLLECTION_NAME', 'BITWARDEN_ITEM_NAME');
  }

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`${envVar} environment variable is not set`);
    }
  }
}

log("程序開始執行");
main().catch(console.error);
