import type * as Ast from '@unified-latex/unified-latex-types'

export interface ConversionWarning {
  message: string
  construct: string
}

export interface ConversionResult {
  typst: string
  warnings: ConversionWarning[]
  metadata: {
    title?: string
    author?: string
    date?: string
    documentclass?: string
    packages: string[]
  }
}

// Lazy-loaded parser
let parseLatex: ((src: string) => Ast.Root) | null = null

async function ensureParser() {
  if (!parseLatex) {
    const mod = await import('@unified-latex/unified-latex-util-parse')
    parseLatex = mod.parse
  }
  return parseLatex
}

export async function convertLatexToTypst(source: string): Promise<ConversionResult> {
  const parse = await ensureParser()
  const ast = parse(source)

  const warnings: ConversionWarning[] = []
  const metadata: ConversionResult['metadata'] = { packages: [] }

  const typst = emitRoot(ast, warnings, metadata)
  return { typst, warnings, metadata }
}

// ── Heading depth map ──

const SECTIONING: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
}

// ── Text-formatting macros ──

const TEXT_FORMAT: Record<string, { before: string; after: string }> = {
  textbf: { before: '*', after: '*' },
  textit: { before: '_', after: '_' },
  emph: { before: '_', after: '_' },
  texttt: { before: '`', after: '`' },
  textsc: { before: '#smallcaps[', after: ']' },
  textsf: { before: '#text(font: "sans-serif")[', after: ']' },
  textrm: { before: '', after: '' }, // passthrough
}

// ── Simple command → Typst mappings (no arguments) ──

const SIMPLE_COMMANDS: Record<string, string> = {
  tableofcontents: '#outline()',
  newpage: '#pagebreak()',
  clearpage: '#pagebreak()',
  cleardoublepage: '#pagebreak()',
  maketitle: '',
  noindent: '',
  bigskip: '#v(1em)',
  medskip: '#v(0.5em)',
  smallskip: '#v(0.25em)',
  hfill: '#h(1fr)',
  vfill: '#v(1fr)',
  centering: '',
  raggedright: '',
  raggedleft: '',
  ldots: '...',
  dots: '...',
  textendash: '--',
  textemdash: '---',
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  today: '#datetime.today().display()',
  appendix: '',
}

// ── Math command translations ──

const MATH_COMMANDS: Record<string, string> = {
  frac: 'frac',
  sqrt: 'sqrt',
  sum: 'sum',
  prod: 'product',
  int: 'integral',
  lim: 'lim',
  inf: 'inf',
  sup: 'sup',
  log: 'log',
  ln: 'ln',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  exp: 'exp',
  min: 'min',
  max: 'max',
  det: 'det',
  gcd: 'gcd',
  dim: 'dim',
  ker: 'ker',
  deg: 'deg',
  arg: 'arg',
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
  epsilon: 'epsilon',
  zeta: 'zeta',
  eta: 'eta',
  theta: 'theta',
  iota: 'iota',
  kappa: 'kappa',
  lambda: 'lambda',
  mu: 'mu',
  nu: 'nu',
  xi: 'xi',
  pi: 'pi',
  rho: 'rho',
  sigma: 'sigma',
  tau: 'tau',
  upsilon: 'upsilon',
  phi: 'phi',
  chi: 'chi',
  psi: 'psi',
  omega: 'omega',
  Gamma: 'Gamma',
  Delta: 'Delta',
  Theta: 'Theta',
  Lambda: 'Lambda',
  Xi: 'Xi',
  Pi: 'Pi',
  Sigma: 'Sigma',
  Phi: 'Phi',
  Psi: 'Psi',
  Omega: 'Omega',
  infty: 'infinity',
  partial: 'diff',
  nabla: 'nabla',
  forall: 'forall',
  exists: 'exists',
  neg: 'not',
  in: 'in',
  notin: 'in.not',
  subset: 'subset',
  supset: 'supset',
  cup: 'union',
  cap: 'sect',
  times: 'times',
  cdot: 'dot',
  cdots: 'dots.c',
  vdots: 'dots.v',
  ddots: 'dots.down',
  leq: '<=',
  geq: '>=',
  neq: '!=',
  approx: 'approx',
  equiv: 'equiv',
  pm: 'plus.minus',
  mp: 'minus.plus',
  to: 'arrow.r',
  rightarrow: 'arrow.r',
  leftarrow: 'arrow.l',
  Rightarrow: 'arrow.r.double',
  Leftarrow: 'arrow.l.double',
  leftrightarrow: 'arrow.l.r',
  Leftrightarrow: 'arrow.l.r.double',
  mapsto: 'arrow.r.bar',
  implies: 'implies',
  iff: 'iff',
  land: 'and',
  lor: 'or',
  langle: 'angle.l',
  rangle: 'angle.r',
  lceil: 'ceil.l',
  rceil: 'ceil.r',
  lfloor: 'floor.l',
  rfloor: 'floor.r',
  mathbb: 'bb',
  mathcal: 'cal',
  mathfrak: 'frak',
  mathrm: 'upright',
  mathbf: 'bold',
  mathit: 'italic',
  overline: 'overline',
  underline: 'underline',
  hat: 'hat',
  bar: 'macron',
  tilde: 'tilde',
  vec: 'arrow',
  dot: 'dot',
  ddot: 'dot.double',
}

