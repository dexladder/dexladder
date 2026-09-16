/** Blog posts are markdown files bundled as text (esbuild loader '.md': 'text'). */
declare module '*.md' {
  const text: string;
  export default text;
}
