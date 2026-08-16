/** Delay revoke so browsers that download asynchronously still have the blob. */
const OBJECT_URL_REVOKE_DELAY_MS = 10_000

/** Trigger a browser download of a blob via a temporary anchor element. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
}
