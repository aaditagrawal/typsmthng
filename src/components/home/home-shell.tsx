import { useState } from 'react'
import { ProjectPicker } from '@/components/home/project-picker'
import { GuidePage } from '@/components/home/guide-page'

interface HomeShellProps {
  onPreloadWorkspace?: () => void
}

export default function HomeShell({ onPreloadWorkspace }: HomeShellProps) {
  const [showGuide, setShowGuide] = useState(false)

  if (showGuide) {
    return <GuidePage onBack={() => setShowGuide(false)} />
  }

  return (
    <ProjectPicker
      onShowGuide={() => setShowGuide(true)}
      onPreloadWorkspace={onPreloadWorkspace}
    />
  )
}
