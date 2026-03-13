export interface PerfSample {
  name: string
  ms: number
  ts: number
  context?: Record<string, string | number>
}

const PERF_FLAG = 'perf_debug'

function isPerfDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PERF_FLAG) === '1'
  } catch {
    return false
  }
}

export function perfNow(): number {
  return performance.now()
}

export function perfMark(): number {
  return perfNow()
}

export function perfMeasure(
  name: string,
  start: number,
  context?: Record<string, string | number>,
): PerfSample {
  const sample = perfSample(name, perfNow() - start, context)
  return sample
}

export function perfSample(
  name: string,
  ms: number,
  context?: Record<string, string | number>,
): PerfSample {
  const sample: PerfSample = {
    name,
    ms: Math.max(0, ms),
    ts: Date.now(),
    context,
  }

  if (isPerfDebugEnabled()) {
    const ctx = context ? ` ${JSON.stringify(context)}` : ''
    console.info(`[perf] ${name}: ${sample.ms.toFixed(2)}ms${ctx}`)
  }

  return sample
}

export async function perfMeasureAsync<T>(
  name: string,
  run: () => Promise<T>,
  context?: Record<string, string | number>,
): Promise<{ result: T; sample: PerfSample }> {
  const start = perfMark()
  const result = await run()
  return {
    result,
    sample: perfMeasure(name, start, context),
  }
}
