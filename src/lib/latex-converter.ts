import type * as Ast from '@unified-latex/unified-latex-types'
import { isLatexPath } from './file-classification'

export interface ConversionWarning {
  message: string
  construct: string
}

export interface ConversionOptions {
  resolvePath?: (path: string, kind: 'include' | 'image' | 'bibliography') => string
  hasManualBibliography?: boolean
}

interface ConversionContext {
  warnings: ConversionWarning[]
  options: ConversionOptions
  hasManualBibliography: boolean
  bibliographyFiles: string[]
  metadata: ConversionResult['metadata']
  formattedTitle?: string
  includeUncited: boolean
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
    const parser = mod.getParser({
      macros: {
        addbibresource: { signature: 'o m' },
        printbibliography: { signature: 'o' },
        autocite: { signature: 'o o m' },
        parencite: { signature: 'o o m' },
        textcite: { signature: 'o o m' },
        nocite: { signature: 'm' },
      },
    })
    parseLatex = (source) => parser.parse(source)
  }
  return parseLatex
}

export async function convertLatexToTypst(
  source: string,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const parse = await ensureParser()
  const ast = parse(source)

  const warnings: ConversionWarning[] = []
  const metadata: ConversionResult['metadata'] = { packages: [] }

  const context: ConversionContext = {
    warnings,
    options,
    hasManualBibliography: options.hasManualBibliography ?? containsEnvironment(ast.content, 'thebibliography'),
    bibliographyFiles: [],
    metadata,
    includeUncited: false,
  }
  collectBibliographyResources(ast.content, context)
  const typst = emitRoot(ast, context, metadata)
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

function escapeTypstString(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function escapeTypstText(value: string): string {
  return value.replace(/[\\#[\]<>*_`@$]/g, '\\$&')
}

function escapeComment(value: string): string {
  return value.replace(/\/\*/g, '/ *').replace(/\*\//g, '* /')
}

function containsEnvironment(nodes: Ast.Node[], name: string): boolean {
  return nodes.some((node) => {
    if (node.type === 'environment' || node.type === 'mathenv') {
      return getEnvName(node) === name || containsEnvironment(node.content, name)
    }
    return node.type === 'group' && containsEnvironment(node.content, name)
  })
}

function resolveBibliographyPath(raw: string, context: ConversionContext): string {
  // Preserve the explicit source extension and case while the project resolver
  // looks up the file and chooses a compiler-compatible .bib alias.
  const resolved = context.options.resolvePath?.(raw, 'bibliography')
  return resolved && resolved !== raw ? resolved : normalizeBibliographyPath(raw)
}

function collectBibliographyResources(nodes: Ast.Node[], context: ConversionContext): void {
  for (const node of nodes) {
    if (node.type === 'macro' && node.content === 'addbibresource') {
      const file = resolveBibliographyPath(getArgs(node)[0] || '', context)
      if (file && !context.bibliographyFiles.includes(file)) context.bibliographyFiles.push(file)
    } else if (node.type === 'macro' && node.content === 'nocite' && getArgs(node)[0]?.split(',').some((key) => key.trim() === '*')) {
      context.includeUncited = true
    } else if (node.type === 'environment' || node.type === 'mathenv' || node.type === 'group') {
      collectBibliographyResources(node.content, context)
    }
  }
}

function emitBibliographyCall(files: string[], context: ConversionContext): string {
  const full = context.includeUncited ? ', full: true' : ''
  if (files.length === 1) return `#bibliography("${escapeTypstString(files[0])}"${full})`
  if (files.length > 1) return `#bibliography((${files.map((file) => `"${escapeTypstString(file)}"`).join(', ')})${full})`
  return '// No bibliography resources were declared.'
}

function emitContentArgs(macro: Ast.Macro, context: ConversionContext): string[] {
  return getMandatoryArgNodes(macro).map((nodes) => emitNodes(nodes, context, false))
}

function plainText(nodes: Ast.Node[]): string {
  return nodes.map((node) => {
    if (node.type === 'string') return node.content
    if (node.type === 'whitespace' || node.type === 'parbreak') return ' '
    if (node.type === 'macro') {
      const args = getMandatoryArgNodes(node)
      return args.length ? args.map(plainText).join('') : node.content
    }
    if (node.type === 'group' || node.type === 'inlinemath' || node.type === 'displaymath') return plainText(node.content)
    return ''
  }).join('')
}

/** Strip known bib extensions, then ensure a single `.bib` suffix for Typst. */
function normalizeBibliographyPath(raw: string): string {
  if (!raw) return ''
  const withoutKnownExt = raw.replace(/\.(bibtex|bib)$/i, '')
  return `${withoutKnownExt}.bib`
}

// ── Emit functions ──

function emitRoot(
  root: Ast.Root,
  context: ConversionContext,
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
    bodyNodes.push(...preambleNodes)
    preambleNodes.length = 0
  }

  // Extract preamble metadata
  extractPreambleMetadata(preambleNodes, metadata, context)

  // Build output
  const parts: string[] = []

  // Emit metadata as Typst #set / #show rules
  if (metadata.title || metadata.author || metadata.date) {
    const setArgs: string[] = []
    if (metadata.title) setArgs.push(`  title: [${context.formattedTitle}],`)
    if (metadata.author) setArgs.push(`  author: "${escapeTypstString(metadata.author)}",`)
    // LaTeX dates are free-form display text; Typst document.date requires a datetime.
    parts.push(`#set document(\n${setArgs.join('\n')}\n)`)
    parts.push('')
  }

  const body = emitNodes(bodyNodes, context, false).trim()
  // LaTeX numbers sectioning commands by default, and converted @sec:*
  // references only resolve against numbered headings.
  if (/^=+ /m.test(body)) {
    parts.push('#set heading(numbering: "1.1")')
    parts.push('')
  }
  if (body) parts.push(body)

  return parts.join('\n') + '\n'
}

function extractPreambleMetadata(
  nodes: Ast.Node[],
  metadata: ConversionResult['metadata'],
  context: ConversionContext,
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
        if (pkg) metadata.packages.push(...pkg.split(',').map((part) => part.trim()).filter(Boolean))
        break
      }
      case 'title':
        metadata.title = plainText(getMandatoryArgNodes(macro)[0] || [])
        context.formattedTitle = emitContentArgs(macro, context)[0]
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
  context: ConversionContext,
  inMath: boolean,
): string {
  const parts: string[] = []
  let prevWasMathLetter = false
  for (let i = 0; i < nodes.length; i++) {
    const emitted = emitNode(nodes[i], context, inMath)
    // Typst math reads adjacent letters as one identifier; the LaTeX parser
    // hands us math letters as separate string nodes, so keep them separate.
    if (inMath && prevWasMathLetter && /^[A-Za-z]/.test(emitted)) {
      parts.push(' ')
    }
    parts.push(emitted)
    prevWasMathLetter = inMath && /[A-Za-z]$/.test(emitted)
  }
  return parts.join('')
}

function emitNode(
  node: Ast.Node,
  context: ConversionContext,
  inMath: boolean,
): string {
  switch (node.type) {
    case 'string': {
      const content = (node as Ast.String).content
      if (!inMath) return escapeTypstText(content)
      // Typst math reads a multi-letter run as one identifier, so LaTeX `mc`
      // must become `m c` to render as adjacent variables.
      return content.replace(/[A-Za-z]{2,}/g, (run) => run.split('').join(' '))
    }

    case 'whitespace':
      return ' '

    case 'parbreak':
      return '\n\n'

    case 'comment': {
      const commentText = (node as Ast.Comment).content
      return `//${commentText.startsWith(' ') ? '' : ' '}${commentText.replace(/\r?\n/g, ' ')}\n`
    }

    case 'macro':
      return emitMacro(node as Ast.Macro, context, inMath)

    case 'environment':
    case 'mathenv':
      return emitEnvironment(node as Ast.Environment, context, inMath)

    case 'inlinemath':
      return `$${emitNodes((node as Ast.InlineMath).content, context, true)}$`

    case 'displaymath':
      return `\n$ ${emitNodes((node as Ast.DisplayMath).content, context, true)} $\n`

    case 'group':
      return emitNodes((node as Ast.Group).content, context, inMath)

    case 'verbatim': {
      const verb = node as Ast.VerbatimEnvironment
      const fence = '`'.repeat(Math.max(3, ...(verb.content.match(/`+/g) || []).map((run) => run.length + 1)))
      return `${fence}\n${verb.content}\n${fence}\n`
    }

    case 'verb':
      return node.content.includes('`') ? `#raw("${escapeTypstString(node.content)}")` : `\`${node.content}\``

    default:
      return ''
  }
}

function emitMacro(
  macro: Ast.Macro,
  context: ConversionContext,
  inMath: boolean,
): string {
  const name = macro.content
  const args = getArgs(macro)

  // Math mode handling
  if (inMath) {
    return emitMathMacro(macro, context)
  }

  // Sectioning commands
  if (name in SECTIONING) {
    const depth = SECTIONING[name]
    // depth 0 (part) must not collapse via `0 || 1` into the same level as section.
    const heading = '='.repeat(depth <= 0 ? 1 : depth)
    const title = emitContentArgs(macro, context)[0] || ''
    if (macro.args?.some((arg) => arg.openMark === '' && emitArgContent(arg.content) === '*')) {
      return `\n#heading(level: ${Math.max(depth, 1)}, numbering: none)[${title}]\n`
    }
    if (name === 'part') {
      return `\n#pagebreak()\n${heading} ${title}\n`
    }
    return `\n${heading} ${title}\n`
  }

  // Text formatting
  if (name in TEXT_FORMAT) {
    const fmt = TEXT_FORMAT[name]
    const content = name === 'texttt' ? args[0] || '' : emitContentArgs(macro, context)[0] || ''
    if (name === 'texttt' && content.includes('`')) return `#raw("${escapeTypstString(content)}")`
    return `${fmt.before}${content}${fmt.after}`
  }

  // Simple commands (no arguments)
  if (name === 'maketitle') {
    const { title, author, date } = context.metadata
    return `\n#align(center)[\n${[
      title ? `#text(size: 1.5em, weight: "bold")[${context.formattedTitle}]` : '',
      author ? escapeTypstText(author) : '',
      date ? escapeTypstText(date) : '',
    ].filter(Boolean).join('\n\n')}\n]\n`
  }
  if (name in SIMPLE_COMMANDS) {
    return SIMPLE_COMMANDS[name]
  }

  // Special commands with arguments
  switch (name) {
    case 'underline':
      return `#underline[${emitContentArgs(macro, context)[0] || ''}]`

    case 'footnote':
      return `#footnote[${emitContentArgs(macro, context)[0] || ''}]`

    case 'href': {
      const url = args[0] || ''
      const text = emitContentArgs(macro, context)[1] || escapeTypstText(url)
      return `#link("${escapeTypstString(url)}")[${text}]`
    }

    case 'url':
      return `#link("${escapeTypstString(args[0] || '')}")`

    case 'includegraphics': {
      const file = args[0] || getOptionalArg(macro) || ''
      // Get the last mandatory arg (the file), since first may be options
      const mandatoryArgs = getMandatoryArgs(macro)
      const rawPath = mandatoryArgs[mandatoryArgs.length - 1] || file
      const imgPath = context.options.resolvePath?.(rawPath, 'image') ?? rawPath
      if (imgPath && !/\.[A-Za-z0-9]+$/.test(imgPath)) {
        context.warnings.push({
          message: `\\includegraphics{${imgPath}} has no file extension; Typst requires one (e.g. .png)`,
          construct: 'includegraphics',
        })
      }
      return `#image("${escapeTypstString(imgPath)}")`
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
    case 'parencite':
    case 'textcite': {
      const keys = (args[0] || '')
        .split(',')
        .map((key) => key.trim())
        .filter((key) => key.length > 0)
      // With a manual thebibliography the keys label plain blocks, which can
      // be linked but not @-referenced; without one, keep @key for real
      // #bibliography() setups.
      if (context.hasManualBibliography) {
        return keys.map((key) => `#link(label("${escapeTypstString(key)}"))[\\[${escapeTypstText(key)}\\]]`).join(' ')
      }
      return keys.map((key) => `@${key}`).join(' ')
    }

    case 'bibliography': {
      const files = (args[0] || '')
        .split(',')
        .map((part) => resolveBibliographyPath(part.trim(), context))
        .filter((part) => part.length > 0)
      return emitBibliographyCall(files, context)
    }

    case 'addbibresource':
      return '' // Resources are collected before emitting the document body.

    case 'printbibliography':
      return emitBibliographyCall(context.bibliographyFiles, context)

    case 'nocite':
      return (args[0] || '').split(',').map((key) => key.trim()).filter((key) => key && key !== '*').map((key) => `#cite(label("${escapeTypstString(key)}"), form: none)`).join(' ')

    case 'bibliographystyle':
      return '' // no typst equivalent

    case 'input':
    case 'include': {
      const rawPath = (args[0] || '').trim()
      let file = context.options.resolvePath?.(rawPath, 'include') ?? rawPath
      if (!file) return '#include ""\n'
      const lower = file.toLowerCase()
      if (lower.endsWith('.typ')) {
        // already typst
      } else if (isLatexPath(file)) {
        file = file.replace(/\.tex$/i, '.typ')
      } else if (!/\.[A-Za-z0-9]+$/.test(file)) {
        // LaTeX \input{chapter} implies .tex
        file = `${file}.typ`
      }
      // Leave .sty/.cls/other extensions untouched (unsupported includes).
      // Include is a statement, so the next converted node must not be
      // consumed as another token in its path expression.
      return `#include "${escapeTypstString(file)}"\n`
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
      return '\\\n'
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
  context.warnings.push({
    message: `Unsupported command: \\${name}`,
    construct: `\\${name}${argStr}`,
  })
  return `/* [LaTeX] Unsupported: ${escapeComment(`\\${name}${argStr}`)} */`
}

function emitMathMacro(
  macro: Ast.Macro,
  context: ConversionContext,
): string {
  const name = macro.content

  if (name === 'label') return '' // Equation labels belong after the equation.
  if (name === 'notag' || name === 'nonumber') return ''

  if (name === 'text' || name === 'textrm' || name === 'operatorname') {
    const text = escapeTypstString(getArgs(macro)[0] || '')
    return name === 'operatorname' ? `op("${text}")` : `"${text}"`
  }

  // Check math command map
  if (name in MATH_COMMANDS) {
    const typstCmd = MATH_COMMANDS[name]
    const args = getMandatoryArgNodes(macro)

    // Commands that take arguments as function calls
    if (args.length > 0 && ['frac', 'sqrt', 'bb', 'cal', 'frak', 'upright', 'bold', 'italic',
      'overline', 'underline', 'hat', 'macron', 'tilde', 'arrow', 'dot', 'dot.double'].includes(typstCmd)) {
      const emittedArgs = args.map((a) => emitNodes(a, context, true))
      if (name === 'sqrt') {
        const index = macro.args?.find((arg) => arg.openMark === '[')
        if (index?.content.length) return `root(${emitNodes(index.content, context, true)}, ${emittedArgs[0]})`
      }
      return `${typstCmd}(${emittedArgs.join(', ')})`
    }

    // Simple symbol replacement
    return typstCmd
  }

  // Escaped special chars in math, emitted directly — routing through the
  // text emitter would bounce straight back here and recurse forever.
  const mathEscapes: Record<string, string> = {
    '&': '&',
    '%': '%',
    '$': '\\$',
    '#': '\\#',
    '{': '{',
    '}': '}',
    ' ': ' ',
    ',': ' ',
    ';': ' ',
    '!': '',
    '\\': '\\\n',
  }
  if (name in mathEscapes) return mathEscapes[name]

  // Subscript/superscript handled by parser as _ and ^; a bare \_ or \^ with
  // no arguments is an escaped literal instead.
  if (name === '_' || name === '^') {
    const args = getMandatoryArgNodes(macro)
    if (args.length === 0) return `\\${name}`
    const sub = emitNodes(args[0], context, true)
    return `${name}(${sub})`
  }

  // left/right delimiters
  if (name === 'left' || name === 'right') {
    return '' // delimiters pass through
  }

  // Unknown math command
  const args = getArgs(macro)
  context.warnings.push({
    message: `Unsupported math command: \\${name}`,
    construct: `\\${name}${args.length ? `{${args.join('}{')}}` : ''}`,
  })
  return `op("${escapeTypstString(name)}")`
}

function emitEnvironment(
  env: Ast.Environment,
  context: ConversionContext,
  inMath = false,
): string {
  const envName = getEnvName(env)
  switch (envName) {
    case 'itemize':
      return emitList(env, context, '-')

    case 'enumerate':
      return emitList(env, context, '+')

    case 'description':
      return emitDescriptionList(env, context)

    case 'tabular':
    case 'tabular*':
    case 'array':
      if (inMath && envName === 'array') return emitMatrix(env, context, 'none')
      return emitTable(env, context)

    case 'matrix':
      return emitMatrix(env, context, 'none')
    case 'pmatrix':
      return emitMatrix(env, context, '"("')
    case 'bmatrix':
      return emitMatrix(env, context, '"["')
    case 'Bmatrix':
      return emitMatrix(env, context, '"{"')
    case 'vmatrix':
      return emitMatrix(env, context, '"|"')
    case 'Vmatrix':
      return emitMatrix(env, context, '"||"')
    case 'aligned':
    case 'gathered':
    case 'split':
      return emitNodes(env.content, context, true)

    case 'figure':
    case 'figure*':
      return emitFigure(env, context)

    case 'table':
    case 'table*':
      return emitTableEnv(env, context)

    case 'equation':
    case 'equation*':
    case 'align':
    case 'align*':
    case 'gather':
    case 'gather*':
    case 'multline':
    case 'multline*':
      return emitEquation(env, context)

    case 'center':
      return `#align(center)[\n${emitNodes(env.content, context, false).trim()}\n]\n`

    case 'flushleft':
      return `#align(left)[\n${emitNodes(env.content, context, false).trim()}\n]\n`

    case 'flushright':
      return `#align(right)[\n${emitNodes(env.content, context, false).trim()}\n]\n`

    case 'quote':
    case 'quotation':
      return `#quote(block: true)[\n${emitNodes(env.content, context, false).trim()}\n]\n`

    case 'verbatim':
    case 'lstlisting':
    case 'minted':
      return `\`\`\`\n${emitNodes(env.content, context, false)}\n\`\`\`\n`

    case 'abstract':
      return `// Abstract\n${emitNodes(env.content, context, false).trim()}\n`

    case 'thebibliography':
      return emitBibliography(env, context)

    case 'minipage':
      return emitNodes(env.content, context, false)

    case 'tikzpicture':
    case 'pgfpicture': {
      context.warnings.push({
        message: `TikZ/PGF not supported: ${envName}`,
        construct: `\\begin{${envName}}...\\end{${envName}}`,
      })
      return `/* [LaTeX] TikZ/PGF environment "${envName}" not supported */\n`
    }

    default: {
      // Unknown environment
      context.warnings.push({
        message: `Unknown environment: ${envName}`,
        construct: `\\begin{${envName}}...\\end{${envName}}`,
      })
      return emitNodes(env.content, context, false)
    }
  }
}

// ── List emitters ──

function emitList(
  env: Ast.Environment,
  context: ConversionContext,
  marker: string,
): string {
  const items = collectItems(env.content, context)
  const lines = items.map((item) => `${marker} ${item.trim().replace(/\n/g, '\n  ')}`)
  return '\n' + lines.join('\n') + '\n'
}

function emitDescriptionList(
  env: Ast.Environment,
  context: ConversionContext,
): string {
  const parts: string[] = []

  for (const node of env.content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === 'item') {
      const label = node.args?.find((arg) => arg.openMark === '[')
      const body = node.args?.find((arg) => arg.openMark === '' && arg.content.length)
      parts.push(`/ ${label ? emitNodes(label.content, context, false) : ''}: ${body ? emitNodes(body.content, context, false) : ''}`)
    } else {
      const text = emitNode(node, context, false)
      if (parts.length > 0) {
        parts[parts.length - 1] += text
      }
    }
  }

  return '\n' + parts.filter(Boolean).join('\n') + '\n'
}

function collectItems(
  content: Ast.Node[],
  context: ConversionContext,
): string[] {
  const items: string[] = []
  let current = ''

  for (const node of content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === 'item') {
      if (current.trim()) items.push(current)
      // Extract item body from absorbed args (empty open/close marks)
      const macro = node as Ast.Macro
      const bodyArg = macro.args?.find((a) => a.openMark === '' && a.closeMark === '' && a.content.length > 0)
      current = bodyArg ? emitNodes(bodyArg.content, context, false) : ''
    } else {
      current += emitNode(node, context, false)
    }
  }

  if (current.trim()) items.push(current)
  return items
}

// ── Table emitter ──

function emitTable(
  env: Ast.Environment,
  context: ConversionContext,
): string {
  // The final mandatory argument is the colspec; optional placement and the
  // width of tabular* are unrelated to the number of columns.
  const colSpec = env.args?.filter((arg) => arg.openMark === '{').at(-1)
  const rows = splitTableCells(env.content)
  const numCols = countColumns(colSpec?.content ?? []) || Math.max(1, ...rows.map((row) => row.length))
  const cells = rows.map((row) => row.map((cell) => `[${emitNodes(cell, context, false).trim()}]`).join(', '))

  const cellLines = cells.filter(Boolean).map((c) => `  ${c},`).join('\n')
  return `\n#table(\n  columns: ${numCols},\n${cellLines}\n)\n`
}

function countColumns(nodes: Ast.Node[]): number {
  let count = 0
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.type !== 'string') continue
    if (node.content === '*' && nodes[index + 1]?.type === 'group' && nodes[index + 2]?.type === 'group') {
      const repeat = nodes[index + 1] as Ast.Group
      const pattern = nodes[index + 2] as Ast.Group
      count += Math.max(0, Number(emitArgContent(repeat.content)) || 0) * countColumns(pattern.content)
      index += 2
    } else {
      count += (node.content.match(/[lcrpmbX]/g) || []).length
    }
  }
  return count
}

function splitTableCells(content: Ast.Node[]): Ast.Node[][][] {
  const rows: Ast.Node[][][] = []
  let row: Ast.Node[][] = [[]]
  for (const node of content) {
    if (node.type === 'macro' && node.content === '\\') {
      rows.push(row)
      row = [[]]
    } else if (node.type === 'string' && node.content === '&') {
      row.push([])
    } else if (node.type === 'macro' && ['hline', 'toprule', 'midrule', 'bottomrule', 'cline', 'cmidrule'].includes(node.content)) {
      // Rules do not consume a cell. Escaped ampersands and nested formulas do.
    } else {
      row[row.length - 1].push(node)
    }
  }
  if (row.length > 1 || row[0].some((node) => !['whitespace', 'parbreak', 'comment'].includes(node.type))) rows.push(row)
  return rows
}

function emitMatrix(env: Ast.Environment, context: ConversionContext, delimiter: string): string {
  const rows = splitTableCells(env.content).map((row) => row.map((cell) => emitNodes(cell, context, true).trim()).join(', '))
  return `mat(delim: ${delimiter}, ${rows.join('; ')})`
}

function emitEquation(env: Ast.Environment, context: ConversionContext): string {
  const labels = env.content.filter((node): node is Ast.Macro => node.type === 'macro' && node.content === 'label')
  const unnumbered = getEnvName(env).endsWith('*') || env.content.some((node) => node.type === 'macro' && ['notag', 'nonumber'].includes(node.content))
  const body = emitNodes(env.content, context, true).trim()
  const label = labels[0] ? ` <${getArgs(labels[0])[0] || ''}>` : ''
  if (labels.length > 1) {
    context.warnings.push({ message: 'Multiple equation labels require manual row numbering; only the first label was retained.', construct: getEnvName(env) })
  }
  return `\n#math.equation(block: true, numbering: ${unnumbered ? 'none' : '"(1)"'}, $ ${body} $)${label}\n`
}

// ── Figure emitter ──

function emitFigure(env: Ast.Environment, context: ConversionContext): string {
  return emitFloat(env, context, 'image')
}

function emitTableEnv(env: Ast.Environment, context: ConversionContext): string {
  return emitFloat(env, context, 'table')
}

function emitFloat(env: Ast.Environment, context: ConversionContext, kind: 'image' | 'table'): string {
  let caption = ''
  let label = ''
  const body: string[] = []
  for (const node of env.content) {
    if (node.type === 'macro' && node.content === 'caption') {
      caption = emitContentArgs(node, context)[0] || ''
    } else if (node.type === 'macro' && node.content === 'label') {
      label = getArgs(node)[0] || ''
    } else if (node.type === 'macro' && node.content === 'centering') {
      continue
    } else {
      const content = emitNode(node, context, false).trim()
      if (content) body.push(content)
    }
  }
  if (kind === 'table' && !caption && !label) return body.join('\n')
  // A single image/table is a code expression; mixed float content needs a
  // content block so every image and surrounding paragraph is retained.
  const direct = body.length === 1 && body[0].startsWith(`#${kind}(`)
  const content = direct ? body[0].slice(1) : `[${body.join('\n')}]`
  const parts = [`#figure(\n  ${content},`]
  if (!direct) parts.push(`  kind: ${kind},`)
  if (caption) parts.push(`  caption: [${caption}],`)
  parts.push(`)${label ? ` <${label}>` : ''}`)
  return '\n' + parts.join('\n') + '\n'
}

// ── Bibliography emitter ──

function emitBibliography(
  env: Ast.Environment,
  context: ConversionContext,
): string {
  // \begin{thebibliography} contains \bibitems
  const items: string[] = []
  let currentKey = ''
  let currentText = ''

  for (const node of env.content) {
    if (node.type === 'macro' && (node as Ast.Macro).content === 'bibitem') {
      if (currentKey) {
        items.push(`#block[\\[${currentKey}\\] ${currentText.trim()}] <${currentKey}>`)
      }
      const macro = node as Ast.Macro
      currentKey = getArgs(macro)[0] || ''
      // The parser can absorb the trailing item text into an empty-mark arg,
      // exactly as it does for \item.
      const bodyArg = macro.args?.find((a) => a.openMark === '' && a.closeMark === '' && a.content.length > 0)
      currentText = bodyArg ? emitNodes(bodyArg.content, context, false) : ''
    } else {
      currentText += emitNode(node, context, false)
    }
  }

  if (currentKey) {
    items.push(`#block[\\[${currentKey}\\] ${currentText.trim()}] <${currentKey}>`)
  }

  context.warnings.push({
    message: 'Manual bibliography converted to labeled blocks; citations link to them. Consider a .bib file with #bibliography().',
    construct: '\\begin{thebibliography}',
  })

  return '\n#heading(numbering: none)[Bibliography]\n' + items.join('\n') + '\n'
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
