import { isAbsolute, relative, resolve } from "node:path";

const FIXTURE_ROOT = resolve(import.meta.dir, "..", "fixtures");

function resolveFixture(fixturePath: string): string {
  const path = resolve(FIXTURE_ROOT, fixturePath);
  const relativePath = relative(FIXTURE_ROOT, path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Fixture path is outside the fixture directory: ${fixturePath}`);
  }
  return path;
}

export async function loadFixture<T>(fixturePath: string): Promise<T> {
  return (await Bun.file(resolveFixture(fixturePath)).json()) as T;
}

export async function loadFixtureText(fixturePath: string): Promise<string> {
  return Bun.file(resolveFixture(fixturePath)).text();
}
