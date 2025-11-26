import assert from 'assert';
import { spawn, type StdioOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';

const routes = process.env.PATH?.split(path.delimiter) ?? [];

// Commands Enum
enum CommandsEnum {
    ECHO = 'echo',
    TYPE = 'type',
    PWD = 'pwd',
    CD = 'cd',
    EXIT = 'exit',
}

const commands = new Set<string>();
commands.add(CommandsEnum.ECHO);
commands.add(CommandsEnum.TYPE);
commands.add(CommandsEnum.PWD);
commands.add(CommandsEnum.CD);
commands.add(CommandsEnum.EXIT);

type TokenType = 'WORD' | 'PIPE' | 'REDIRECT' | 'QUOTED_STRING' | 'PATH';

interface Token {
	type: TokenType;
	value: string;
}

// Readline interface
const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
    completer: (line: string) => {      
        if(commands.has(line)) return [line, line];
        const completions = ['echo', 'exit', 'type', 'pwd', 'cd'];
        const hits = completions.filter(c => c.startsWith(line)).map(c => c + ' ');
                
        // If command is not known ring a bell
        if(hits.length === 0) process.stdout.write('\x07');        

        return [hits, line];
    }
});

// - Specific helpers - //
const ESCAPABLE_IN_DOUBLE_QUOTES = ['"', '$', '\\', '`'];
export const isSingleQuote = (c: string) => c === "'";
export const isDoubleQuote = (c: string) => c === '"';
export const isBackslash = (c: string) => c === '\\';
export const isAppend = (c: string) => c === '1>>' || c === '2>>' || c === '>>';
export const isRedirect = (c: string) => c === '1>' || c === '2>' || c === '>';
export const isEscapableInDoubleQuote = (c: string) => ESCAPABLE_IN_DOUBLE_QUOTES.includes(c);

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
		const c = line[i];
		const next = line[i + 1];
        const nextForward = line[i + 2];
        const twoChars = c + next;
        const threeChar = c + next + nextForward;

		// Normal case
		if (state == CaracterStateEnum.NORMAL) {
			// Is single quote
			if (isSingleQuote(c)) {
				state = CaracterStateEnum.INSIDE_SINGLE_QUOTE;
				continue;
			}

			// Is double quote
			if (isDoubleQuote(c)) {
				state = CaracterStateEnum.INSIDE_DOUBLE_QUOTE;
				continue;
			}

			// Is Backslash \
			if (isBackslash(c)) {
				state = CaracterStateEnum.BACKSLASH_OUTSIDE_QUOTES;
				continue;
			}

            /** We verify always the longest pattern before the sortes because we process character to character */

            // Is Number with double Greather than 1>> | 2>> (append)
            if (isAppend(threeChar)) {
				tokens.push({ type: 'REDIRECT', value: threeChar});
				i += 2
				continue;
			}
            
            // Is double Greather than >> 
			if (isAppend(twoChars) || isRedirect(twoChars)) {
				tokens.push({ type: 'REDIRECT', value: twoChars });
                i++
				continue;
			}
           
			// Is Greather than >
			if (isRedirect(c)) {
				tokens.push({ type: 'REDIRECT', value: c });
				continue;
			}  
			
			if (c === ' ') {
				if (current.length > 0) {
					tokens.push({
						type: 'WORD',
						value: current,
					});
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

            // If current char is backslash and next char can be escaped inside double quotes
			if (isBackslash(c) && isEscapableInDoubleQuote(next)) {
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
		tokens.push({
			type: 'WORD',
			value: current,
		});
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
		const redirectToken = splittedCommands.filter(
			(item) => item.type === 'REDIRECT'
		);
		const includeRedirect = redirectToken
			.map((item) => item.type)
			.includes('REDIRECT');

		// Built in Commands
		if (commands.has(firstCommand.value) && !includeRedirect) {
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

		// If is redirect
        if (includeRedirect) {
            // Parse redirection type and destination
            const redirectOp = redirectToken[0].value;
            const outputPath = restCommand[restCommand.length - 1];
            
            // Determine redirection behavior
            const isStderrRedirect = redirectOp === '2>' || redirectOp === '2>>';
            const isAppendMode = redirectOp.includes('>>');
            
            // Extract command arguments (everything before redirect operator)
            const redirectIndex = restCommand.findIndex(t => 
                ['>', '1>', '2>', '>>', '1>>', '2>>'].includes(t)
            );
            const args = restCommand.slice(0, redirectIndex);
            
            // Setup output file
            const outputDir = path.dirname(outputPath);
            fs.mkdirSync(outputDir, { recursive: true });
            const outputStream = fs.createWriteStream(
                outputPath, 
                isAppendMode ? { flags: 'a' } : undefined
            );
            
            // Spawn with appropriate stdio configuration
            const stdioConfig: StdioOptions = isStderrRedirect 
                ? ['inherit', 'inherit', 'pipe']  // Pipe stderr
                : ['inherit', 'pipe', 'inherit']; // Pipe stdout
            
            const child = spawn(firstCommand.value, args, { stdio: stdioConfig });
            
            // Pipe the appropriate stream to output file
            if (isStderrRedirect) {
                child.stderr?.pipe(outputStream);
            } else {
                child.stdout?.pipe(outputStream);
            }
            
            outputStream.on('finish', () => {
                ask();
            });
            
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
