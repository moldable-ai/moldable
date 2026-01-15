/**
 * Lexical Editor Theme
 * Tailwind CSS classes for styling the editor content
 */
export const editorTheme = {
  paragraph: 'my-1',
  placeholder: 'text-sm text-muted-foreground! opacity-50',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
    code: 'bg-muted px-1.5 py-0.5 rounded font-mono text-sm',
  },
  heading: {
    h1: 'text-2xl font-bold my-3',
    h2: 'text-xl font-bold my-2',
    h3: 'text-lg font-bold my-2',
    h4: 'text-base font-bold my-1',
    h5: 'text-sm font-bold my-1',
    h6: 'text-xs font-bold my-1',
  },
  list: {
    nested: {
      listitem: 'lexical-nested-listitem',
    },
    ol: 'ml-4 list-outside list-decimal',
    ul: 'ml-4 list-outside list-disc',
    listitem: '',
    listitemChecked: 'lexical-listitem-checked',
    listitemUnchecked: 'lexical-listitem-unchecked',
  },
  link: 'text-primary underline hover:text-primary/80 cursor-pointer',
  quote: 'border-l-4 border-muted px-4 py-2 my-2 text-muted-foreground',
  code: 'bg-muted p-3 my-4 rounded font-mono text-sm',
}
