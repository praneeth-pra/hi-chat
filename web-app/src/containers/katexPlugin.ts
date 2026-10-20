// Loaded on its own (RenderMarkdown fetches it while idle, or when a reply
// has maths), so KaTeX's code and fonts stay out of what loads at start.
import 'katex/dist/katex.min.css'
export { default } from 'rehype-katex'
