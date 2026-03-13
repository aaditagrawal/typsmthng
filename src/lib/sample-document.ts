export const SAMPLE_DOCUMENT = `// Welcome to typsmthng — a Typst editor in your browser
// This sample showcases Typst syntax. Start editing!

#set page(margin: 2cm)
#set text(size: 11pt)

= Introduction to Typst

Typst is a modern typesetting system designed as an alternative to LaTeX.
It offers *fast compilation*, a _clean syntax_, and powerful features.

== Text Formatting

You can make text *bold*, _italic_, or *_both_*.
Use \`inline code\` for technical terms.
Add a #link("https://typst.app")[hyperlink] easily.

== Lists

Unordered list:
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

Numbered list:
+ Step one
+ Step two
+ Step three

== Mathematics

Typst has built-in math support. Inline: $x^2 + y^2 = z^2$

Display math:
$ integral_0^infinity e^(-x^2) dif x = sqrt(pi) / 2 $

A matrix:
$ mat(
  1, 2, 3;
  4, 5, 6;
  7, 8, 9;
) $

== Code Blocks

\`\`\`rust
fn main() {
    println!("Hello from Typst!");
}
\`\`\`

== Tables

#table(
  columns: (auto, 1fr, 1fr),
  align: (left, center, center),
  table.header[*Feature*][*Typst*][*LaTeX*],
  [Syntax], [Clean], [Verbose],
  [Speed], [Fast], [Slow],
  [Learning], [Easy], [Hard],
)

== Functions & Styling

#let note(body) = block(
  fill: rgb("#FFF3ED"),
  inset: 12pt,
  radius: 4pt,
  width: 100%,
  body,
)

#note[
  This is a custom styled block created with a Typst function.
  You can define reusable components easily.
]

== What's Next?

Start editing this document or clear it and write your own.
The preview will update as you type.
`
