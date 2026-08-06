import { describe, expect, it } from 'vitest';
import { parseCommand, tokenize } from '../parser';

describe('Command Parser Lexer', () => {
  it('should tokenize arguments separated by spaces', () => {
    expect(tokenize('mkdir test-dir')).toEqual(['mkdir', 'test-dir']);
  });

  it('should preserve quoted spaces', () => {
    expect(tokenize('git commit -m "initial commit statement"')).toEqual([
      'git',
      'commit',
      '-m',
      'initial commit statement',
    ]);
  });

  it('should parse command AST with flags and options', () => {
    const ast = parseCommand('git commit -m "second commit" --amend -a');
    expect(ast).toEqual({
      command: 'git',
      subcommand: 'commit',
      args: [],
      flags: ['--amend', '-a'],
      options: {
        '-m': 'second commit',
      },
    });
  });

  it('should expand short multi-flags', () => {
    const ast = parseCommand('ls -la');
    expect(ast).toEqual({
      command: 'ls',
      subcommand: undefined,
      args: [],
      flags: ['-l', '-a'],
      options: {},
    });
  });
});
