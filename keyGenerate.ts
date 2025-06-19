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
import * as bip39 from 'bip39';
import { Command } from 'commander';

dotenv.config();

// 定義可用的金鑰類型
type KeyType = 'private-key' | 'mnemonic';

// 定義助記詞長度類型
type MnemonicLength = 12 | 24;

// 設定命令行選項
const program = new Command();
program
  .option('--keyType <type>', '指定金鑰類型 (private-key 或 mnemonic)', 'private-key')
  .option('--bitwardenEnable', '啟用 Bitwarden 整合', false)
  .option('--customSeed <seed>', '自定義種子')
  .option('--mnemonicLength <length>', '助記詞長度 (12 或 24)', '24')
  .requiredOption('--kmsKeyArn <arn>', 'AWS KMS Key ARN')
  .requiredOption('--secretArn <arn>', 'AWS Secrets Manager Secret ARN')
  .requiredOption('--awsRegion <region>', 'AWS Region')
  .option('--bitwardenSession <session>', 'Bitwarden Session Key')
  .option('--bitwardenCollectionName <name>', 'Bitwarden Collection Name')
  .option('--bitwardenItemName <name>', 'Bitwarden Item Name')
  .parse(process.argv);

const options = program.opts();

const secretsClient = new SecretsManagerClient({ region: options.awsRegion });
const kmsClient = new KMSClient({ region: options.awsRegion });

function runCommand(command: string): string {
  return execSync(command.replace('${process.env.BW_SESSION}', options.bitwardenSession), { encoding: 'utf-8' });
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

async function generateMnemonic(customSeed?: string): Promise<{ mnemonic: string; privateKey: string }> {
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

  // 根據選擇的助記詞長度決定熵的大小
  const mnemonicLength = parseInt(options.mnemonicLength) as MnemonicLength;
  const entropyBytes = mnemonicLength === 12 ? 16 : 32; // 12字=128位元(16字節), 24字=256位元(32字節)

  const entropy = crypto.createHash('sha256').update(combinedData).digest().subarray(0, entropyBytes);
  const mnemonic = bip39.entropyToMnemonic(entropy);
  const wallet = Wallet.fromPhrase(mnemonic);

  return {
    mnemonic,
    privateKey: wallet.privateKey
  };
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
    log("Successfully updated secret");
  } catch (error) {
    if ((error as any).name === 'ResourceNotFoundException') {
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretArn.split(':').pop(),
          SecretString: secretString,
        })
      );
      log("Successfully created new secret");
    } else {
      throw error;
    }
  }
}

async function updateOrCreateBitwardenItem(wallet: Wallet, itemName: string, collectionName: string) {
  try {
    log("Getting collection ID...");
    const getCollectionCommand = `bw list collections --search "${collectionName}" --session ${process.env.BW_SESSION}`;
    const collectionOutput = runCommand(getCollectionCommand);
    const collections = JSON.parse(collectionOutput);
    if (collections.length === 0) {
      throw new Error(`Collection "${collectionName}" not found`);
    }
    const collectionId = collections[0].id;

    log("Reading item...");
    const getItemCommand = `bw get item "${itemName}" --session ${process.env.BW_SESSION}`;
    let item;
    try {
      const itemJson = runCommand(getItemCommand);
      item = JSON.parse(itemJson);
    } catch (error) {
      log("Item does not exist, will create a new item");
    }

    const itemData = {
      organizationId: null,
      collectionIds: [collectionId],
      folderId: null,
      type: 1,
      name: itemName,
      notes: null,
      favorite: false,
      fields: [
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
      ],
      login: null,
      secureNote: null,
      card: null,
      identity: null
    };

    if (item) {
      const encodeCommand = `echo '${JSON.stringify(itemData)}' | bw encode`;
      const encodedItem = runCommand(encodeCommand);
      log("Updating item...");
      const updateItemCommand = `bw edit item ${item.id} ${encodedItem} --session ${process.env.BW_SESSION}`;
      runCommand(updateItemCommand);
      log("Successfully updated wallet information in Bitwarden");
    } else {
      const encodeCommand = `echo '${JSON.stringify(itemData)}' | bw encode`;
      const encodedItem = runCommand(encodeCommand);
      const createCommand = `bw create item ${encodedItem} --session ${process.env.BW_SESSION}`;
      runCommand(createCommand);
      log("Successfully created new wallet item in Bitwarden");
    }
  } catch (error) {
    console.error("Failed to operate Bitwarden:", error);
    throw error;
  }
}

