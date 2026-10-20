import { Fragment, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react'

type Platform = 'mac' | 'win' | 'linux'
type ProjectStart = 'blank' | 'template' | 'latex'
type EditorMode = 'normal' | 'vim'
type ExportTarget = 'files' | 'pdf'

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  const pl = navigator.platform.toLowerCase()
  if (pl.startsWith('mac') || ua.includes('mac os')) return 'mac'
  if (pl.startsWith('linux') || ua.includes('linux')) return 'linux'
  return 'win'
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="relative">
      <div className={`guide-code-block pr-10 ${className ?? ''}`}>{children}</div>
      <button
        onClick={handleCopy}
        title="Copy"
        className="absolute top-2 right-2 inline-flex items-center justify-center size-6 border border-(color:--border-default) rounded-xs bg-(--bg-elevated) text-(--copy-fg) cursor-pointer transition-colors duration-100"
        style={{
          '--copy-fg': copied ? 'var(--status-success)' : 'var(--text-tertiary)',
        } as React.CSSProperties}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function ChoiceRow<T extends string>({
  prompt,
  choices,
  value,
  onChange,
}: {
  prompt: string
  choices: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="mb-5">
      <div className="fs-10 text-(--text-tertiary) tracking-(--ls) uppercase mb-2" style={{ '--ls': '0.08em' } as React.CSSProperties}>
        {prompt}
      </div>
      <div className="flex gap-1 flex-wrap">
        {choices.map((c) => {
          const active = value === c.value
          return (
            <button
              key={c.value}
              onClick={() => onChange(c.value)}
              className={`py-1 px-3 border border-(color:--ch-bc) rounded-xs bg-(--ch-bg) text-(--ch-fg) font-mono fs-11 tracking-(--ls) uppercase cursor-pointer ${active ? 'font-bold' : 'font-normal'}`}
              style={{
                '--ch-bc': active ? 'var(--accent)' : 'var(--border-default)',
                '--ch-bg': active ? 'var(--accent-muted)' : 'transparent',
                '--ch-fg': active ? 'var(--accent)' : 'var(--text-tertiary)',
                '--ls': '0.05em',
              } as React.CSSProperties}
            >
              {c.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Hierarchy diagram data ────────────────────────────────────────── */

type HierarchyLevel = 'file' | 'project' | 'workspace'

const hierarchyData: Record<HierarchyLevel, { label: string; description: string; detail: string }> = {
  file: {
    label: 'FILE',
    description: 'A single document, image, or asset stored in the browser.',
    detail: 'Files live inside IndexedDB in your browser. Supported types include .typ sources, images (.png, .jpg, .svg), bibliography files (.bib), and any other asset Typst can reference. You can upload files by clicking the upload button in the sidebar or by dragging them directly onto the file tree.',
  },
  project: {
    label: 'PROJECT',
    description: 'A collection of files that make up one document.',
    detail: 'A project groups all the files for a single Typst document. When you create a new project, it starts with a main.typ file. You can add more files — additional .typ sources, images, bibliographies — and they all live together. Each project is independent and self-contained within your browser\'s storage.',
  },
  workspace: {
    label: 'WORKSPACE',
    description: 'An optional tag for grouping projects on the home screen.',
    detail: 'Workspaces let you organize projects into groups on the home screen (e.g. "Thesis", "Course Notes", "Papers"). They are purely organizational — a project can belong to one workspace or none. Workspaces do not affect how files are stored.',
  },
}

function HierarchyDiagram() {
  const [active, setActive] = useState<HierarchyLevel | null>(null)

  const toggle = (level: HierarchyLevel) => setActive(active === level ? null : level)
  // The diagram levels are nested, so they cannot be native <button>s
  // (buttons cannot contain buttons). role="button" + key handling instead.
  const layerProps = (level: HierarchyLevel) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': active === level,
    'aria-label': `${hierarchyData[level].label}: ${hierarchyData[level].description}`,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); toggle(level) },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        toggle(level)
      }
    },
  })

  return (
    <div>
      {/* Interactive nested boxes */}
      <div
        className="border border-(color:--lv-bc) rounded-xs p-2.5 cursor-pointer transition-colors duration-150 bg-(--lv-bg)"
        style={{
          '--lv-bc': active === 'workspace' ? 'var(--accent)' : 'var(--border-default)',
          '--lv-bg': active === 'workspace' ? 'var(--accent-faint)' : 'transparent',
        } as React.CSSProperties}
        {...layerProps('workspace')}
      >
        <div className="flex items-center gap-1.5 mb-2.5">
          <ChevronRight
            size={10}
            className="text-(--chv-fg) rotate-(--rot) transition-transform duration-150"
            style={{
              '--chv-fg': active === 'workspace' ? 'var(--accent)' : 'var(--text-tertiary)',
              '--rot': active === 'workspace' ? '90deg' : 'none',
            } as React.CSSProperties}
          />
          <span
            className="fs-10 tracking-widest font-bold text-(--lbl-fg)"
            style={{ '--lbl-fg': active === 'workspace' ? 'var(--accent)' : 'var(--text-tertiary)' } as React.CSSProperties}
          >
            WORKSPACE
          </span>
          <span className="fs-10 text-(--text-tertiary) italic">optional grouping</span>
        </div>

        <div className="flex gap-2">
          {/* Project 1 */}
          <div
            className="flex-1 border border-(color:--lv-bc) rounded-xs p-2.5 cursor-pointer transition-colors duration-150 bg-(--lv-bg)"
            style={{
              '--lv-bc': active === 'project' ? 'var(--accent)' : 'var(--border-default)',
              '--lv-bg': active === 'project' ? 'var(--accent-faint)' : 'var(--bg-surface)',
            } as React.CSSProperties}
            {...layerProps('project')}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <ChevronRight
                size={10}
                className="text-(--chv-fg) rotate-(--rot) transition-transform duration-150"
                style={{
                  '--chv-fg': active === 'project' ? 'var(--accent)' : 'var(--text-tertiary)',
                  '--rot': active === 'project' ? '90deg' : 'none',
                } as React.CSSProperties}
              />
              <span
                className="fs-10 tracking-widest font-bold text-(--lbl-fg)"
                style={{ '--lbl-fg': active === 'project' ? 'var(--accent)' : 'var(--text-tertiary)' } as React.CSSProperties}
              >
                PROJECT
              </span>
              <span className="fs-10 text-(--text-tertiary)">My Thesis</span>
            </div>

            <div className="flex gap-1 flex-wrap">
              {['main.typ', 'chapter1.typ', 'refs.bib'].map((name) => (
                <div
                  key={name}
                  className="py-1 px-2 border border-(color:--chip-bc) rounded-xs fs-11 font-mono text-(--chip-fg) cursor-pointer transition-colors duration-150 bg-(--chip-bg)"
                  style={{
                    '--chip-bc': active === 'file' ? 'var(--accent)' : 'var(--border-subtle)',
                    '--chip-fg': active === 'file' ? 'var(--accent)' : 'var(--text-secondary)',
                    '--chip-bg': active === 'file' ? 'var(--accent-faint)' : 'transparent',
                  } as React.CSSProperties}
                  {...layerProps('file')}
                >
                  {name}
                </div>
              ))}
              <div
                className="py-1 px-2 border border-(color:--chip-bc) rounded-xs fs-11 font-mono text-(--chip-fg) cursor-pointer transition-colors duration-150 bg-(--chip-bg)"
                style={{
                  '--chip-bc': active === 'file' ? 'var(--accent)' : 'var(--border-subtle)',
                  '--chip-fg': active === 'file' ? 'var(--accent)' : 'var(--text-tertiary)',
                  '--chip-bg': active === 'file' ? 'var(--accent-faint)' : 'transparent',
                } as React.CSSProperties}
                {...layerProps('file')}
              >
                images/fig.png
              </div>
            </div>
          </div>

          {/* Project 2 (smaller) */}
          <div
            className="flex-none min-w-30 border border-(color:--lv-bc) rounded-xs p-2.5 cursor-pointer transition-colors duration-150 bg-(--lv-bg)"
            style={{
              '--lv-bc': active === 'project' ? 'var(--accent)' : 'var(--border-default)',
              '--lv-bg': active === 'project' ? 'var(--accent-faint)' : 'var(--bg-surface)',
            } as React.CSSProperties}
            {...layerProps('project')}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="fs-10 tracking-widest font-bold text-(--lbl-fg)"
                style={{ '--lbl-fg': active === 'project' ? 'var(--accent)' : 'var(--text-tertiary)' } as React.CSSProperties}
              >
                PROJECT
              </span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {['main.typ', 'cover.png'].map((name) => (
                <div
                  key={name}
                  className="py-1 px-2 border border-(color:--chip-bc) rounded-xs fs-11 font-mono text-(--chip-fg) cursor-pointer transition-colors duration-150 bg-(--chip-bg)"
                  style={{
                    '--chip-bc': active === 'file' ? 'var(--accent)' : 'var(--border-subtle)',
                    '--chip-fg': active === 'file' ? 'var(--accent)' : 'var(--text-secondary)',
                    '--chip-bg': active === 'file' ? 'var(--accent-faint)' : 'transparent',
                  } as React.CSSProperties}
                  {...layerProps('file')}
                >
                  {name}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Instruction hint */}
      <div className="fs-10 text-(--text-tertiary) tracking-(--ls) uppercase mt-2 text-center" style={{ '--ls': '0.06em' } as React.CSSProperties}>
        Click any level to learn more
      </div>

      {/* Detail panel */}
      {active && (
        <div className="mt-3 py-3.5 px-4 bg-(--bg-inset) border border-(color:--accent) border-l-3 rounded-xs">
          <div className="fs-11 font-bold tracking-(--ls) text-(--accent) uppercase mb-1.5" style={{ '--ls': '0.08em' } as React.CSSProperties}>
            {hierarchyData[active].label}
          </div>
          <div className="fs-12 font-semibold text-(--text-primary) mb-2">
            {hierarchyData[active].description}
          </div>
          <div className="fs-12 leading-(--lh) text-(--text-secondary)" style={{ '--lh': '1.7' } as React.CSSProperties}>
            {hierarchyData[active].detail}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Workflow diagram ──────────────────────────────────────────────── */

type WorkflowStep = 'home' | 'open' | 'edit' | 'preview' | 'export'

const workflowSteps: { id: WorkflowStep; label: string; description: string }[] = [
  {
    id: 'home',
    label: 'HOME',
    description: 'The home screen lists all your projects stored in the browser. Create a new project, import from a template, or convert a LaTeX document. Projects can be organized into workspaces for easier navigation.',
  },
  {
    id: 'open',
    label: 'OPEN',
    description: 'Opening a project loads its files from IndexedDB. The sidebar populates with the project\'s file tree and the main file opens in the editor automatically.',
  },
  {
    id: 'edit',
    label: 'EDIT',
    description: 'The editor is a full CodeMirror instance with Typst syntax highlighting. Edits are saved to IndexedDB automatically after a short pause, or immediately with Cmd/Ctrl+S. Multiple files can be open; click the sidebar to switch between them.',
  },
  {
    id: 'preview',
    label: 'PREVIEW',
    description: 'The right panel shows a live-compiled preview of your document. The Typst compiler runs in a web worker and recompiles after each edit. Errors appear in the status bar with line numbers. The preview and editor panels are resizable via a drag handle.',
  },
  {
    id: 'export',
    label: 'EXPORT',
    description: 'Download a compiled PDF via the download icon in the toolbar, or export all project files as a .zip via the folder-out icon. The zip can be re-imported later or shared with collaborators.',
  },
]

function WorkflowDiagram() {
  const [active, setActive] = useState<WorkflowStep | null>(null)
  const activeStep = active ? workflowSteps.find((s) => s.id === active) ?? null : null

  return (
    <div>
      {/* Horizontal flow */}
      <div className="flex items-center justify-center flex-wrap">
        {workflowSteps.map((step, i) => (
          <Fragment key={step.id}>
            <button
              onClick={() => setActive(active === step.id ? null : step.id)}
              className={`py-2 px-4 border border-(color:--st-bc) rounded-xs bg-(--st-bg) text-(--st-fg) font-mono fs-11 tracking-(--ls) uppercase cursor-pointer transition-all duration-150 whitespace-nowrap ${active === step.id ? 'font-bold' : 'font-normal'}`}
              style={{
                '--st-bc': active === step.id ? 'var(--accent)' : 'var(--border-default)',
                '--st-bg': active === step.id ? 'var(--accent-muted)' : 'var(--bg-surface)',
                '--st-fg': active === step.id ? 'var(--accent)' : 'var(--text-secondary)',
                '--ls': '0.08em',
              } as React.CSSProperties}
            >
              {step.label}
            </button>
            {i < workflowSteps.length - 1 && (
              <div className="px-1 text-(--text-tertiary) fs-12 shrink-0">
                <ChevronRight size={14} />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Hint */}
      <div className="fs-10 text-(--text-tertiary) tracking-(--ls) uppercase mt-2 text-center" style={{ '--ls': '0.06em' } as React.CSSProperties}>
        Click a step to see details
      </div>

      {/* Detail panel */}
      {activeStep && (
        <div className="mt-3 py-3.5 px-4 bg-(--bg-inset) border border-(color:--accent) border-l-3 rounded-xs">
          <div className="fs-11 font-bold tracking-(--ls) text-(--accent) uppercase mb-2" style={{ '--ls': '0.08em' } as React.CSSProperties}>
            {activeStep.label}
          </div>
          <div className="fs-12 leading-(--lh) text-(--text-secondary)" style={{ '--lh': '1.7' } as React.CSSProperties}>
            {activeStep.description}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main guide page ───────────────────────────────────────────────── */

export function GuidePage({ onBack }: { onBack: () => void }) {
  const [platform, setPlatform] = useState<Platform>(detectPlatform)
  const [projectStart, setProjectStart] = useState<ProjectStart>('blank')
  const [editorMode, setEditorMode] = useState<EditorMode>('normal')
  const [exportTarget, setExportTarget] = useState<ExportTarget>('files')

  const mod = platform === 'mac' ? '⌘' : 'Ctrl'

  return (
    <div className="bg-(--bg-app) w-full h-full overflow-auto font-mono">
      <div className="max-w-180 mx-auto px-6 py-12">
        {/* Back button */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 border border-(color:--border-default) rounded-xs bg-(--bg-surface) text-(--text-secondary) font-mono fs-11 tracking-(--ls) uppercase cursor-pointer mb-8"
          style={{ '--ls': '0.06em' } as React.CSSProperties}
        >
          <ChevronLeft size={14} />
          BACK
        </button>

        {/* Header */}
        <h1
          className="fs-24 font-bold tracking-widest text-(--accent) uppercase m-0 leading-(--lh)"
          style={{ '--lh': '1.2' } as React.CSSProperties}
        >
          HOW TO USE TYPSMTHNG
        </h1>
        <p
          className="fs-12 leading-(--lh) text-(--text-secondary) mt-2.5 mb-0"
          style={{ '--lh': '1.6' } as React.CSSProperties}
        >
          A browser-based Typst typesetting editor. Files are stored locally in your browser.
        </p>

        {/* Platform toggle */}
        <div className="flex gap-1 mt-5">
          {(['mac', 'win', 'linux'] as const).map((p) => {
            const active = platform === p
            return (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className="py-0.75 px-2.5 border border-(color:--pl-bc) rounded-xs bg-(--pl-bg) text-(--pl-fg) font-mono fs-10 tracking-(--ls) uppercase cursor-pointer"
                style={{
                  '--pl-bc': active ? 'var(--border-strong)' : 'var(--border-default)',
                  '--pl-bg': active ? 'var(--bg-elevated)' : 'transparent',
                  '--pl-fg': active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  '--ls': '0.06em',
                } as React.CSSProperties}
              >
                {p === 'mac' ? 'macOS' : p === 'win' ? 'Windows' : 'Linux'}
              </button>
            )
          })}
        </div>

        <div className="guide-divider" />

        {/* ── HOW IT ALL FITS TOGETHER ── */}
        <div className="guide-section-label">HOW IT ALL FITS TOGETHER</div>
        <p className="guide-paragraph mb-4">
          typsmthng organizes your work into three levels. Click each layer in the diagram to learn what it is and how it works.
        </p>
        <HierarchyDiagram />

        <div className="guide-divider" />

        {/* ── YOUR WORKFLOW ── */}
        <div className="guide-section-label">YOUR WORKFLOW</div>
        <p className="guide-paragraph mb-4">
          The typical editing flow from start to finish. Click any step to see what happens.
        </p>
        <WorkflowDiagram />

        <div className="guide-divider" />

        {/* ── GETTING STARTED ── */}
        <div className="guide-section-label">GETTING STARTED</div>

        <ChoiceRow
          prompt="How are you starting your project?"
          choices={[
            { value: 'blank', label: 'Blank project' },
            { value: 'template', label: 'From a template' },
            { value: 'latex', label: 'Importing from LaTeX' },
          ]}
          value={projectStart}
          onChange={setProjectStart}
        />

        {projectStart === 'blank' && (
          <>
            <p className="guide-paragraph">
              Click <strong className="text-(--text-primary)">+ NEW PROJECT</strong> on the home screen. Type a name and press Enter. The project opens immediately in the editor.
            </p>
            <p className="guide-paragraph">
              The editor is split: source on the left, live preview on the right. The preview recompiles as you type after a short delay. Use the drag handle between the panels to resize them.
            </p>
            <p className="guide-paragraph mb-0">
              <span className="guide-kbd">{mod}+S</span> saves manually. Auto-save runs 2 seconds after you stop typing.
            </p>
          </>
        )}

        {projectStart === 'template' && (
          <>
            <p className="guide-paragraph">
              Click <strong className="text-(--text-primary)">Initiate from Templates</strong> on the home screen. Two sources are available:
            </p>
            <p className="guide-paragraph">
              <strong className="text-(--text-primary)">Built-in starters</strong> are offline templates for common formats (IEEE journal, conference, generic research paper). Click Import to create a project from one; it opens with a working document already inside.
            </p>
            <p className="guide-paragraph">
              <strong className="text-(--text-primary)">Typst Universe</strong> lets you search for community-published templates. Type at least 3 characters to search. Entries marked Template can be imported directly; click Import and a project is created from that template's scaffold. Entries marked Package Only are libraries, not starters — you'd add them to a project with <span className="guide-inline-code">#import "@preview/name:version": *</span>.
            </p>
            <p className="guide-paragraph">
              You can also paste an init command directly if you know the package spec:
            </p>
            <CodeBlock>typst init @preview/charged-ieee</CodeBlock>
            <p className="guide-paragraph mt-3 mb-0">
              After the project is created it opens in the editor. The preview updates as you edit.
            </p>
          </>
        )}

        {projectStart === 'latex' && (
          <>
            <p className="guide-paragraph">
              Click <strong className="text-(--text-primary)">Import from LaTeX</strong> on the home screen. Three options appear:
            </p>
            <ul className="mb-3 pl-4.5">
              {[
                <><strong className="text-(--text-primary)">.tex files</strong> — pick one or more .tex files from your machine.</>,
                <><strong className="text-(--text-primary)">.zip archive</strong> — a zip of your LaTeX project, including images and bibliography files.</>,
                <><strong className="text-(--text-primary)">Folder</strong> — select a whole directory; the browser uploads everything inside.</>,
              ].map((item, i) => (
                <li key={i} className="fs-12 leading-(--lh) text-(--text-secondary) mb-1" style={{ '--lh': '1.7' } as React.CSSProperties}>
                  {item}
                </li>
              ))}
            </ul>
            <p className="guide-paragraph">
              The converter handles most standard LaTeX: amsmath, graphicx, hyperref, common sectioning and list commands. Custom macros defined in .sty files and TikZ diagrams will not convert correctly — they'll appear as comments or placeholder blocks.
            </p>
            <p className="guide-paragraph mb-0">
              After import, check the result banner for warnings. It lists every construct that could not be converted. Open the project, find those spots, and fix them by hand. Treat the converted output as a starting draft, not a finished document.
            </p>
          </>
        )}

        <div className="guide-divider" />

        {/* ── THE EDITOR ── */}
        <div className="guide-section-label">THE EDITOR</div>

        <ChoiceRow
          prompt="Which editing style do you use?"
          choices={[
            { value: 'normal', label: 'Standard' },
            { value: 'vim', label: 'Vim' },
          ]}
          value={editorMode}
          onChange={setEditorMode}
        />

        {editorMode === 'normal' && (
          <>
            <p className="guide-paragraph">Keyboard shortcuts:</p>
            <div className="shortcut-grid">
              {[
                [`${mod}+S`, 'Save project'],
                [`${mod}+K`, 'Open command palette'],
                [`${mod}+/`, 'Toggle comment'],
                [`${mod}+D`, 'Duplicate line'],
              ].map(([shortcut, desc]) => (
                <Fragment key={shortcut}>
                  <span className="guide-kbd">{shortcut}</span>
                  <span className="fs-12 text-(--text-secondary)">{desc}</span>
                </Fragment>
              ))}
            </div>
            <p className="guide-paragraph mb-0">
              The command palette (<span className="guide-kbd">{mod}+K</span>) lists all actions. The sidebar shows project files; click to open, right-click for options (rename, delete). You can also drag files and folders directly onto the sidebar to upload them.
            </p>
          </>
        )}

        {editorMode === 'vim' && (
          <>
            <p className="guide-paragraph">
              Enable Vim mode in <strong className="text-(--text-primary)">Settings</strong> (gear icon in the toolbar) under the Vim Mode toggle. It's marked experimental. Once on, the editor starts in Normal mode on every load.
            </p>
            <div className="shortcut-grid">
              {[
                ['i', 'Enter Insert mode'],
                ['Esc', 'Return to Normal mode'],
                [':', 'Open command line'],
                [':w', 'Save (also triggers project save)'],
                [`${mod}+K`, 'Open command palette (works in any mode)'],
              ].map(([shortcut, desc]) => (
                <Fragment key={shortcut}>
                  <span className="guide-kbd">{shortcut}</span>
                  <span className="fs-12 text-(--text-secondary)">{desc}</span>
                </Fragment>
              ))}
            </div>
            <p className="guide-paragraph mb-0">
              Standard motions (hjkl, w, b, 0, $, gg, G, dd, yy, p) work as expected. Visual mode is supported. The status bar at the bottom shows the current Vim mode.
            </p>
          </>
        )}

        <div className="guide-divider" />

        {/* ── WRITING TYPST ── */}
        <div className="guide-section-label">WRITING TYPST</div>
        <p className="guide-paragraph">
          A minimal document:
        </p>
        <CodeBlock>{`#set page(margin: 2cm)
#set text(size: 11pt)

= My Heading

Regular paragraph text. *Bold*, _italic_, \`code\`.

== Subheading

- List item
- Another item

$ x^2 + y^2 = z^2 $`}</CodeBlock>
        <p className="guide-paragraph mt-3.5 mb-0">
          <span className="guide-inline-code">#set</span> rules configure document-wide defaults like margins and font size.{' '}
          <span className="guide-inline-code">#let</span> defines reusable functions and variables.{' '}
          <span className="guide-inline-code">#show</span> rules restyle elements across the whole document.
        </p>

        <div className="guide-divider" />

        {/* ── EXPORTING ── */}
        <div className="guide-section-label">EXPORTING</div>

        <ChoiceRow
          prompt="What are you trying to export?"
          choices={[
            { value: 'files', label: 'Project files' },
            { value: 'pdf', label: 'PDF' },
          ]}
          value={exportTarget}
          onChange={setExportTarget}
        />

        {exportTarget === 'files' && (
          <p className="guide-paragraph mb-0">
            Click the <strong className="text-(--text-primary)">folder-out icon</strong> in the toolbar. A <span className="guide-inline-code">.zip</span> of all project files downloads immediately. The archive includes every file in the project: .typ sources, images, bibliography files, anything you have added. To restore it, click the folder-in icon and select the zip — it imports as a new project.
          </p>
        )}

        {exportTarget === 'pdf' && (
          <p className="guide-paragraph mb-0">
            Click the <strong className="text-(--text-primary)">download icon</strong> in the toolbar. The document compiles to PDF and downloads as <span className="guide-inline-code">document.pdf</span> immediately. If the compile fails, the status bar at the bottom will show the error; fix it in the editor and try again.
          </p>
        )}

        <div className="guide-divider" />

        {/* ── STORAGE AND DATA ── */}
        <div className="guide-section-label">STORAGE AND DATA</div>
        <p className="guide-paragraph">
          All projects live in IndexedDB in the browser. Nothing is sent to any server.
        </p>
        <p className="guide-paragraph">
          Clearing browser data or using incognito mode will delete your projects. Export projects as .zip before clearing browser data.
        </p>

        <div className="guide-divider" />

        {/* ── FAQS ── */}
        <div className="guide-section-label">FAQS</div>

        <div>
          {[
            {
              q: 'Can I use this offline?',
              a: 'Yes. typsmthng is a PWA; after the first load it works without an internet connection. Typst Universe package searches require a connection.',
            },
            {
              q: 'Why does the preview show an error?',
              a: 'Usually a Typst syntax error. The status bar at the bottom shows the error message with the line and column where the problem occurred.',
            },
            {
              q: 'How do I add an image?',
              a: null,
              custom: (
                <>
                  <div className="fs-12 text-(--text-secondary) leading-(--lh) mb-2" style={{ '--lh': '1.6' } as React.CSSProperties}>
                    Upload an image file via the sidebar, then reference it:
                  </div>
                  <CodeBlock className="fs-12">{`#image("filename.png")`}</CodeBlock>
                </>
              ),
            },
            {
              q: 'Can I have multiple files in one project?',
              a: null,
              custom: (
                <div className="fs-12 text-(--text-secondary) leading-(--lh)" style={{ '--lh': '1.6' } as React.CSSProperties}>
                  Yes. Add files via the sidebar. Pull them into your main document with{' '}
                  <span className="guide-inline-code">{`#include "other-file.typ"`}</span>.
                </div>
              ),
            },
            {
              q: 'What is the difference between Template and Package Only in the marketplace?',
              a: null,
              custom: (
                <div className="fs-12 text-(--text-secondary) leading-(--lh)" style={{ '--lh': '1.6' } as React.CSSProperties}>
                  Templates include a starter document and can be imported directly as a new project. Package-only entries are libraries for use inside existing documents. Add them with{' '}
                  <span className="guide-inline-code">{`#import "@preview/name:version": *`}</span>.
                </div>
              ),
            },
            {
              q: 'My .tex import looks wrong.',
              a: 'LaTeX conversion is best-effort. Custom macros from .sty files and TikZ diagrams will not convert. Use the output as a starting point and fix the remaining issues manually.',
            },
            {
              q: 'Can I collaborate with others?',
              a: 'Not currently. Export the project as .zip, send it to a collaborator, and they can import it on their end.',
            },
            {
              q: 'Does typsmthng support packages that fetch data at compile time?',
              a: 'Yes. The engine fetches packages from Typst Universe automatically during compilation.',
            },
          ].map((faq, i, arr) => (
            <div
              key={i}
              className="border-b-(length:--faq-bw) border-b-(color:--border-default) pb-4 mb-(--faq-mb)"
              style={{
                '--faq-bw': i < arr.length - 1 ? '1px' : '0px',
                '--faq-mb': i < arr.length - 1 ? '16px' : '0px',
              } as React.CSSProperties}
            >
              <div className="fs-13 font-bold text-(--text-primary) mb-1.5">
                {faq.q}
              </div>
              {faq.a !== null && faq.a !== undefined ? (
                <div className="fs-12 text-(--text-secondary) leading-(--lh)" style={{ '--lh': '1.6' } as React.CSSProperties}>
                  {faq.a}
                </div>
              ) : (
                faq.custom
              )}
            </div>
          ))}
        </div>

        <div className="guide-divider" />

        {/* Footer */}
        <div
          className="fs-11 text-(--text-tertiary) tracking-(--ls) pb-6"
          style={{ '--ls': '0.04em' } as React.CSSProperties}
        >
          typsmthng stores all data locally in your browser.
        </div>
      </div>
    </div>
  )
}