// ── Helpers ──

/** Extract the environment name string (env can be a string or AST node) */
function getEnvName(env: Ast.Environment): string {
  // In some versions, env.env is an object like { type: "string", content: "..." }
  const e = env.env as unknown
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'content' in e) return String((e as { content: string }).content)
  return ''
}

// ── Emit functions ──

function emitRoot(
  root: Ast.Root,
  warnings: ConversionWarning[],
  metadata: ConversionResult['metadata'],
): string {
  // Scan for preamble info (before \begin{document})
  let hasDocumentEnv = false
  const preambleNodes: Ast.Node[] = []
  const bodyNodes: Ast.Node[] = []

  for (const node of root.content) {
    if (
      (node.type === 'environment' || node.type === 'mathenv') &&
      getEnvName(node as Ast.Environment) === 'document'
    ) {
      hasDocumentEnv = true
      // Process body content from the environment
      bodyNodes.push(...(node as Ast.Environment).content)
    } else if (!hasDocumentEnv) {
      preambleNodes.push(node)
    } else {
      // After document environment, anything left
      bodyNodes.push(node)
    }
  }

  // If no \begin{document}, treat everything as body
  if (!hasDocumentEnv) {
    bodyNodes.push(...preambleNodes.splice(0))
    bodyNodes.push(...root.content.filter((n) => !preambleNodes.includes(n)))
    // Reset since we moved everything
    preambleNodes.length = 0
    bodyNodes.length = 0
    for (const node of root.content) {
      bodyNodes.push(node)
    }
  }

  // Extract preamble metadata
  extractPreambleMetadata(preambleNodes, metadata)

  // Build output
  const parts: string[] = []

  // Emit metadata as Typst #set / #show rules
  if (metadata.title || metadata.author || metadata.date) {
    const setArgs: string[] = []
    if (metadata.title) setArgs.push(`  title: [${metadata.title}],`)
    if (metadata.author) setArgs.push(`  author: "${metadata.author}",`)
    if (metadata.date) setArgs.push(`  date: "${metadata.date}",`)
    parts.push(`#set document(\n${setArgs.join('\n')}\n)`)
    parts.push('')
  }

  const body = emitNodes(bodyNodes, warnings, false).trim()
  if (body) parts.push(body)

  return parts.join('\n') + '\n'
}

function extractPreambleMetadata(
  nodes: Ast.Node[],
  metadata: ConversionResult['metadata'],
) {
  for (const node of nodes) {
    if (node.type !== 'macro') continue
    const macro = node as Ast.Macro
    const args = getArgs(macro)

    switch (macro.content) {
      case 'documentclass': {
        const optArg = getOptionalArg(macro)
        const clsArg = args[0]
        metadata.documentclass = clsArg || optArg || undefined
        break
      }
      case 'usepackage': {
        const pkg = args[0]
        if (pkg) metadata.packages.push(pkg)
        break
      }
      case 'title':
        metadata.title = args[0]
        break
      case 'author':
        metadata.author = args[0]
        break
      case 'date':
        metadata.date = args[0]
        break
    }
  }
}

function emitNodes(
  nodes: Ast.Node[],
  warnings: ConversionWarning[],
  inMath: boolean,
): string {
  const parts: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    parts.push(emitNode(nodes[i], warnings, inMath))
  }
  return parts.join('')
}

