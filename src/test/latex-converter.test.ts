import { describe, expect, it } from 'vitest'
import { convertLatexToTypst } from '@/lib/latex-converter'

describe('latex-converter', () => {
  // ── Document structure ──

  it('converts sections and subsections to headings', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\section{Introduction}
Hello world.
\subsection{Background}
Some text.
\subsubsection{Details}
More text.
\end{document}`)

    expect(result.typst).toContain('= Introduction')
    expect(result.typst).toContain('== Background')
    expect(result.typst).toContain('=== Details')
  })

  it('extracts document metadata from preamble', async () => {
    const result = await convertLatexToTypst(String.raw`
\documentclass{article}
\usepackage{amsmath}
\title{My Paper}
\author{Jane Doe}
\date{2024}
\begin{document}
Hello.
\end{document}`)

    expect(result.metadata.documentclass).toBe('article')
    expect(result.metadata.title).toBe('My Paper')
    expect(result.metadata.author).toBe('Jane Doe')
    expect(result.metadata.date).toBe('2024')
    expect(result.metadata.packages).toContain('amsmath')
    expect(result.typst).toContain('#set document(')
    expect(result.typst).toContain('title: [My Paper]')
  })

  // ── Text formatting ──

  it('converts bold and italic text', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\textbf{bold} and \textit{italic} and \emph{emphasis}
\end{document}`)

    expect(result.typst).toContain('*bold*')
    expect(result.typst).toContain('_italic_')
    expect(result.typst).toContain('_emphasis_')
  })

  it('converts monospace text', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\texttt{code}
\end{document}`)

    expect(result.typst).toContain('`code`')
  })

  it('converts underline', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\underline{underlined}
\end{document}`)

    expect(result.typst).toContain('#underline[underlined]')
  })

  // ── Math ──

  it('passes through inline math', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
The formula $x^2 + y^2 = z^2$ is famous.
\end{document}`)

    expect(result.typst).toMatch(/\$.*x.*\$/)
  })

  it('converts display math', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
$$E = mc^2$$
\end{document}`)

    expect(result.typst).toMatch(/\$.*E.*\$/)
  })

  it('converts equation environments', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{equation}
a^2 + b^2 = c^2
\end{equation}
\end{document}`)

    expect(result.typst).toMatch(/\$.*a.*\$/)
  })

  it('converts frac in math mode', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
$\frac{a}{b}$
\end{document}`)

    expect(result.typst).toContain('frac(a, b)')
  })

  // ── Lists ──

  it('converts itemize to unordered list', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{itemize}
\item First
\item Second
\item Third
\end{itemize}
\end{document}`)

    expect(result.typst).toContain('- First')
    expect(result.typst).toContain('- Second')
    expect(result.typst).toContain('- Third')
  })

  it('converts enumerate to ordered list', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{enumerate}
\item Alpha
\item Beta
\end{enumerate}
\end{document}`)

    expect(result.typst).toContain('+ Alpha')
    expect(result.typst).toContain('+ Beta')
  })

  // ── Tables ──

  it('converts basic tabular to table', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{tabular}{lcc}
A & B & C \\
1 & 2 & 3 \\
\end{tabular}
\end{document}`)

    expect(result.typst).toContain('#table(')
    expect(result.typst).toContain('columns: 3')
  })

  it('converts tabular nested inside table with caption', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{table}
\centering
\begin{tabular}{ll}
A & B \\
1 & 2 \\
\end{tabular}
\caption{Results}
\label{tab:results}
\end{table}
\end{document}`)

    expect(result.typst).toContain('#figure(')
    expect(result.typst).toMatch(/#figure\(\s*table\(/)
    expect(result.typst).toContain('caption: [Results]')
    expect(result.typst).toContain('<tab:results>')
  })

  // ── Figures ──

  it('converts includegraphics to image', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\includegraphics{photo.png}
\end{document}`)

    expect(result.typst).toContain('#image("photo.png")')
  })

  it('converts figure environment with caption', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{figure}
\centering
\includegraphics{photo.png}
\caption{A photo}
\label{fig:photo}
\end{figure}
\end{document}`)

    expect(result.typst).toContain('#figure(')
    expect(result.typst).toContain('image("photo.png")')
    expect(result.typst).toContain('caption: [A photo]')
    expect(result.typst).toContain('<fig:photo>')
  })

  // ── Cross-references ──

  it('converts label and ref', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\section{Intro}
\label{sec:intro}
See Section \ref{sec:intro}.
\end{document}`)

    expect(result.typst).toContain('<sec:intro>')
    expect(result.typst).toContain('@sec:intro')
  })

  it('converts cite', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
As shown in \cite{knuth1984}.
\end{document}`)

    expect(result.typst).toContain('@knuth1984')
  })

  it('splits multi-cite keys into separate Typst citations', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
As shown in \cite{knuth1984,lamport1994}.
\end{document}`)

    expect(result.typst).toContain('@knuth1984 @lamport1994')
    expect(result.typst).not.toContain('@knuth1984,lamport1994')
  })

  // ── Comments ──

  it('converts LaTeX comments to Typst comments', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
% This is a comment
Hello.
\end{document}`)

    expect(result.typst).toContain('// This is a comment')
  })

  // ── Special commands ──

  it('converts footnotes', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
Text\footnote{A footnote}.
\end{document}`)

    expect(result.typst).toContain('#footnote[A footnote]')
  })

  it('converts href', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\href{https://example.com}{Example}
\end{document}`)

    expect(result.typst).toContain('#link("https://example.com")[Example]')
  })

  it('escapes quotes and brackets in links and images', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\href{https://ex.com/a"b}{te]xt}
\includegraphics{fig"ure.png}
\end{document}`)

    expect(result.typst).toContain('#link("https://ex.com/a\\"b")[te\\]xt]')
    expect(result.typst).toContain('#image("fig\\"ure.png")')
  })

  it('converts tableofcontents', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\tableofcontents
\end{document}`)

    expect(result.typst).toContain('#outline()')
  })

  it('converts newpage', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
Page one.
\newpage
Page two.
\end{document}`)

    expect(result.typst).toContain('#pagebreak()')
  })

  it('converts bibliography command', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\bibliography{refs}
\end{document}`)

    expect(result.typst).toContain('#bibliography("refs.bib")')
  })

  it('converts input command', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\input{chapter1}
\end{document}`)

    expect(result.typst).toContain('#include "chapter1.typ"')
  })

  it('rewrites .tex and .TEX input paths to .typ', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\input{chapters/intro.tex}
\include{APPENDIX.TEX}
\end{document}`)

    expect(result.typst).toContain('#include "chapters/intro.typ"')
    expect(result.typst).toContain('#include "APPENDIX.typ"')
  })

  it('does not append .typ onto .sty includes or double .bib', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\input{foo.sty}
\bibliography{refs.bib}
\bibliography{other}
\end{document}`)

    expect(result.typst).toContain('#include "foo.sty"')
    expect(result.typst).toContain('#bibliography("refs.bib")')
    expect(result.typst).toContain('#bibliography("other.bib")')
    expect(result.typst).not.toContain('refs.bib.bib')
  })

  it('normalizes .bibtex and comma-separated bibliography lists', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\bibliography{refs.bibtex}
\bibliography{refs,extra}
\end{document}`)

    expect(result.typst).toContain('#bibliography("refs.bib")')
    expect(result.typst).not.toContain('refs.bibtex.bib')
    expect(result.typst).toContain('#bibliography(("refs.bib", "extra.bib"))')
  })

  it('escapes quotes and brackets in document metadata', async () => {
    const result = await convertLatexToTypst(String.raw`
\author{Jane "JD" Doe}
\title{A] Title}
\begin{document}
x
\end{document}`)

    expect(result.typst).toContain('author: "Jane \\"JD\\" Doe"')
    expect(result.typst).toContain('title: [A\\] Title]')
  })

  it('emits a pagebreak before part headings', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\part{P}
\section{S}
\end{document}`)

    expect(result.typst).toContain('#pagebreak()')
    expect(result.typst).toMatch(/=\s*P/)
    expect(result.typst).toMatch(/=\s*S/)
  })

  // ── Graceful degradation ──

  it('comments out unknown commands with warnings', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\customcommand{arg}
\end{document}`)

    expect(result.typst).toContain('Unsupported')
    expect(result.typst).toContain('customcommand')
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].construct).toContain('\\customcommand')
  })

  it('warns on TikZ environments', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}
