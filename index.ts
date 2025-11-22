import assert from 'assert';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';

const routes = process.env.PATH?.split(path.delimiter) ?? [];

// Commands Enum

type TokenType = 'WORD' | 'PIPE' | 'REDIRECT' | 'QUOTED_STRING';

interface Token {
	type: TokenType;
	value: string;
}

enum CommandsEnum {
	ECHO = 'echo',
	TYPE = 'type',
	PWD = 'pwd',
	CD = 'cd',
	EXIT = 'exit',
}

// Readline interface
const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
});

// - Character ASCII constants - //
export const CHAR_CODES = {
	SINGLE_QUOTE: 39, // '
	DOUBLE_QUOTE: 34, // "
	BACKSLASH: 92, // \
	DOLLAR: 36, // $
	BACKTICK: 96, // `
	GREATHER_THAN: 62, // >
	UPPERCASE_A_Z: { MIN: 65, MAX: 90 },
	LOWERCASE_A_Z: { MIN: 97, MAX: 122 },
} as const;

// - Generic checker - //
export function isAsciiChar(character: string, asciiCode: number): boolean {
	return character.charCodeAt(0) === asciiCode;
}
export function isAsciiInRange(
	code: number,
	range: { MIN: number; MAX: number }
): boolean {
	return code >= range.MIN && code <= range.MAX;
}

// - Specific helpers - //
export const isSingleQuote = (c: string) =>
	isAsciiChar(c, CHAR_CODES.SINGLE_QUOTE);

export const isDoubleQuote = (c: string) =>
	isAsciiChar(c, CHAR_CODES.DOUBLE_QUOTE);

export const isBackslash = (c: string) => isAsciiChar(c, CHAR_CODES.BACKSLASH);

export function isLetterAscii(character: string): boolean {
	const code = character.charCodeAt(0);

	return (
		isAsciiInRange(code, CHAR_CODES.UPPERCASE_A_Z) ||
		isAsciiInRange(code, CHAR_CODES.LOWERCASE_A_Z)
	);
}

enum CaracterStateEnum {
	NORMAL = 'NORMAL',
	INSIDE_SINGLE_QUOTE = 'INSIDE_SINGLE_QUOTE',
	INSIDE_DOUBLE_QUOTE = 'INSIDE_DOUBLE_QUOTE',
	BACKSLASH_OUTSIDE_QUOTES = 'BACKSLASH_OUTSIDE_QUOTES',
	BACKSLASH_INSIDE_QUOTES = 'BACKSLASH_INSIDE_QUOTES',
	REDIRECT = 'REDIRECT',
}

function splitCommandLine(line: string): Token[] {
	// Tokenize the information of the command to know which structure do we have
	let tokens: Token[] = [];
	// Accumulates characters for the current argument
	let current = '';

	let state: CaracterStateEnum = CaracterStateEnum.NORMAL;
	for (let i = 0; i < line.length; i++) {
		const next = line[i + 1];
		const c = line[i];

		// Normal case
		if (state == CaracterStateEnum.NORMAL) {
			// Is single quote
			if (isAsciiChar(c, CHAR_CODES.SINGLE_QUOTE)) {
				state = CaracterStateEnum.INSIDE_SINGLE_QUOTE;
				continue;
			}

			// Is double quote
			if (isAsciiChar(c, CHAR_CODES.DOUBLE_QUOTE)) {
				state = CaracterStateEnum.INSIDE_DOUBLE_QUOTE;
				continue;
			}

			// Is Backslash
			if (isAsciiChar(c, CHAR_CODES.BACKSLASH)) {
				state = CaracterStateEnum.BACKSLASH_OUTSIDE_QUOTES;
				continue;
			}

			// Is Greather than
			if (isAsciiChar(c, CHAR_CODES.GREATHER_THAN)) {
				tokens.push({ type: 'REDIRECT', value: c });
				continue;
			}

			if (c === ' ') {
				if (current.length > 0) {
					tokens.push({ type: 'WORD', value: current });
					current = '';
				}
				continue;
			}

			current += c;
		}

		// Inside Single Quote
		if (state == CaracterStateEnum.INSIDE_SINGLE_QUOTE) {
			// Identify that is closing single quote so change state
			if (isSingleQuote(c)) {
				state = CaracterStateEnum.NORMAL;
				continue;
			}

			current += c;
		}

		// Inside Double Quote
		if (state == CaracterStateEnum.INSIDE_DOUBLE_QUOTE) {
			// Identify that is closing single quote so change state
			if (isDoubleQuote(c)) {
				state = CaracterStateEnum.NORMAL;
				continue;
			}

			if (
				isBackslash(c) &&
				(isAsciiChar(next, CHAR_CODES.DOUBLE_QUOTE) ||
					isAsciiChar(next, CHAR_CODES.DOLLAR) ||
					isAsciiChar(next, CHAR_CODES.BACKSLASH) ||
					isAsciiChar(next, CHAR_CODES.BACKTICK))
			) {
				state = CaracterStateEnum.BACKSLASH_INSIDE_QUOTES;
				continue;
			}
			current += c;
		}

		// Backslash outside quotes
		if (state == CaracterStateEnum.BACKSLASH_OUTSIDE_QUOTES) {
			state = CaracterStateEnum.NORMAL;
			current += c;
			continue;
		}

		// Backslash inside quotes
		if (state == CaracterStateEnum.BACKSLASH_INSIDE_QUOTES) {
			state = CaracterStateEnum.INSIDE_DOUBLE_QUOTE;
			current += c;
			continue;
		}
	}

	if (current.length > 0) {
		tokens.push({ type: 'WORD', value: current });
	}

	return tokens;
}