function emitNode(
  node: Ast.Node,
  warnings: ConversionWarning[],
  inMath: boolean,
): string {
  switch (node.type) {
    case 'string':
      return (node as Ast.String).content

    case 'whitespace':
      return ' '

    case 'parbreak':
      return '\n\n'

    case 'comment': {
      const commentText = (node as Ast.Comment).content
      return `//${commentText.startsWith(' ') ? '' : ' '}${commentText}\n`
    }

    case 'macro':
      return emitMacro(node as Ast.Macro, warnings, inMath)

    case 'environment':
    case 'mathenv':
      return emitEnvironment(node as Ast.Environment, warnings)

    case 'inlinemath':
      return `$${emitNodes((node as Ast.InlineMath).content, warnings, true)}$`

    case 'displaymath':
      return `\n$ ${emitNodes((node as Ast.DisplayMath).content, warnings, true)} $\n`

    case 'group':
      return emitNodes((node as Ast.Group).content, warnings, inMath)

    case 'verbatim': {
      const verb = node as Ast.VerbatimEnvironment
      return `\`\`\`\n${verb.content}\n\`\`\`\n`
    }

    case 'verb':
      return `\`${(node as Ast.Verb).content}\``

    default:
      return ''
  }
}

function emitMacro(
  macro: Ast.Macro,
  warnings: ConversionWarning[],
  inMath: boolean,
): string {
  const name = macro.content
  const args = getArgs(macro)

  // Math mode handling
  if (inMath) {
    return emitMathMacro(macro, warnings)
  }

  // Sectioning commands
  if (name in SECTIONING) {
    const depth = SECTIONING[name]
    const heading = '='.repeat(depth || 1)
    const title = args[0] || ''
    return `\n${heading} ${title}\n`
  }

  // Text formatting
  if (name in TEXT_FORMAT) {
    const fmt = TEXT_FORMAT[name]
    const content = args[0] || ''
    return `${fmt.before}${content}${fmt.after}`
  }

  // Simple commands (no arguments)
  if (name in SIMPLE_COMMANDS) {
    return SIMPLE_COMMANDS[name]
  }

  // Special commands with arguments
  switch (name) {
    case 'underline':
      return `#underline[${args[0] || ''}]`

    case 'footnote':
      return `#footnote[${args[0] || ''}]`

    case 'href': {
      const url = args[0] || ''
      const text = args[1] || url
      return `#link("${url}")[${text}]`
    }

    case 'url':
      return `#link("${args[0] || ''}")`

    case 'includegraphics': {
      const file = args[0] || getOptionalArg(macro) || ''
      // Get the last mandatory arg (the file), since first may be options
      const mandatoryArgs = getMandatoryArgs(macro)
      const imgPath = mandatoryArgs[mandatoryArgs.length - 1] || file
      return `#image("${imgPath}")`
    }

    case 'caption':
      // Typically handled by figure environment, but standalone:
      return args[0] || ''

    case 'label':
      return `<${args[0] || ''}>`

    case 'ref':
    case 'eqref':
    case 'pageref':
      return `@${args[0] || ''}`

    case 'cite':
    case 'citep':
    case 'citet':
    case 'autocite':
      return `@${args[0] || ''}`

    case 'bibliography':
      return `#bibliography("${args[0] || ''}.bib")`

    case 'bibliographystyle':
      return '' // no typst equivalent

    case 'input':
    case 'include': {
      let file = args[0] || ''
      if (!file.endsWith('.typ')) {
        file = file.replace(/\.tex$/, '') + '.typ'
      }
      return `#include "${file}"`
    }

    case 'textcolor': {
      const color = args[0] || 'black'
      const text = args[1] || ''
      return `#text(fill: ${color})[${text}]`
    }

    case 'colorbox': {
      const color = args[0] || 'yellow'
      const text = args[1] || ''
      return `#highlight(fill: ${color})[${text}]`
    }

    // Spacing commands
    case 'hspace':
    case 'hspace*':
      return `#h(${args[0] || '1em'})`

    case 'vspace':
    case 'vspace*':
      return `#v(${args[0] || '1em'})`

    // Escaped characters
    case '&':
      return '&'
    case '%':
      return '%'
    case '$':
      return '\\$'
    case '#':
      return '\\#'
    case '_':
      return '\\_'
    case '{':
      return '{'
    case '}':
      return '}'
    case '~':
      return '~'
    case '\\':
      return '\n'
    case ',':
      return inMath ? ' ' : '\u2009' // thin space
    case ';':
      return inMath ? ' ' : ' '
    case '!':
      return '' // negative thin space, ignore
    case ' ':
      return ' '
    case 'item': {
      // \item inside list environments - handled by environment emitter mostly
      // but in case it appears standalone
      const content = args[0]
      return content ? `- ${content}\n` : '- '
    }

    default:
      break
  }

  // Unknown macro - emit as comment with warning
  const argStr = args.length > 0 ? `{${args.join('}{')}}` : ''
  warnings.push({
    message: `Unsupported command: \\${name}`,
    construct: `\\${name}${argStr}`,
  })
  return `/* [LaTeX] Unsupported: \\${name}${argStr} */`
}

