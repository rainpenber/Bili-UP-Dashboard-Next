/** 字幕 / JSON 导入默认上限（5 MiB） */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function assertFileSize(
  file: { size: number; name?: string },
  maxBytes = MAX_UPLOAD_BYTES,
): void {
  if (file.size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw new Error(`文件过大（上限 ${mb} MiB），请缩小后重试`);
  }
}
