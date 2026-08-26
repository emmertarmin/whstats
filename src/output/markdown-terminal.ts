export interface TerminalMarkdownOptions {
  readonly colors?: boolean;
  readonly columns?: number;
  readonly hyperlinks?: boolean;
}

/** The only wrapper around Bun's unstable terminal Markdown API. */
export function renderTerminalMarkdown(
  markdown: string,
  options: TerminalMarkdownOptions = {},
): string {
  // The runtime has this Bun 1.4 API, but some published type sets still omit it.
  const bunMarkdown = Bun.markdown as typeof Bun.markdown & {
    ansi(input: string, theme: TerminalMarkdownOptions & { kittyGraphics: boolean }): string;
  };
  return bunMarkdown.ansi(markdown, {
    colors: options.colors ?? process.env.NO_COLOR === undefined,
    columns: options.columns ?? process.stdout.columns ?? 100,
    hyperlinks: options.hyperlinks ?? process.stdout.isTTY,
    kittyGraphics: false,
  });
}