async function generateAndEncryptWallet(keyType: KeyType, customSeed?: string) {
  log(`開始生成和加密錢包 (類型: ${keyType})`);

  log("生成秘密和錢包");
  const secrets = await generateSecrets(customSeed);
  let wallet: Wallet;
  let privateKey: string | undefined;

  if (keyType === 'mnemonic') {
    const mnemonicResult = await generateMnemonic(customSeed);
    wallet = new Wallet(mnemonicResult.privateKey);
    privateKey = mnemonicResult.mnemonic;
  } else {
    wallet = new Wallet(await generatePrivateKey(customSeed));
    privateKey = wallet.privateKey;
  }

  log("加密私鑰和秘密");
  const encryptedPrivateKey = encryptPrivateKey(privateKey, secrets);
  const kmsKeyArn = options.kmsKeyArn;
  const encryptedSecrets = await encryptSecretsWithKMS(secrets, kmsKeyArn);

  log("錢包生成和加密完成");
  return {
    wallet,
    kmsKeyArn,
    encryptedPrivateKey,
    encryptedSecrets,
  };
}

async function saveToSecretsManagerAndBitwarden(wallet: Wallet, jsonData: any) {
  log("開始保存到 Secrets Manager 和 Bitwarden");

  const secretArn = options.secretArn;
  log("保存到 Secrets Manager");
  await saveToSecretsManager(jsonData, secretArn);

  if (options.bitwardenEnable) {
    log("Bitwarden 已啟用，開始 Bitwarden 操作");
    const bitwardenCollectionName = options.bitwardenCollectionName;
    const bitwardenItemName = options.bitwardenItemName;
    log(`更新或創建 Bitwarden 項目: ${bitwardenItemName}`);
    await updateOrCreateBitwardenItem(wallet, bitwardenItemName, bitwardenCollectionName);
  } else {
    log("Bitwarden 未啟用，跳過 Bitwarden 操作");
  }

  log("保存操作完成");
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const main = async () => {
  log("開始主程序");

  try {
    const keyType = options.keyType as KeyType;
    if (!['private-key', 'mnemonic'].includes(keyType)) {
      throw new Error('無效的 keyType，必須是 private-key 或 mnemonic');
    }

    process.env.BITWARDEN_ENABLED = options.bitwardenEnable ? 'true' : 'false';

    log("檢查必要的環境變量");
    checkRequiredEnvVars();

    const result = await generateAndEncryptWallet(keyType, options.customSeed);

    log("準備 JSON 數據");
    const jsonData = {
      kmsArn: result.kmsKeyArn,
      encryptedPrivateKey: result.encryptedPrivateKey,
      encryptedSecrets: result.encryptedSecrets
    };

    log("開始保存數據");
    await saveToSecretsManagerAndBitwarden(result.wallet, jsonData);

    log("所有操作已成功完成");
    log(`生成的錢包地址: ${result.wallet.address}`);
  } catch (error) {
    console.error("發生錯誤:", error);
    process.exit(1);
  }
};

function checkRequiredEnvVars() {
  if (options.bitwardenEnable) {
    if (!options.bitwardenSession || !options.bitwardenCollectionName || !options.bitwardenItemName) {
      throw new Error('當啟用 Bitwarden 時，必須提供 bitwardenSession、bitwardenCollectionName 和 bitwardenItemName');
    }
  }
}

log("程序開始執行");
main().catch(console.error);
