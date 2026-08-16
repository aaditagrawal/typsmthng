import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAiStore, getAiConfig } from '@/stores/ai-store'
import type { AiProtocol } from '@/stores/ai-store'
import { testConnection } from '@/lib/ai/provider'

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  letterSpacing: '0.02em',
  padding: '4px 8px',
  background: 'var(--bg-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: '2px',
  color: 'var(--text-primary)',
  outline: 'none',
  width: '190px',
  boxSizing: 'border-box',
}

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--border-subtle)',
        gap: '12px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              marginTop: '2px',
            }}
          >
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
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginTop: '20px',
          marginBottom: '4px',
        }}
      >
        AI Assist
      </div>

      <Row label="AI Editing" description="Inline edits with Cmd+I / Ctrl+I using your own model server">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          onKeyDown={(e) => {
            if (e.key === ' ') {
              e.preventDefault()
              setEnabled(!enabled)
            }
          }}
          style={{
            position: 'relative',
            width: '36px',
            height: '20px',
            borderRadius: '2px',
            border: '1px solid var(--border-default)',
            background: enabled ? 'var(--accent)' : 'var(--bg-inset)',
            cursor: 'pointer',
            transition: 'background 150ms ease',
            flexShrink: 0,
            padding: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '2px',
              left: enabled ? '18px' : '2px',
              width: '14px',
              height: '14px',
              borderRadius: '2px',
              background: '#fff',
              transition: 'left 150ms ease',
            }}
          />
        </button>
      </Row>

      <Row label="Protocol" description="API dialect your server speaks">
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as AiProtocol)}
          style={{ ...inputStyle, cursor: 'pointer' }}
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
          style={inputStyle}
        />
      </Row>

      <Row label="API Key">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          style={inputStyle}
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
          style={inputStyle}
        />
      </Row>

      <Row label="Max Tokens" description="Response cap; 0 sends no limit (OpenAI protocol only)">
        <input
          type="number"
          min={0}
          step={256}
          value={maxTokens}
          onChange={(e) => setMaxTokens(Number(e.target.value))}
          style={{ ...inputStyle, width: '90px' }}
        />
      </Row>

      <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              letterSpacing: '0.04em',
              padding: '4px 12px',
              border: '1px solid var(--border-default)',
              borderRadius: '2px',
              background: 'var(--bg-inset)',
              color: testing ? 'var(--text-disabled)' : 'var(--text-secondary)',
              cursor: testing ? 'default' : 'pointer',
            }}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: 1.4,
                color: testResult.ok ? 'var(--status-success)' : 'var(--status-error)',
                wordBreak: 'break-word',
              }}
            >
              {testResult.message}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            marginTop: '8px',
            lineHeight: 1.5,
          }}
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