function emitMathMacro(
  macro: Ast.Macro,
  warnings: ConversionWarning[],
): string {
  const name = macro.content

  // Check math command map
  if (name in MATH_COMMANDS) {
    const typstCmd = MATH_COMMANDS[name]
    const args = getMandatoryArgNodes(macro)

    // Commands that take arguments as function calls
    if (args.length > 0 && ['frac', 'sqrt', 'bb', 'cal', 'frak', 'upright', 'bold', 'italic',
      'overline', 'underline', 'hat', 'macron', 'tilde', 'arrow', 'dot', 'dot.double'].includes(typstCmd)) {
      const emittedArgs = args.map((a) => emitNodes(a, warnings, true))
      return `${typstCmd}(${emittedArgs.join(', ')})`
    }

    // Simple symbol replacement
    return typstCmd
  }

  // Text inside math
  if (name === 'text' || name === 'textrm' || name === 'mathrm') {
    const args = getArgs(macro)
    return `"${args[0] || ''}"`
  }

  // Escaped special chars in math
  if (['&', '%', '$', '#', '_', '{', '}', ' ', ',', ';', '!', '\\'].includes(name)) {
    return emitMacro(macro, warnings, true)
  }

  // Subscript/superscript handled by parser as _ and ^
  if (name === '_' || name === '^') {
    const args = getMandatoryArgNodes(macro)
    const sub = args.length > 0 ? emitNodes(args[0], warnings, true) : ''
    return `${name}(${sub})`
  }

  // left/right delimiters
  if (name === 'left' || name === 'right') {
    return '' // delimiters pass through
  }

  // Unknown math command
  const args = getArgs(macro)
  if (args.length > 0) {
    warnings.push({
      message: `Unsupported math command: \\${name}`,
      construct: `\\${name}{${args.join('}{')}}`,
    })
  }
  return name
}

function emitEnvironment(
  env: Ast.Environment,
  warnings: ConversionWarning[],
): string {
  const envName = getEnvName(env)
  switch (envName) {
    case 'itemize':
      return emitList(env, warnings, '-')

    case 'enumerate':
      return emitList(env, warnings, '+')

    case 'description':
      return emitDescriptionList(env, warnings)

    case 'tabular':
    case 'tabular*':
    case 'array':
      return emitTable(env, warnings)

    case 'figure':
    case 'figure*':
      return emitFigure(env, warnings)

    case 'table':
    case 'table*':
      return emitTableEnv(env, warnings)

    case 'equation':
    case 'equation*':
    case 'align':
    case 'align*':
    case 'gather':
    case 'gather*':
    case 'multline':
    case 'multline*':
      return `\n$ ${emitNodes(env.content, warnings, true)} $\n`

    case 'center':
      return `#align(center)[\n${emitNodes(env.content, warnings, false).trim()}\n]\n`

    case 'flushleft':
      return `#align(left)[\n${emitNodes(env.content, warnings, false).trim()}\n]\n`

    case 'flushright':
      return `#align(right)[\n${emitNodes(env.content, warnings, false).trim()}\n]\n`

    case 'quote':
    case 'quotation':
      return `#quote(block: true)[\n${emitNodes(env.content, warnings, false).trim()}\n]\n`

    case 'verbatim':
    case 'lstlisting':
    case 'minted':
      return `\`\`\`\n${emitNodes(env.content, warnings, false)}\n\`\`\`\n`

    case 'abstract':
      return `// Abstract\n${emitNodes(env.content, warnings, false).trim()}\n`

    case 'thebibliography':
      return emitBibliography(env, warnings)

    case 'minipage':
      return emitNodes(env.content, warnings, false)

    case 'tikzpicture':
    case 'pgfpicture': {
      warnings.push({
        message: `TikZ/PGF not supported: ${envName}`,
        construct: `\\begin{${envName}}...\\end{${envName}}`,
      })
      return `/* [LaTeX] TikZ/PGF environment "${envName}" not supported */\n`
    }

    default: {
      // Unknown environment
      warnings.push({
        message: `Unknown environment: ${envName}`,
        construct: `\\begin{${envName}}...\\end{${envName}}`,
      })
      return emitNodes(env.content, warnings, false)
    }
  }
}