\end{document}`)

    expect(result.warnings.some((w) => w.message.includes('TikZ'))).toBe(true)
  })

  // ── Edge cases ──

  it('handles empty document', async () => {
    const result = await convertLatexToTypst('')
    expect(result.typst).toBeDefined()
    expect(result.warnings).toEqual([])
  })

  it('handles document without \\begin{document}', async () => {
    const result = await convertLatexToTypst(String.raw`
\section{Hello}
Some text here.`)

    expect(result.typst).toContain('= Hello')
    expect(result.typst).toContain('Some text here.')
  })

  it('handles UTF-8 content', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
Héllo wörld. 日本語テスト.
\end{document}`)

    expect(result.typst).toContain('wörld')
    expect(result.typst).toContain('日本語テスト')
  })

  // ── Verbatim / code ──

  it('converts verbatim environments', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{verbatim}
int main() { return 0; }
\end{verbatim}
\end{document}`)

    expect(result.typst).toContain('```')
  })

  // ── Quote environments ──

  it('converts quote environment', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{quote}
To be or not to be.
\end{quote}
\end{document}`)

    expect(result.typst).toContain('#quote(block: true)')
  })

  // ── Center environment ──

  it('converts center environment', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{document}
\begin{center}
Centered text.
\end{center}
\end{document}`)

    expect(result.typst).toContain('#align(center)')
  })
})

