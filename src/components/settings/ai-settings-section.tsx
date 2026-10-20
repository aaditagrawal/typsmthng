import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAiStore, getAiConfig } from '@/stores/ai-store'
import type { AiProtocol } from '@/stores/ai-store'
import { testConnection } from '@/lib/ai/provider'

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-b-(color:--border-subtle) gap-3">
      <div className="flex-1 min-w-0">
        <div
          className="font-mono fs-12 text-(--text-primary) tracking-(--ls)"
          style={{ '--ls': '0.02em' }}
        >
          {label}
        </div>
        {description && (
          <div className="font-mono fs-11 text-(--text-tertiary) mt-0.5">
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

export function AiSettingsSection() {
  const {
    enabled, setEnabled,
    protocol, setProtocol,
    baseUrl, setBaseUrl,
    apiKey, setApiKey,
    model, setModel,
    maxTokens, setMaxTokens,
  } = useAiStore(useShallow((s) => ({
    enabled: s.enabled, setEnabled: s.setEnabled,
    protocol: s.protocol, setProtocol: s.setProtocol,
    baseUrl: s.baseUrl, setBaseUrl: s.setBaseUrl,
    apiKey: s.apiKey, setApiKey: s.setApiKey,
    model: s.model, setModel: s.setModel,
    maxTokens: s.maxTokens, setMaxTokens: s.setMaxTokens,
  })))

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const runTest = () => {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    void testConnection(getAiConfig())
      .then(setTestResult)
      .finally(() => setTesting(false))
  }

  return (
    <>
      <div
        className="font-mono fs-11 font-semibold text-(--text-tertiary) tracking-(--ls) uppercase mt-5 mb-1"
        style={{ '--ls': '0.08em' }}
      >
        AI Assist
      </div>

      <Row label="AI Editing" description="Inline edits with Cmd+I / Ctrl+I using your own model server">
        <button
          type="button"
          role="switch"
          aria-label="AI Editing"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          onKeyDown={(e) => {
            if (e.key === ' ') {
              e.preventDefault()
              setEnabled(!enabled)
            }
          }}
          className="relative w-9 h-5 rounded-xs border border-(color:--border-default) bg-(--tog-bg) cursor-pointer transition-colors duration-150 shrink-0 p-0"
          style={{ '--tog-bg': enabled ? 'var(--accent)' : 'var(--bg-inset)' }}
        >
          <span
            className="absolute top-0.5 left-(--knob-l) size-3.5 rounded-xs bg-(--accent-text) transition-all duration-150"
            style={{ '--knob-l': enabled ? '18px' : '2px' }}
          />
        </button>
      </Row>

      <Row label="Protocol" description="API dialect your server speaks">
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as AiProtocol)}
          className="ai-input cursor-pointer"
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic-compatible</option>
        </select>
      </Row>

      <Row label="Base URL">
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={protocol === 'anthropic' ? 'https://api.anthropic.com' : 'http://localhost:11434/v1'}
          autoComplete="off"
          spellCheck={false}
          className="ai-input"
        />
      </Row>

      <Row label="API Key">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          className="ai-input"
        />
      </Row>

      <Row label="Model">
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={protocol === 'anthropic' ? 'claude-opus-5' : 'llama3, gpt-4o, …'}
          autoComplete="off"
          spellCheck={false}
          className="ai-input"
        />
      </Row>

      <Row label="Max Tokens" description="Response cap; 0 sends no limit (OpenAI protocol only)">
        <input
          type="number"
          min={0}
          step={256}
          value={maxTokens}
          onChange={(e) => setMaxTokens(Number(e.target.value))}
          className="ai-input ai-input--narrow"
        />
      </Row>

      <div className="py-2.5 border-b border-b-(color:--border-subtle)">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="font-mono fs-11 tracking-(--ls) py-1 px-3 border border-(color:--border-default) rounded-xs bg-(--bg-inset) text-(--test-fg) cursor-(--cur)"
            style={{
              '--ls': '0.04em',
              '--test-fg': testing ? 'var(--text-disabled)' : 'var(--text-secondary)',
              '--cur': testing ? 'default' : 'pointer',
            }}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span
              className="font-mono fs-11 leading-(--lh) text-(--res-fg) wrap-break-word"
              style={{
                '--lh': '1.4',
                '--res-fg': testResult.ok ? 'var(--status-success)' : 'var(--status-error)',
              }}
            >
              {testResult.message}
            </span>
          )}
        </div>
        <div
          className="font-mono fs-11 text-(--text-tertiary) mt-2 leading-(--lh)"
          style={{ '--lh': '1.5' }}
        >
          Your key is stored locally in this browser and sent only to the server you configure above.
          The server must allow browser (CORS) requests: Anthropic&apos;s API supports direct browser access,
          and local gateways like Ollama, LM Studio, or LiteLLM work directly. OpenAI&apos;s official API may
          require a local proxy.
        </div>
      </div>
    </>
  )
}
