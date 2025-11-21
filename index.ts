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

// Helper functions
function isLetterAscii(character: string) {
	const code = character.charCodeAt(0);
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSingleQuoteAscii(character: string) {
	const code = character.charCodeAt(0);
	return code === 39;
}

function isDoubleQuoteAscii(character: string) {
	const code = character.charCodeAt(0);
	return code === 34;
}

function isBackslash(character: string) {
	const code = character.charCodeAt(0);
	return code === 92;
}

enum CaracterStateEnum {
	NORMAL = 'NORMAL',
	INSIDE_SINGLE_QUOTE = 'INSIDE_SINGLE_QUOTE',
	INSIDE_DOUBLE_QUOTE = 'INSIDE_DOUBLE_QUOTE',
	BACKSLASH_OUTSIDE_QUOTES = 'BACKSLASH_OUTSIDE_QUOTES',
}
function splitCommandLine(line: string): Token[] {
	let tokens: Token[] = [];

	// Store the final parsed arguments
	let args: string[] = [];
	// Accumulates characters for the current argument
	let current = '';

	let state: CaracterStateEnum = CaracterStateEnum.NORMAL;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];

		if (state == CaracterStateEnum.NORMAL) {
			// Change state to Single Quote
			if (isSingleQuoteAscii(c)) {
				state = CaracterStateEnum.INSIDE_SINGLE_QUOTE;
				continue;
			}

			if (isDoubleQuoteAscii(c)) {
				state = CaracterStateEnum.INSIDE_DOUBLE_QUOTE;
				continue;
			}

			if (isBackslash(c)) {
				state = CaracterStateEnum.BACKSLASH_OUTSIDE_QUOTES;
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

		if (state == CaracterStateEnum.INSIDE_SINGLE_QUOTE) {
			// Identify that is closing single quote so change state
			if (isSingleQuoteAscii(c)) {
				state = CaracterStateEnum.NORMAL;
				continue;
			}
			current += c;
		}

		if (state == CaracterStateEnum.INSIDE_DOUBLE_QUOTE) {
			// Identify that is closing single quote so change state
			if (isDoubleQuoteAscii(c)) {
				state = CaracterStateEnum.NORMAL;
				continue;
			}
			current += c;
		}

		if (state == CaracterStateEnum.BACKSLASH_OUTSIDE_QUOTES) {
			state = CaracterStateEnum.NORMAL;
			current += c;
			continue;
		}
	}

	if (current.length > 0) {
		args.push(current);
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
		// Checking first command to know if is a built-in command
		const firstCommand = splittedCommands[0];
		const restCommand = splittedCommands.slice(1).map((item) => item.value);
		if (commands.has(firstCommand.value)) {
			// Built in
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
