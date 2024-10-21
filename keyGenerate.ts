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

function generateSecrets(): Buffer {
  const hardwareInfo = getHardwareInfo();
  const timestamp = Date.now().toString();
  const randomData = crypto.randomBytes(32);

  const combinedData = Buffer.concat([
    Buffer.from(hardwareInfo),
    Buffer.from(timestamp),
    randomData
  ]);

  return crypto.createHash('sha256').update(combinedData).digest();
}

function generatePrivateKey(): string {
  const hardwareInfo = getHardwareInfo();
  const timestamp = Date.now().toString();
  const randomData = crypto.randomBytes(32);

  const combinedData = Buffer.concat([
    Buffer.from(hardwareInfo),
    Buffer.from(timestamp),
    randomData
  ]);


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

const main = async () => {
  try {
    // Check required environment variables
    const requiredEnvVars = ['BW_SESSION', 'KMS_KEY_ARN', 'SECRET_ARN', 'BITWARDEN_COLLECTION_NAME', 'BITWARDEN_ITEM_NAME'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`${envVar} environment variable is not set`);
      }
    }

    // List all collections
    listCollections();

    // Prompt user to input collection name or use default value
    let bitwardenCollectionName = process.env.BITWARDEN_COLLECTION_NAME || '';
    const inputCollectionName = await getUserInput(`Enter Bitwarden collection name (press Enter to use default "${bitwardenCollectionName}"): `);
    if (inputCollectionName) {
      bitwardenCollectionName = inputCollectionName;
    }

    if (!bitwardenCollectionName) {
      throw new Error("Bitwarden collection name not provided.");
    }

    // Prompt user to input item name or use default value
    let bitwardenItemName = process.env.BITWARDEN_ITEM_NAME || '';
    const inputItemName = await getUserInput(`Enter Bitwarden item name (press Enter to use default "${bitwardenItemName}"): `);
    if (inputItemName) {
      bitwardenItemName = inputItemName;
    }

    if (!bitwardenItemName) {
      throw new Error("Bitwarden item name not provided.");
    }

    // 1. Generate secrets
    const secrets = generateSecrets();
    // console.log("Generated secrets (hex):", secrets.toString('hex'));

    // 2. Generate wallet
    const wallet = new Wallet(generatePrivateKey());
    // console.log("Generated wallet address:", wallet.address);
    console.log("Generated wallet:", wallet.address);
    console.log("Generated wallet:", wallet.privateKey);

    // 3. Encrypt privateKey with secrets
    const encryptedPrivateKey = encryptPrivateKey(wallet.privateKey, secrets);
    console.log("Encrypted privateKey (base64):", encryptedPrivateKey);

    // 4. Encrypt secrets with KMS
    const kmsKeyArn = process.env.KMS_KEY_ARN!;
    const encryptedSecrets = await encryptSecretsWithKMS(secrets, kmsKeyArn);
    console.log("KMS encrypted secrets (base64):", encryptedSecrets);

    // 5. Prepare JSON data
    const jsonData = {
      kmsArn: kmsKeyArn,
      encryptedPrivateKey,
      encryptedSecrets,
    };

    // 6. Save JSON to Secrets Manager
    const secretArn = process.env.SECRET_ARN!;
    await saveToSecretsManager(jsonData, secretArn);

    // 7. Update or create Bitwarden item
    await updateOrCreateBitwardenItem(wallet, bitwardenItemName, bitwardenCollectionName);

    console.log("All operations completed successfully");
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

main().catch(console.error);