// Commands callbacks actions
function notFoundCommand(command: string) {
	console.log(`${command}: not found`);
}

function handleEchoCommand(args: string[]) {
	console.log(args.join(' '));
}

function getExecutableRoute(fullPath: string): string | null {
	try {
		fs.accessSync(fullPath, fs.constants.X_OK);
		return fullPath;
	} catch (error) {
		return null;
	}
}

function findExecutableInPath(command: string): string | null {
	for (const route of routes) {
		const fullPath = path.join(route, command);
		if (fs.existsSync(fullPath)) {
			const executableRoute = getExecutableRoute(fullPath);
			if (executableRoute) {
				return executableRoute;
			}
		}
	}

	return null;
}

function normalizePath(inputPath: string): string {
	// Detect the OS separator
	const sep = path.sep; // '/' o '\'

	// If use '\' (windows), replace it '/' for '\'
	// iF USE '/', replace '\' for '/'
	const wrongSep = sep === '/' ? '\\' : '/';
	const fixedPath = inputPath.replace(new RegExp(`\\${wrongSep}`, 'g'), sep);

	return fixedPath;
}

function handleCDCommand(absolutePath: string) {
	// the caracter '~' that is a shorthand for the home directory
	if (absolutePath.trimStart().charCodeAt(0) === 126) {
		const home = process.env.HOME || process.env.USERPROFILE;
		assert(home, 'cd: HOME no definido');
		process.chdir(home);
		return;
	}
	// Normalize path
	let resolvedPath = normalizePath(absolutePath);

	// Check if is an absolute path
	resolvedPath = path.isAbsolute(resolvedPath)
		? resolvedPath
		: path.resolve(process.cwd(), resolvedPath);

	// If the path exist and is directory we change the current working directory
	if (
		fs.existsSync(resolvedPath) &&
		fs.lstatSync(resolvedPath).isDirectory()
	) {
		process.chdir(resolvedPath);
		return;
	}

	console.log(`cd: no such file or directory: ${absolutePath}`);
}

function hadnleTypeCommand(command: string) {
	const executableRoute = findExecutableInPath(command);
	if (executableRoute) {
		console.log(`${command} is ${executableRoute}`);
		return;
	}

	notFoundCommand(command);
}

const commands = new Set<string>();
commands.add(CommandsEnum.ECHO);
commands.add(CommandsEnum.TYPE);
commands.add(CommandsEnum.PWD);
commands.add(CommandsEnum.CD);
commands.add(CommandsEnum.EXIT);

function ask(): void {
	let currentWorkspaceDirectory = process.cwd();
	rl.question('$ ', (command) => {
		if (command == 'exit 0') {
			rl.close();
			return;
		}

		const splittedCommands = splitCommandLine(command);
		const firstCommand = splittedCommands[0];
		const restCommand = splittedCommands.slice(1).map((item) => item.value);

		// Built in Commands
		if (commands.has(firstCommand.value)) {
			switch (firstCommand.value) {
				case CommandsEnum.ECHO:
					handleEchoCommand(restCommand);
					break;
				case CommandsEnum.TYPE:
					commands.has(restCommand.join().trim())
						? console.log(`${restCommand} is a shell builtin`)
						: hadnleTypeCommand(restCommand.join().trim());
					break;
				case CommandsEnum.PWD:
					console.log(currentWorkspaceDirectory);
					break;
				case CommandsEnum.CD:
					handleCDCommand(restCommand.join(' '));
					break;
				case CommandsEnum.EXIT:
					rl.close();
					return;
			}

			ask();
			return;
		}

		const executablePath = findExecutableInPath(firstCommand.value);
		if (executablePath) {
			const child = spawn(firstCommand.value, restCommand, {
				stdio: 'inherit',
			});
			child.on('close', () => {
				ask();
			});
			return;
		}

		// Not found
		notFoundCommand(firstCommand.value);

		// Ask again
		ask();
	});
}

ask();
