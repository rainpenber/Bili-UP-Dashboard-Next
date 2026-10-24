import { writeFile } from 'node:fs/promises';

type QrCodeModule = {
  toString(text: string, options: { type: 'terminal'; small: boolean }): Promise<string>;
  toBuffer(text: string, options: { type: 'png'; width: number; margin: number }): Promise<Buffer>;
};

export async function renderLoginQr(url: string, pngPath: string): Promise<void> {
  const qr = (await import('qrcode')) as QrCodeModule;
  const terminal = await qr.toString(url, { type: 'terminal', small: true });
  const png = await qr.toBuffer(url, { type: 'png', width: 320, margin: 1 });
  await writeFile(pngPath, png);
  process.stdout.write(terminal);
  console.log(`二维码 PNG 已写入 ${pngPath}`);
}
