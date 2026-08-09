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
    expect(result.typst).toContain('#table(')
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
