export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class NotImplementedCliError extends CliError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet.`);
    this.name = "NotImplementedCliError";
  }
}
