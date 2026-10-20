export function validateAttachmentFile(file: File): { contentType: string; error: string } {
  const name = file.name,
    contentType = file.type || (/\.txt$/i.test(name) ? 'text/plain' : '')
  const validName =
    new TextEncoder().encode(name).length >= 1 &&
    new TextEncoder().encode(name).length <= 255 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !Array.from(name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  const compatible =
    (contentType === 'text/plain' && /\.txt$/i.test(name)) ||
    (contentType === 'image/png' && /\.png$/i.test(name)) ||
    (contentType === 'image/jpeg' && /\.jpe?g$/i.test(name))
  return {
    contentType,
    error: !validName
      ? 'Choose a filename of 1–255 UTF-8 bytes without paths or control characters.'
      : !compatible
        ? 'Choose a PNG, JPEG or TXT file.'
        : file.size < 1 || file.size > 10485760
          ? 'Files must contain 1–10485760 bytes.'
          : '',
  }
}
export async function hashAttachmentFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}
