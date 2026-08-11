import { normalizeScanBase64 } from './imageDataUrl'
import { resolveDownloadUrl } from './b2-storage'

export async function createIdScanImageSignedUrl(
  storagePath: string,
  expiresSec = 3600,
): Promise<string> {
  return resolveDownloadUrl({
    category: 'id-images',
    objectPath: storagePath,
    expiresIn: expiresSec,
    supabaseFallbackBuckets: ['id-images', 'id-scans'],
  })
}

/** Download a stored ID image and return raw base64 (for repopulating the scanner form). */
export async function fetchStorageImageAsBase64(storagePath: string): Promise<string | null> {
  const path = storagePath?.trim()
  if (!path) return null
  const signedUrl = await createIdScanImageSignedUrl(path)
  const res = await fetch(signedUrl)
  if (!res.ok) return null
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = reader.result
      if (typeof raw !== 'string') {
        resolve(null)
        return
      }
      const normalized = normalizeScanBase64(raw)
      resolve(normalized || null)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}
