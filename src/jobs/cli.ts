import type { SourceName } from '../domain/types.js';

export function parseCliArgs(args: string[]) {
  const value = (name: string) =>
    args
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  const source = value('source');
  const profile = value('profile');
  if (source && !['otomoto', 'olx', 'allegro'].includes(source)) {
    throw new Error(`Unsupported source: ${source}`);
  }
  return {
    skipAi: args.includes('--skip-ai'),
    ...(source ? { source: source as SourceName } : {}),
    ...(profile ? { profile } : {}),
  };
}