describe('math escapes and scripts (regression: infinite recursion)', () => {
  it('converts sub/superscripts and frac in display math without overflowing', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}\\begin{equation}\\int_0^1 x^2 dx = \\frac{1}{3}\\end{equation}\\end{document}',
    )
    expect(result.typst).toContain('integral_(0)^(1)')
    expect(result.typst).toContain('frac(1, 3)')
  })

  it('emits escaped special characters in math directly', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}$100\\% \\_ \\$ \\# a\\,b$\\end{document}',
    )
    expect(result.typst).toContain('100%')
    expect(result.typst).toContain('\\_')
    expect(result.typst).toContain('\\$')
    expect(result.typst).toContain('\\#')
  })

  it('converts align rows with alignment markers and line breaks', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}\\begin{align}a &= b \\\\ c &= d\\end{align}\\end{document}',
    )
    expect(result.typst).toContain('&= b')
    expect(result.typst).toMatch(/\\\s*\n\s*c/)
  })
})

describe('math identifier splitting', () => {
  it('splits multi-letter runs in math so Typst reads adjacent variables', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}$E = mc^2$ and $\\int x\\,dx$\\end{document}',
    )
    expect(result.typst).toContain('m c^(2)')
    expect(result.typst).toContain('d x')
    expect(result.typst).not.toMatch(/[^a-z]mc[^a-z]/)
  })

  it('leaves prose text runs outside math untouched', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}Plain words stay intact.\\end{document}',
    )
    expect(result.typst).toContain('Plain words stay intact.')
  })
})

describe('table environment output', () => {
  it('wraps tabular in a compilable figure without a nested # prefix', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}\\begin{table}\\begin{tabular}{|l|c|}\\hline A & B \\\\ C & D \\\\ \\hline\\end{tabular}\\caption{Data}\\label{tab:x}\\end{table}\\end{document}',
    )
    expect(result.typst).toContain('#figure(')
    expect(result.typst).toMatch(/#figure\(\s*table\(/)
    expect(result.typst).not.toMatch(/#figure\(\s*#table\(/)
    expect(result.typst).toContain('columns: 2,')
    expect(result.typst).toContain('<tab:x>')
  })

  it('counts only column specifiers in the colspec', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}\\begin{tabular}{|l|p{3cm}|r|}A & B & C\\end{tabular}\\end{document}',
    )
    expect(result.typst).toContain('columns: 3,')
  })
})
