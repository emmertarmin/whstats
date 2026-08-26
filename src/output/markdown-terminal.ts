export interface TerminalMarkdownTheme {
  readonly accent: string;
  readonly surface: string;
  readonly muted: string;
}

export interface TerminalMarkdownOptions {
  readonly colors?: boolean;
  readonly columns?: number;
  readonly hyperlinks?: boolean;
  readonly theme?: TerminalMarkdownTheme;
}

function trueColor(color: string, background = false): string {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `\x1b[${background ? 48 : 38};2;${red};${green};${blue}m`;
}

function applyTheme(rendered: string, theme: TerminalMarkdownTheme): string {
  return rendered
    .replaceAll("\x1b[38;5;215m", trueColor(theme.accent))
    .replaceAll("\x1b[48;5;236m", trueColor(theme.surface, true))
    .replaceAll("\x1b[38;5;242m", trueColor(theme.muted))
    .replaceAll("\x1b[38;5;245m", trueColor(theme.muted));
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
  const colors = options.colors ?? process.env.NO_COLOR === undefined;
  const rendered = bunMarkdown.ansi(markdown, {
    colors,
    columns: options.columns ?? process.stdout.columns ?? 100,
    hyperlinks: options.hyperlinks ?? process.stdout.isTTY,
    kittyGraphics: false,
  });
  if (!colors) return rendered;

  // Bun renders emphasis as italic. Add a subdued foreground color so comments
  // remain readable without competing with bold report values.
  const subdued = rendered
    .replaceAll("\x1b[3m", "\x1b[3;38;5;245m")
    .replaceAll("\x1b[23m", "\x1b[23;39m");
  return options.theme ? applyTheme(subdued, options.theme) : subdued;
}
