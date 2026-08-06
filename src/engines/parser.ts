import { CommandAST } from '../shared/types';

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      currentToken += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
      continue;
    }

    if (char === ' ' && !inDoubleQuotes && !inSingleQuotes) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = '';
      }
    } else {
      currentToken += char;
    }
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  return tokens;
}

export function parseCommand(input: string): CommandAST | null {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) {
    return null;
  }

  const command = tokens[0];
  let subcommand: string | undefined;
  const args: string[] = [];
  const flags: string[] = [];
  const options: Record<string, string> = {};

  const commandsWithSubcommands = ['git', 'npm', 'docker'];
  let startIndex = 1;

  if (commandsWithSubcommands.includes(command) && tokens.length > 1) {
    const maybeSub = tokens[1];
    if (!maybeSub.startsWith('-')) {
      subcommand = maybeSub;
      startIndex = 2;
    }
  }

  for (let i = startIndex; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith('-')) {
      if (token.includes('=')) {
        const eqIdx = token.indexOf('=');
        const key = token.substring(0, eqIdx);
        const val = token.substring(eqIdx + 1);
        options[key] = val;
        continue;
      }

      const isMultiFlag = token.startsWith('-') && !token.startsWith('--') && token.length > 2;
      const nextToken = tokens[i + 1];
      const hasValue = nextToken !== undefined && !nextToken.startsWith('-');

      if (hasValue && !isMultiFlag) {
        options[token] = nextToken;
        i++;
      } else {
        if (isMultiFlag) {
          for (let j = 1; j < token.length; j++) {
            flags.push(`-${token[j]}`);
          }
        } else {
          flags.push(token);
        }
      }
    } else {
      args.push(token);
    }
  }

  return {
    command,
    subcommand,
    args,
    flags,
    options,
  };
}
