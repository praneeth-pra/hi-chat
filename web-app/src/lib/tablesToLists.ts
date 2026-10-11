import type { List, PhrasingContent, Root, Table } from 'mdast'
import type { Node, Parent } from 'unist'

/** Convert parsed answer tables into lists, preserving inline markup and code. */
function tableToList(table: Table): List {
  const [header, ...rows] = table.children
  const content = rows.length ? rows : header ? [header] : []
  return {
    type: 'list',
    ordered: false,
    spread: false,
    children: content.map((row) => {
      const children: PhrasingContent[] = []
      let hasDetails = false
      row.children.forEach((cell, index) => {
        if (!cell.children.length) return
        if (index === 0) {
          children.push({ type: 'strong', children: cell.children })
        } else {
          if (children.length) {
            children.push({ type: 'text', value: hasDetails ? '; ' : ': ' })
          }
          if (header && header.children.length > 2 && rows.length) {
            children.push(...(header.children[index]?.children ?? []))
            children.push({ type: 'text', value: ': ' })
          }
          children.push(...cell.children)
          hasDetails = true
        }
      })
      return {
        type: 'listItem',
        spread: false,
        children: [{ type: 'paragraph', children }],
      }
    }),
  }
}

/** Runs in the existing Markdown parse, including streamed and nested tables. */
export function remarkTablesAsLists() {
  return (tree: Root) => {
    const rewrite = (node: Node) => {
      if (!('children' in node) || !Array.isArray(node.children)) return
      const parent = node as Parent
      parent.children = parent.children.map((child) => {
        if (child.type === 'table') return tableToList(child as Table)
        rewrite(child)
        return child
      })
    }
    rewrite(tree)
  }
}
