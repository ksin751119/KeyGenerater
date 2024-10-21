// 這是您的主要程式碼檔案
console.log('Hello, KeyGenerater!');

export function generateKey(length: number): string {
  // 這裡是生成金鑰的邏輯
  // 這只是一個簡單的示例，您可能需要根據實際需求修改
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
