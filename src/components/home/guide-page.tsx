import { Fragment, useState } from 'react'
import { ChevronLeft, Copy, Check } from 'lucide-react'

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

const paragraph: React.CSSProperties = {
  fontSize: '12px',
  lineHeight: 1.7,
  color: 'var(--text-secondary)',
  marginBottom: '12px',
}

const codeBlock: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: '2px',
  padding: '12px 14px',
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  lineHeight: 1.6,
  color: 'var(--text-primary)',
  whiteSpace: 'pre',
  overflowX: 'auto',
}

const divider: React.CSSProperties = {
  height: '1px',
  background: 'var(--border-default)',
  margin: '32px 0',
}

const kbd: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: '2px',
  padding: '2px 6px',
  fontSize: '11px',
  letterSpacing: '0.04em',
  fontFamily: 'var(--font-mono)',
}

const inlineCode: React.CSSProperties = {
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: '2px',
  padding: '1px 5px',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-primary)',
}

const sectionLabel: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--text-primary)',
  textTransform: 'uppercase',
  marginBottom: '16px',
}

function CodeBlock({ children, style }: { children: string; style?: React.CSSProperties }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ ...codeBlock, paddingRight: '40px', ...style }}>{children}</div>
      <button
        onClick={handleCopy}
        title="Copy"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          border: '1px solid var(--border-default)',
          borderRadius: '2px',
          background: 'var(--bg-elevated)',
          color: copied ? 'var(--status-success)' : 'var(--text-tertiary)',
          cursor: 'pointer',
          transition: 'color 100ms ease',
        }}
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
    <div style={{ marginBottom: '20px' }}>
      <div
        style={{
          fontSize: '10px',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}
      >
        {prompt}
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {choices.map((c) => {
          const active = value === c.value
          return (
            <button
              key={c.value}
              onClick={() => onChange(c.value)}
              style={{
                padding: '4px 12px',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
                borderRadius: '2px',
                background: active ? 'var(--accent-muted)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontWeight: active ? 700 : 400,
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function GuidePage({ onBack }: { onBack: () => void }) {
  const [platform, setPlatform] = useState<Platform>(detectPlatform)
  const [projectStart, setProjectStart] = useState<ProjectStart>('blank')
  const [editorMode, setEditorMode] = useState<EditorMode>('normal')
  const [exportTarget, setExportTarget] = useState<ExportTarget>('files')

  const mod = platform === 'mac' ? '⌘' : 'Ctrl'

  return (
    <div
      style={{
        background: 'var(--bg-app)',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '48px 24px',
        }}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            height: '28px',
            padding: '0 10px',
            border: '1px solid var(--border-default)',
            borderRadius: '2px',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            marginBottom: '32px',
          }}
        >
          <ChevronLeft size={14} />
          BACK
        </button>

        {/* Header */}
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--accent)',
            textTransform: 'uppercase',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          HOW TO USE TYPSMTHNG
        </h1>
        <p
          style={{
            fontSize: '12px',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            marginTop: '10px',
            marginBottom: 0,
          }}
        >
          A browser-based Typst typesetting editor. Files are stored locally in your browser.
        </p>

        {/* Platform toggle */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '20px' }}>
          {(['mac', 'win', 'linux'] as const).map((p) => {
            const active = platform === p
            return (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                style={{
                  padding: '3px 10px',
                  border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border-default)'}`,
                  borderRadius: '2px',
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {p === 'mac' ? 'macOS' : p === 'win' ? 'Windows' : 'Linux'}
              </button>
            )
          })}
        </div>

        <div style={divider} />

        {/* ── GETTING STARTED ── */}
        <div style={sectionLabel}>GETTING STARTED</div>

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
            <p style={paragraph}>
              Click <strong style={{ color: 'var(--text-primary)' }}>+ NEW PROJECT</strong> on the home screen. Type a name and press Enter. The project opens immediately in the editor.
            </p>
            <p style={paragraph}>
              The editor is split: source on the left, live preview on the right. The preview recompiles as you type after a short delay. Use the drag handle between the panels to resize them.
            </p>
            <p style={{ ...paragraph, marginBottom: 0 }}>
              <span style={kbd}>{mod}+S</span> saves manually. Auto-save runs 2 seconds after you stop typing.
            </p>
          </>
        )}

        {projectStart === 'template' && (
          <>
            <p style={paragraph}>
              Click <strong style={{ color: 'var(--text-primary)' }}>Initiate from Templates</strong> on the home screen. Two sources are available:
            </p>
            <p style={paragraph}>
              <strong style={{ color: 'var(--text-primary)' }}>Built-in starters</strong> are offline templates for common formats (IEEE journal, conference, generic research paper). Click Import to create a project from one; it opens with a working document already inside.
            </p>
            <p style={paragraph}>
              <strong style={{ color: 'var(--text-primary)' }}>Typst Universe</strong> lets you search for community-published templates. Type at least 3 characters to search. Entries marked Template can be imported directly; click Import and a project is created from that template's scaffold. Entries marked Package Only are libraries, not starters — you'd add them to a project with <span style={inlineCode}>#import "@preview/name:version": *</span>.
            </p>
            <p style={paragraph}>
              You can also paste an init command directly if you know the package spec:
            </p>
            <CodeBlock>typst init @preview/charged-ieee</CodeBlock>
            <p style={{ ...paragraph, marginTop: '12px', marginBottom: 0 }}>
              After the project is created it opens in the editor. The preview updates as you edit.
            </p>
          </>
        )}

        {projectStart === 'latex' && (
          <>
            <p style={paragraph}>
              Click <strong style={{ color: 'var(--text-primary)' }}>Import from LaTeX</strong> on the home screen. Three options appear:
            </p>
            <ul style={{ margin: '0 0 12px 0', paddingLeft: '18px' }}>
              {[
                <><strong style={{ color: 'var(--text-primary)' }}>.tex files</strong> — pick one or more .tex files from your machine.</>,
                <><strong style={{ color: 'var(--text-primary)' }}>.zip archive</strong> — a zip of your LaTeX project, including images and bibliography files.</>,
                <><strong style={{ color: 'var(--text-primary)' }}>Folder</strong> — select a whole directory; the browser uploads everything inside.</>,
              ].map((item, i) => (
                <li key={i} style={{ fontSize: '12px', lineHeight: 1.7, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {item}
                </li>
              ))}
            </ul>
            <p style={paragraph}>
              The converter handles most standard LaTeX: amsmath, graphicx, hyperref, common sectioning and list commands. Custom macros defined in .sty files and TikZ diagrams will not convert correctly — they'll appear as comments or placeholder blocks.
            </p>
            <p style={{ ...paragraph, marginBottom: 0 }}>
              After import, check the result banner for warnings. It lists every construct that could not be converted. Open the project, find those spots, and fix them by hand. Treat the converted output as a starting draft, not a finished document.
            </p>
          </>
        )}

        <div style={divider} />

        {/* ── THE EDITOR ── */}
        <div style={sectionLabel}>THE EDITOR</div>

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
            <p style={paragraph}>Keyboard shortcuts:</p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '8px 16px',
                marginBottom: '16px',
                alignItems: 'center',
              }}
            >
              {[
                [`${mod}+S`, 'Save project'],
                [`${mod}+K`, 'Open command palette'],
                [`${mod}+/`, 'Toggle comment'],
                [`${mod}+D`, 'Duplicate line'],
              ].map(([shortcut, desc]) => (
                <Fragment key={shortcut}>
                  <span style={kbd}>{shortcut}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{desc}</span>
                </Fragment>
              ))}
            </div>
            <p style={{ ...paragraph, marginBottom: 0 }}>
              The command palette (<span style={kbd}>{mod}+K</span>) lists all actions. The sidebar shows project files; click to open, right-click for options (rename, delete). You can also drag files and folders directly onto the sidebar to upload them.
            </p>
          </>
        )}

        {editorMode === 'vim' && (
          <>
            <p style={paragraph}>
              Enable Vim mode in <strong style={{ color: 'var(--text-primary)' }}>Settings</strong> (gear icon in the toolbar) under the Vim Mode toggle. It's marked experimental. Once on, the editor starts in Normal mode on every load.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '8px 16px',
                marginBottom: '16px',
                alignItems: 'center',
              }}
            >
              {[
                ['i', 'Enter Insert mode'],
                ['Esc', 'Return to Normal mode'],
                [':', 'Open command line'],
                [':w', 'Save (also triggers project save)'],
                [`${mod}+K`, 'Open command palette (works in any mode)'],
              ].map(([shortcut, desc]) => (
                <Fragment key={shortcut}>
                  <span style={kbd}>{shortcut}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{desc}</span>
                </Fragment>
              ))}
            </div>
            <p style={{ ...paragraph, marginBottom: 0 }}>
              Standard motions (hjkl, w, b, 0, $, gg, G, dd, yy, p) work as expected. Visual mode is supported. The status bar at the bottom shows the current Vim mode.
            </p>
          </>
        )}

        <div style={divider} />

        {/* ── WRITING TYPST ── */}
        <div style={sectionLabel}>WRITING TYPST</div>
        <p style={paragraph}>
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
        <p style={{ ...paragraph, marginTop: '14px', marginBottom: 0 }}>
          <span style={inlineCode}>#set</span> rules configure document-wide defaults like margins and font size.{' '}
          <span style={inlineCode}>#let</span> defines reusable functions and variables.{' '}
          <span style={inlineCode}>#show</span> rules restyle elements across the whole document.
        </p>

        <div style={divider} />

        {/* ── EXPORTING ── */}
        <div style={sectionLabel}>EXPORTING</div>

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
          <p style={{ ...paragraph, marginBottom: 0 }}>
            Click the <strong style={{ color: 'var(--text-primary)' }}>folder-out icon</strong> in the toolbar. A <span style={inlineCode}>.zip</span> of all project files downloads immediately. The archive includes every file in the project: .typ sources, images, bibliography files, anything you have added. To restore it, click the folder-in icon and select the zip — it imports as a new project.
          </p>
        )}

        {exportTarget === 'pdf' && (
          <p style={{ ...paragraph, marginBottom: 0 }}>
            Click the <strong style={{ color: 'var(--text-primary)' }}>download icon</strong> in the toolbar. The document compiles to PDF and downloads as <span style={inlineCode}>document.pdf</span> immediately. If the compile fails, the status bar at the bottom will show the error; fix it in the editor and try again.
          </p>
        )}

        <div style={divider} />

        {/* ── STORAGE AND DATA ── */}
        <div style={sectionLabel}>STORAGE AND DATA</div>
        <p style={paragraph}>
          All projects live in IndexedDB in the browser. Nothing is sent to any server.
        </p>
        <p style={paragraph}>
          Clearing browser data or using incognito mode will delete your projects. Export projects as .zip before clearing browser data.
        </p>

        <div style={divider} />

        {/* ── FAQS ── */}
        <div style={sectionLabel}>FAQS</div>

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
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '8px' }}>
                    Upload an image file via the sidebar, then reference it:
                  </div>
                  <CodeBlock style={{ fontSize: '12px' }}>{`#image("filename.png")`}</CodeBlock>
                </>
              ),
            },
            {
              q: 'Can I have multiple files in one project?',
              a: null,
              custom: (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Yes. Add files via the sidebar. Pull them into your main document with{' '}
                  <span style={inlineCode}>{`#include "other-file.typ"`}</span>.
                </div>
              ),
            },
            {
              q: 'What is the difference between Template and Package Only in the marketplace?',
              a: null,
              custom: (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Templates include a starter document and can be imported directly as a new project. Package-only entries are libraries for use inside existing documents. Add them with{' '}
                  <span style={inlineCode}>{`#import "@preview/name:version": *`}</span>.
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
              style={{
                borderBottom: i < arr.length - 1 ? '1px solid var(--border-default)' : 'none',
                paddingBottom: '16px',
                marginBottom: i < arr.length - 1 ? '16px' : 0,
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                {faq.q}
              </div>
              {faq.a !== null && faq.a !== undefined ? (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {faq.a}
                </div>
              ) : (
                faq.custom
              )}
            </div>
          ))}
        </div>

        <div style={divider} />

        {/* Footer */}
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
            paddingBottom: '24px',
          }}
        >
          typsmthng stores all data locally in your browser.
        </div>
      </div>
    </div>
  )
}
