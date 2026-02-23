const ANSI = {
  reset: "\x1b[0m",
  default: "\x1b[38;5;252m",
  highlight: "\x1b[97m",
  dim: "\x1b[90m",
  info: "\x1b[94m",
  warning: "\x1b[33m",
  danger: "\x1b[91m",
  success: "\x1b[92m",
};

function supportsColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  if (process.env.FORCE_COLOR) {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

function wrap(code: string, text: string): string {
  if (!supportsColor()) {
    return text;
  }

  return `${code}${text}${ANSI.reset}`;
}

function line(text: string): string {
  if (!supportsColor()) {
    return text;
  }

  return `${ANSI.default}${text}${ANSI.reset}`;
}

function defaultColor(text: string): string {
  return wrap(ANSI.default, text);
}

function highlight(text: string): string {
  return wrap(ANSI.highlight, text);
}

function dim(text: string): string {
  return wrap(ANSI.dim, text);
}

function info(text: string): string {
  return wrap(ANSI.info, text);
}

function warning(text: string): string {
  return wrap(ANSI.warning, text);
}

function danger(text: string): string {
  return wrap(ANSI.danger, text);
}

function success(text: string): string {
  return wrap(ANSI.success, text);
}

export const colors = {
  line,
  default: defaultColor,
  highlight,
  dim,
  info,
  warning,
  danger,
  success,
};
