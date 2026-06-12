/**
 * Presentation template. Storage = plain markdown.
 *
 *   `---`   on its own line  → new horizontal slide
 *   `----`  on its own line  → vertical sub-slide of the previous one
 *   `Note:` on its own line  → everything after is a speaker note
 *   `<!-- .slide: data-…="…" class="…" -->` at the top of a slide → attrs
 *
 * Frontmatter keys (theme, transition, slideNumber) drive reveal.js config.
 * The defaults preserve the original look, so plain `type: presentation`
 * docs keep working.
 */
export function generatePresentationContent(): string {
  return `---
type: presentation
theme: loica
transition: slide
slideNumber: c/t
---

# Welcome to Loica
## Your collaborative slide deck

Press **F** for fullscreen, **S** for speaker notes, **Esc** for the overview.

Note:
This is a speaker note — only you see it in speaker view (press **S**).
You can write multiple lines of notes here.

---

## How to write slides

- \`---\` on its own line splits horizontal slides
- \`----\` (four dashes) makes a vertical sub-slide
- Plain markdown otherwise: **bold**, *italic*, \`code\`, [links](https://loica.criti.ca)

----

### A vertical sub-slide

Press the down-arrow during the presentation to reach this slide.

---

<!-- .slide: data-background="#1c4e80" -->

## Per-slide styling

Add a comment at the top of any slide to change its look:

\`\`\`html
<!-- .slide: data-background="#1c4e80" -->
\`\`\`

Other handy attributes:

- \`data-background-color="#000"\`
- \`data-background-image="https://…"\`
- \`class="r-stretch"\` for full-bleed content

---

## Speaker notes

Add a \`Note:\` block after a slide's content — speakers see it in the
speaker-view window (press **S**).

Note:
Hi! This is the speaker view. The audience sees the slide above; you see
this and a clock and the next slide. Useful for cues and timings.

---

## Code with syntax highlighting

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

Code blocks are highlighted automatically.

---

## Save as PDF

Open the **⋯ menu → PDF** to download a slide-shaped PDF — handy for handouts
or offline reading.

---

## Tweak the look in frontmatter

\`\`\`yaml
theme: loica       # loica · white · black · league · beige · sky · night · serif · simple · solarized · moon · dracula · blood
transition: slide  # none · fade · convex · concave · zoom
slideNumber: c/t   # show "current/total" in the corner
\`\`\`

Edit the YAML at the top of this doc to try different combos.

---

## You're ready

Make this deck your own — replace these slides with your content and present!
`;
}
