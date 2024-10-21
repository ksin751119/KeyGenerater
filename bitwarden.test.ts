import { execSync } from 'child_process';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

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
  console.log("Fetching all collections...");
  const listCollectionsCommand = `bw list collections --session ${process.env.BW_SESSION}`;
  const collectionsOutput = runCommand(listCollectionsCommand);
  const collections = JSON.parse(collectionsOutput);

  if (collections.length === 0) {
    console.log("No collections found in your vault.");
  } else {
    console.log("Collections in your vault:");
    collections.forEach((collection: any, index: number) => {
      console.log(`${index + 1}. ${collection.name} (ID: ${collection.id})`);
    });
  }
}

async function testBitwarden() {
  try {
    console.log("Starting Bitwarden CLI test...");

    // Check BW_SESSION
    if (!process.env.BW_SESSION) {
      throw new Error("BW_SESSION environment variable is not set. Please run 'export BW_SESSION=$(bw unlock --raw)' and try again.");
    }

    // List all collections
    listCollections();

    // Prompt user for collection name or use default
    let testCollectionName = process.env.BITWARDEN_COLLECTION_NAME || '';
    const inputCollectionName = await getUserInput(`Enter Bitwarden collection name (press Enter to use default "${testCollectionName}"): `);
    if (inputCollectionName) {
      testCollectionName = inputCollectionName;
    }

    if (!testCollectionName) {
      throw new Error("No Bitwarden collection name provided.");
    }

    // Get collection ID
    console.log("Fetching collection ID...");
    const getCollectionCommand = `bw list collections --search "${testCollectionName}" --session ${process.env.BW_SESSION}`;
    const collectionOutput = runCommand(getCollectionCommand);
    const collections = JSON.parse(collectionOutput);
    if (collections.length === 0) {
      throw new Error(`Collection "${testCollectionName}" not found`);
    }
    const collectionId = collections[0].id;

    // Read test item
    let testItemName = process.env.BITWARDEN_ITEM_NAME || '';
    const escapedItemName = testItemName.replace(/"/g, '\\"');
    testItemName = `"${escapedItemName}"`;
    console.log("Reading test item...");
    const getItemCommand = `bw get item ${testItemName} --session ${process.env.BW_SESSION}`;
    runCommand(getItemCommand);

    // Update test item
    const privateKey = "test private key1";
    const walletAddress = "test wallet address1";

    const itemJson = runCommand(getItemCommand);
    const item = JSON.parse(itemJson);

    // Modify item
    item.fields = [
      {
        name: "address",
        value: walletAddress,
        type: 0
      },
      {
        name: "privateKey",
        value: privateKey,
        type: 1
      }
    ];

    const encodeCommand = `echo '${JSON.stringify(item)}' | bw encode`;
    const encodedItem = runCommand(encodeCommand);

    console.log("Updating test item...");
    const updateItemCommand = `bw edit item ${item.id} ${encodedItem} --session ${process.env.BW_SESSION}`;
    runCommand(updateItemCommand);

    console.log("Bitwarden CLI test completed successfully!");
  } catch (error) {
    console.error("An error occurred during the test:", error);
  }
}

testBitwarden();
