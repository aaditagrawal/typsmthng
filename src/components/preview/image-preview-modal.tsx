import { useEffect, useState, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useProjectStore } from '@/stores/project-store'
import { useModalA11y } from '@/components/ui/context-menu'
import { basename } from '@/lib/paths'

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg':
    case 'jfif': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'avif': return 'image/avif'
    case 'heif':
    case 'heic': return 'image/heif'
    case 'bmp': return 'image/bmp'
    case 'tif':
    case 'tiff': return 'image/tiff'
    case 'ico': return 'image/x-icon'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

export function ImagePreviewModal() {
  const imagePreviewPath = useUIStore((s) => s.imagePreviewPath)
  const setImagePreviewPath = useUIStore((s) => s.setImagePreviewPath)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setImagePreviewPath(null), [setImagePreviewPath])

  useModalA11y(panelRef, Boolean(imagePreviewPath), close)

  // Create/cleanup blob URL for binary images
  useEffect(() => {
    let createdUrl: string | null = null

    if (!imagePreviewPath) {
      setBlobUrl(null)
    } else {
      const project = useProjectStore.getState().getCurrentProject()
      const file = project?.files.find((f) => f.path === imagePreviewPath)

      if (file?.isBinary && file.binaryData) {
        const mime = getMimeType(imagePreviewPath)
        const blob = new Blob([new Uint8Array(file.binaryData)], { type: mime })
        createdUrl = URL.createObjectURL(blob)
        setBlobUrl(createdUrl)
      } else {
        setBlobUrl(null)
      }
    }

    return () => {
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [imagePreviewPath])

  if (!imagePreviewPath) return null

  const project = useProjectStore.getState().getCurrentProject()
  const file = project?.files.find((f) => f.path === imagePreviewPath)
  if (!file) return null

  const filename = basename(imagePreviewPath) || imagePreviewPath
  const isSvg = /\.svg$/i.test(imagePreviewPath)

  let imgSrc: string | null = null
  if (isSvg && !file.isBinary && file.content) {
    imgSrc = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(file.content)))}`
  } else if (blobUrl) {
    imgSrc = blobUrl
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${filename}`}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={close}
    >
      {/* Header -- always light-on-dark: the backdrop is dark in both themes */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#fff',
          }}
        >
          {filename}
        </span>
        <button
          onClick={close}
          aria-label="Close image preview"
          style={{
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: '2px',
            background: 'transparent',
            color: 'rgba(255, 255, 255, 0.7)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#fff'
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Image */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={filename}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '80vw',
            maxHeight: '80vh',
            objectFit: 'contain',
            borderRadius: 0,
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'rgba(255, 255, 255, 0.7)',
            textTransform: 'uppercase',
          }}
        >
          UNABLE TO PREVIEW
        </div>
      )}
    </div>
  )
}