// ── List emitters ──

function emitList(
  env: Ast.Environment,
  warnings: ConversionWarning[],
  marker: string,
): string {
  const items = collectItems(env.content, warnings)
  const lines = items.map((item) => `${marker} ${item.trim()}`)
  return '\n' + lines.join('\n') + '\n'
}

function emitDescriptionList(
  env: Ast.Environment,
  warnings: ConversionWarning[],
): string {
  const parts: string[] = []
  let currentLabel = ''

  for (const node of env.content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === 'item') {
      if (currentLabel) {
        parts.push('') // just in case
      }
      const optArg = getOptionalArg(node as Ast.Macro)
      currentLabel = optArg || ''
      parts.push(`/ ${currentLabel}: `)
    } else if (node.type === 'parbreak' || node.type === 'whitespace') {
      // skip
    } else {
      const text = emitNode(node, warnings, false)
      if (parts.length > 0) {
        parts[parts.length - 1] += text
      }
    }
  }

  return '\n' + parts.filter(Boolean).join('\n') + '\n'
}

function collectItems(
  content: Ast.Node[],
  warnings: ConversionWarning[],
): string[] {
  const items: string[] = []
  let current = ''

  for (const node of content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === 'item') {
      if (current.trim()) items.push(current)
      // Extract item body from absorbed args (empty open/close marks)
      const macro = node as Ast.Macro
      const bodyArg = macro.args?.find((a) => a.openMark === '' && a.closeMark === '' && a.content.length > 0)
      current = bodyArg ? emitNodes(bodyArg.content, warnings, false) : ''
    } else {
      current += emitNode(node, warnings, false)
    }
  }

  if (current.trim()) items.push(current)
  return items
}

// ── Table emitter ──

function emitTable(
  env: Ast.Environment,
  warnings: ConversionWarning[],
): string {
  // Parse column spec from args
  const colSpec = getOptionalOrMandatoryArg(env)
  const numCols = colSpec ? colSpec.replace(/[^lcr|p]/gi, '').length || 3 : 3

  // Parse rows by splitting on \\
  const rows = splitTableRows(env.content, warnings)
  const cells = rows.map((row) =>
    row
      .split('&')
      .map((c) => `[${c.trim()}]`)
      .join(', ')
  )

  const cellLines = cells.filter(Boolean).map((c) => `  ${c},`).join('\n')
  return `\n#table(\n  columns: ${numCols},\n${cellLines}\n)\n`
}

function splitTableRows(
  content: Ast.Node[],
  warnings: ConversionWarning[],
): string[] {
  const rows: string[] = []
  let current = ''

  for (const node of content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === '\\') {
      rows.push(current)
      current = ''
    } else if (node.type === 'macro' && (node as Ast.Macro).content === 'hline') {
      // skip horizontal rules
    } else if (node.type === 'macro' && (node as Ast.Macro).content === 'toprule') {
      // skip booktabs
    } else if (node.type === 'macro' && (node as Ast.Macro).content === 'midrule') {
      // skip booktabs
    } else if (node.type === 'macro' && (node as Ast.Macro).content === 'bottomrule') {
      // skip booktabs
    } else {
      current += emitNode(node, warnings, false)
    }
  }

  if (current.trim()) rows.push(current)
  return rows
}

// ── Figure emitter ──

function emitFigure(
  env: Ast.Environment,
  warnings: ConversionWarning[],
): string {
  let imagePath = ''
  let caption = ''
  let label = ''
  const otherContent: string[] = []

  for (const node of env.content) {
    if (node.type === 'macro') {
      const macro = node as Ast.Macro
      if (macro.content === 'includegraphics') {
        const mandatoryArgs = getMandatoryArgs(macro)
        imagePath = mandatoryArgs[mandatoryArgs.length - 1] || ''
      } else if (macro.content === 'caption') {
        caption = getArgs(macro)[0] || ''
      } else if (macro.content === 'label') {
        label = getArgs(macro)[0] || ''
      } else if (macro.content === 'centering' || macro.content === '\\') {
        // skip
      } else {
        otherContent.push(emitNode(node, warnings, false))
      }
    } else if (node.type !== 'whitespace' && node.type !== 'parbreak') {
      otherContent.push(emitNode(node, warnings, false))
    }
  }

  const parts: string[] = []
  parts.push('#figure(')
  if (imagePath) {
    parts.push(`  image("${imagePath}"),`)
  }
  if (caption) {
    parts.push(`  caption: [${caption}],`)
  }
  parts.push(')')
  if (label) {
    parts.push(` <${label}>`)
  }

  return '\n' + parts.join('\n') + '\n'
}

