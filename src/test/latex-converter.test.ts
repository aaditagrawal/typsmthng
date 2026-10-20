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

describe('references and manual bibliography', () => {
  it('numbers headings so section references resolve', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}\\section{Intro}\\label{sec:i}See \\ref{sec:i}.\\end{document}',
    )
    expect(result.typst).toContain('#set heading(numbering: "1.1")')
    expect(result.typst).toContain('@sec:i')
  })

  it('converts thebibliography to labeled blocks and cites to links', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}Citing \\cite{knuth}.\\begin{thebibliography}{9}\\bibitem{knuth} Donald Knuth. The TeXbook. 1984.\\end{thebibliography}\\end{document}',
    )
    expect(result.typst).toContain('#link(label("knuth"))')
    expect(result.typst).toContain('#block[\\[knuth\\] Donald Knuth. The TeXbook. 1984.] <knuth>')
    expect(result.typst).toContain('#heading(numbering: none)[Bibliography]')
  })

  it('keeps @key cites when no manual bibliography exists', async () => {
    const result = await convertLatexToTypst(
      '\\begin{document}Citing \\cite{doe2020}.\\end{document}',
    )
    expect(result.typst).toContain('@doe2020')
    expect(result.typst).not.toContain('#link(label(')
  })
})

describe('real project conversion regressions', () => {
  it('terminates include statements before adjacent includes, prose, and bibliography calls', async () => {
    const result = await convertLatexToTypst(String.raw`\input{first}\input{second}Tail.\bibliography{refs}`)
    expect(result.typst).toContain('#include "first.typ"\n#include "second.typ"\nTail.#bibliography("refs.bib")')
  })

  it('collects biblatex resources from the preamble and prints a bibliography', async () => {
    const result = await convertLatexToTypst(String.raw`
\usepackage[backend=biber]{biblatex}
\addbibresource{references.bib}
\addbibresource[location=local]{extra.bibtex}
\begin{document}
See \autocite{doe2020} and \parencite{smith2021}.
\printbibliography[title={References}]
\end{document}`)
    expect(result.typst).toContain('@doe2020')
    expect(result.typst).toContain('@smith2021')
    expect(result.typst).toContain('#bibliography(("references.bib", "extra.bib"))')
    expect(result.warnings).toEqual([])
  })

  it('lets project imports resolve original include, image, and bibliography paths', async () => {
    const paths: Array<[string, string]> = []
    const result = await convertLatexToTypst(String.raw`
\input{Chapter.TEX}
\includegraphics{diagram}
\bibliography{references.bibtex}`, {
      resolvePath: (path, kind) => {
        paths.push([path, kind])
        if (kind === 'include') return '../Chapter-2.typ'
        if (kind === 'image') return '../assets/diagram.svg'
        return '../references.bib'
      },
    })
    expect(paths).toEqual([
      ['Chapter.TEX', 'include'],
      ['diagram', 'image'],
      ['references.bibtex', 'bibliography'],
    ])
    expect(result.typst).toContain('#include "../Chapter-2.typ"')
    expect(result.typst).toContain('#image("../assets/diagram.svg")')
    expect(result.typst).toContain('#bibliography("../references.bib")')
    expect(result.warnings).toEqual([])
  })

  it('preserves explicit bibliography extension and case for project alias resolution', async () => {
    const requested: string[] = []
    const result = await convertLatexToTypst(String.raw`\addbibresource{Refs.BIB}\begin{document}\printbibliography\end{document}`, {
      resolvePath: (path, kind) => {
        if (kind === 'bibliography') requested.push(path)
        return 'Refs-2.bib'
      },
    })
    expect(requested).toEqual(['Refs.BIB'])
    expect(result.typst).toContain('#bibliography("Refs-2.bib")')
  })

  it('does not mistake a commented-out bibliography for a manual bibliography', async () => {
    const result = await convertLatexToTypst(String.raw`
% \begin{thebibliography}
\cite{doe2020}`)
    expect(result.typst).toContain('@doe2020')
    expect(result.typst).not.toContain('#link(label(')
  })

  it('supports manual bibliography citations in separately converted chapter files', async () => {
    const result = await convertLatexToTypst(String.raw`\cite{doe2020}`, { hasManualBibliography: true })
    expect(result.typst).toContain('#link(label("doe2020"))')
    const independent = await convertLatexToTypst(String.raw`\cite{doe2020}`)
    expect(independent.typst).toContain('@doe2020')
  })

  it('preserves free-form title dates without invalid document metadata', async () => {
    const result = await convertLatexToTypst(String.raw`
\title{A $\frac{x}{y}$ Paper}
\author{Jane Doe}
\date{September 2026}
\begin{document}\maketitle\end{document}`)
    expect(result.metadata.date).toBe('September 2026')
    expect(result.typst).not.toContain('date: "September 2026"')
    expect(result.typst).toContain('#text(size: 1.5em, weight: "bold")[A $frac(x, y)$ Paper]')
    expect(result.typst).toContain('September 2026')
  })

  it('emits nested math in headings, formatted text, links, and footnotes', async () => {
    const result = await convertLatexToTypst(String.raw`
\section{Ratio $\frac{a}{b}$}
\textbf{Energy $mc^2$}
\href{https://example.com}{\emph{Ratio} $\frac{x}{y}$}
\footnote{For $x^2$.}`)
    expect(result.typst).toContain('= Ratio $frac(a, b)$')
    expect(result.typst).toContain('*Energy $m c^(2)$*')
    expect(result.typst).toContain('#link("https://example.com")[_Ratio_ $frac(x, y)$]')
    expect(result.typst).toContain('#footnote[For $x^(2)$.]')
  })

  it('escapes literal Typst markup and code in prose and macro contents', async () => {
    const result = await convertLatexToTypst(String.raw`[draft] #name @person *stars* \textbf{a]b #code}`)
    expect(result.typst).toContain(String.raw`\[draft\] \#name \@person \*stars\*`)
    expect(result.typst).toContain(String.raw`*a\]b \#code*`)
  })

  it('preserves unnumbered headings', async () => {
    const result = await convertLatexToTypst(String.raw`\section*{Acknowledgments}\section{Results}`)
    expect(result.typst).toContain('#heading(level: 1, numbering: none)[Acknowledgments]')
    expect(result.typst).toContain('= Results')
  })

  it('places equation labels on numbered equations outside math mode', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{equation}\label{eq:ratio}\frac{x}{y}=2\end{equation}
See \eqref{eq:ratio}.
\begin{equation*}x=2\end{equation*}`)
    expect(result.typst).toContain('#math.equation(block: true, numbering: "(1)", $ frac(x, y)=2 $) <eq:ratio>')
    expect(result.typst).toContain('@eq:ratio')
    expect(result.typst).toContain('#math.equation(block: true, numbering: none, $ x=2 $)')
    expect(result.warnings).toEqual([])
  })

  it('separates adjacent math symbols and preserves indexed roots', async () => {
    const result = await convertLatexToTypst(String.raw`$\alpha\beta x + \sqrt[3]{y}$`)
    expect(result.typst).toContain('alpha beta x')
    expect(result.typst).toContain('root(3, y)')
  })

  it('escapes quotes in math text and warns about unknown math commands', async () => {
    const result = await convertLatexToTypst(String.raw`$\text{say "hello"} + \unknown$`)
    expect(result.typst).toContain(String.raw`"say \"hello\""`)
    expect(result.typst).toContain('op("unknown")')
    expect(result.warnings.some((warning) => warning.construct === '\\unknown')).toBe(true)
  })

  it('converts matrix cells in math mode', async () => {
    const result = await convertLatexToTypst(String.raw`$\begin{pmatrix}a & \frac{b}{c}\\d & e\end{pmatrix}$`)
    expect(result.typst).toContain('mat(delim: "(", a, frac(b, c); d, e)')
    expect(result.warnings).toEqual([])
  })

  it('counts repeated table column specs independently of optional placement', async () => {
    const result = await convertLatexToTypst(String.raw`\begin{tabular}[t]{*{2}{l}p{3cm}}A & B & C\end{tabular}`)
    expect(result.typst).toContain('columns: 3,')
  })

  it('does not use tabular star width as the column specification', async () => {
    const result = await convertLatexToTypst(String.raw`\begin{tabular*}{10cm}[t]{lc}A & B\end{tabular*}`)
    expect(result.typst).toContain('columns: 2,')
  })

  it('keeps escaped ampersands and math alignment markers inside table cells', async () => {
    const result = await convertLatexToTypst(String.raw`\begin{tabular}{ll}A \& B & $\begin{pmatrix}1 & 2\end{pmatrix}$\\C & D\end{tabular}`)
    expect(result.typst).toContain('[A & B], [$mat(delim: "(", 1, 2)$]')
    expect(result.typst).toContain('[C], [D]')
  })

  it('retains every image and text in a figure and resolves their paths', async () => {
    const result = await convertLatexToTypst(String.raw`
\begin{figure}
\includegraphics{first.png}
Comparison
\includegraphics{second.png}
\caption{A $\frac{x}{y}$ comparison}
\label{fig:both}
\end{figure}`, { resolvePath: (path) => `../${path}` })
    expect(result.typst).toContain('#image("../first.png")')
    expect(result.typst).toContain('#image("../second.png")')
    expect(result.typst).toContain('Comparison')
    expect(result.typst).toContain('caption: [A $frac(x, y)$ comparison]')
    expect(result.typst).toContain('<fig:both>')
  })

  it('escapes image filenames inside a figure', async () => {
    const result = await convertLatexToTypst(String.raw`\begin{figure}\includegraphics{a"b.png}\end{figure}`)
    expect(result.typst).toContain(String.raw`image("a\"b.png")`)
  })

  it('indents nested lists under the parent item', async () => {
    const result = await convertLatexToTypst(String.raw`\begin{itemize}\item Parent\begin{itemize}\item Child\end{itemize}\item Sibling\end{itemize}`)
    expect(result.typst).toMatch(/- Parent\s*\n {2}- Child/)
    expect(result.typst).toContain('\n- Sibling')
  })

  it('retains absorbed description item bodies and spaces', async () => {
    const result = await convertLatexToTypst(String.raw`\begin{description}\item[Term] A definition with several words.\end{description}`)
    expect(result.typst).toContain('/ Term: ')
    expect(result.typst).toContain('A definition with several words.')
  })

  it('uses full bibliography output for wildcard nocite', async () => {
    const result = await convertLatexToTypst(String.raw`\nocite{*}\bibliography{refs}`)
    expect(result.typst).toContain('#bibliography("refs.bib", full: true)')
  })

  it('uses a hidden citation to retain individual nocite entries', async () => {
    const result = await convertLatexToTypst(String.raw`\nocite{doe2020}\bibliography{refs}`)
    expect(result.typst).toContain('#cite(label("doe2020"), form: none)')
  })

  it('keeps formatting out of plain project title metadata', async () => {
    const result = await convertLatexToTypst(String.raw`\title{A \textbf{Bold} Paper}\begin{document}\maketitle\end{document}`)
    expect(result.metadata.title).toBe('A Bold Paper')
    expect(result.typst).toContain('title: [A *Bold* Paper]')
  })

  it('preserves literal backticks in inline code', async () => {
    const result = await convertLatexToTypst('\\texttt{foo`bar} and \\verb|baz`qux|')
    expect(result.typst).toContain('#raw("foo`bar")')
    expect(result.typst).toContain('#raw("baz`qux")')
  })

  it('uses a longer verbatim fence when source contains triple backticks', async () => {
    const result = await convertLatexToTypst('\\begin{verbatim}\n```sample```\n\\end{verbatim}')
    expect(result.typst).toContain('````\n')
    expect(result.typst).toContain('```sample```')
  })
})
