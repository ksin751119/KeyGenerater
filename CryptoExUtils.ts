import fs from "fs";
import crypto from "crypto";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);

async function checkFileExists(filePath: string): Promise<void> {
  try {
    await stat(filePath);
  } catch (err) {
    throw new Error(`File does not exist: ${filePath}`);
  }
}

function generateKey(key: Buffer, nonce: Buffer): Buffer {
  return crypto.pbkdf2Sync(key, nonce, 4096, 32, "sha1");
}

export function encryptData(plaintext: Buffer, key: Buffer): Buffer {
  const nonce = crypto.randomBytes(12);
  const dk = generateKey(key, nonce);
  const cipher = crypto.createCipheriv("aes-256-gcm", dk, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([encrypted, nonce]);
}

export function decryptData(ciphertext: Buffer, key: Buffer): Buffer {
  const nonce = ciphertext.subarray(-12);
  const dk = generateKey(key, nonce);
  const decipher = crypto.createDecipheriv("aes-256-gcm", dk, nonce);
  const authTag = ciphertext.subarray(-28, -12);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext.subarray(0, -28)), decipher.final()]);
}

export async function fileEncrypter(src: string, dst: string, key: Buffer): Promise<void> {
  await checkFileExists(src);
  const plaintext = await readFile(src);
  const ciphertext = encryptData(plaintext, key);
  await writeFile(dst, ciphertext);
}

export async function fileDecrypter(src: string, key: Buffer): Promise<Buffer> {
  await checkFileExists(src);
  const ciphertext = await readFile(src);
  return decryptData(ciphertext, key);
}