// ── Table environment (wraps tabular in figure) ──

function emitTableEnv(
  env: Ast.Environment,
  warnings: ConversionWarning[],
): string {
  let tableContent = ''
  let caption = ''
  let label = ''

  for (const node of env.content) {
    if (node.type === 'macro') {
      const macro = node as Ast.Macro
      if (macro.content === 'caption') {
        caption = getArgs(macro)[0] || ''
      } else if (macro.content === 'label') {
        label = getArgs(macro)[0] || ''
      } else if (macro.content === 'centering') {
        // skip
      } else {
        tableContent += emitNode(node, warnings, false)
      }
    } else if (node.type === 'environment' && ['tabular', 'tabular*', 'array'].includes((node as Ast.Environment).env)) {
      tableContent += emitTable(node as Ast.Environment, warnings)
    } else if (node.type !== 'whitespace' && node.type !== 'parbreak') {
      tableContent += emitNode(node, warnings, false)
    }
  }

  if (caption || label) {
    const parts: string[] = []
    parts.push('#figure(')
    parts.push(`  ${tableContent.trim()},`)
    if (caption) {
      parts.push(`  caption: [${caption}],`)
    }
    parts.push(')')
    if (label) {
      parts.push(` <${label}>`)
    }
    return '\n' + parts.join('\n') + '\n'
  }

  return tableContent
}

// ── Bibliography emitter ──

function emitBibliography(
  env: Ast.Environment,
  warnings: ConversionWarning[],
): string {
  // \begin{thebibliography} contains \bibitems
  const items: string[] = []
  let currentKey = ''
  let currentText = ''

  for (const node of env.content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === 'bibitem') {
      if (currentKey) {
        items.push(`// [${currentKey}] ${currentText.trim()}`)
      }
      currentKey = getArgs(node as Ast.Macro)[0] || ''
      currentText = ''
    } else {
      currentText += emitNode(node, warnings, false)
    }
  }

  if (currentKey) {
    items.push(`// [${currentKey}] ${currentText.trim()}`)
  }

  warnings.push({
    message: 'Manual bibliography converted to comments. Consider using a .bib file with #bibliography().',
    construct: '\\begin{thebibliography}',
  })

  return '\n// Bibliography\n' + items.join('\n') + '\n'
}

// ── Argument extraction helpers ──

function getArgs(macro: Ast.Macro): string[] {
  if (!macro.args) return []
  return macro.args
    .filter((a) => a.openMark === '{' && a.closeMark === '}')
    .map((a) => emitArgContent(a.content))
}

function getMandatoryArgs(macro: Ast.Macro): string[] {
  return getArgs(macro)
}

function getMandatoryArgNodes(macro: Ast.Macro): Ast.Node[][] {
  if (!macro.args) return []
  return macro.args
    .filter((a) => a.openMark === '{' && a.closeMark === '}')
    .map((a) => a.content)
}

function getOptionalArg(macro: Ast.Macro): string | undefined {
  if (!macro.args) return undefined
  const opt = macro.args.find((a) => a.openMark === '[' && a.closeMark === ']')
  if (!opt) return undefined
  return emitArgContent(opt.content)
}

function getOptionalOrMandatoryArg(env: Ast.Environment): string | undefined {
  if (!env.args) return undefined
  for (const arg of env.args) {
    const content = emitArgContent(arg.content)
    if (content) return content
  }
  return undefined
}

function emitArgContent(content: Ast.Node[]): string {
  // Simple string extraction without full emission for argument content
  const parts: string[] = []
  for (const node of content) {
    if (node.type === 'string') {
      parts.push((node as Ast.String).content)
    } else if (node.type === 'whitespace') {
      parts.push(' ')
    } else if (node.type === 'macro') {
      const macro = node as Ast.Macro
      const args = getArgs(macro)
      if (macro.content in TEXT_FORMAT) {
        const fmt = TEXT_FORMAT[macro.content]
        parts.push(`${fmt.before}${args[0] || ''}${fmt.after}`)
      } else if (args.length > 0) {
        parts.push(args.join(''))
      } else {
        parts.push(macro.content)
      }
    } else if (node.type === 'group') {
      parts.push(emitArgContent((node as Ast.Group).content))
    } else if (node.type === 'inlinemath') {
      parts.push(`$${emitArgContent((node as Ast.InlineMath).content)}$`)
    }
  }
  return parts.join('')
}
