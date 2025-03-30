import { WebContainer } from '@webcontainer/api';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ImportDirectory');

// Files and directories to skip during import
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.cache',
  '.DS_Store',
  'coverage',
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
];

export async function importLocalDirectory(webcontainer: WebContainer) {
  try {
    // Show directory picker
    if (!window.showDirectoryPicker) {
      throw new Error('The showDirectoryPicker API is not supported in this environment.');
    }
    
    const directoryHandle = await window.showDirectoryPicker({
      mode: 'read',
    });

    logger.debug('Directory selected');

    // Check for package.json
    const packageJsonFile = await findPackageJson(directoryHandle);
    if (!packageJsonFile) {
      throw new Error('No package.json found in the selected directory');
    }

    // Try to read .gitignore if it exists
    const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS];
    try {
      const gitignoreHandle = await findFile(directoryHandle, '.gitignore');
      if (gitignoreHandle) {
        const gitignoreFile = await gitignoreHandle.getFile();
        const gitignoreContent = await gitignoreFile.text();
        const gitignorePatterns = parseGitignore(gitignoreContent);
        ignorePatterns.push(...gitignorePatterns);
        logger.debug('.gitignore found and parsed. Added patterns:', gitignorePatterns);
      }
    } catch (error) {
      logger.debug('No .gitignore found or error parsing it:', error);
    }

    // Clear existing files in the container
    await webcontainer.fs.rm('/', { recursive: true, force: true }).catch(() => {
      // Ignore if directory doesn't exist
    });

    // Import files into the container 
    logger.debug('Importing project files (skipping ignored patterns)...');
    await importDirectoryContents(directoryHandle, webcontainer, '/', ignorePatterns);
    logger.debug('Files imported successfully');

    // At this point, the chat UI should already be in chat mode
    // Run npm install
    logger.debug('Running npm install...');
    const installProcess = await webcontainer.spawn('npm', ['install']);
    installProcess.output.pipeTo(new WritableStream({
      write(data) {
        logger.debug(`npm install: ${data}`);
      },
    }));

    const installExitCode = await installProcess.exit;
    if (installExitCode !== 0) {
      throw new Error(`npm install failed with exit code ${installExitCode}`);
    }
    logger.debug('npm install completed successfully');

    // Determine best start command based on package.json
    const startCmd = await determineStartCommand(webcontainer);
    if (!startCmd) {
      throw new Error('Unable to determine how to start the project. Check package.json for a start script.');
    }
    
    // Start the project
    logger.debug(`Starting project with: ${startCmd.command} ${startCmd.args.join(' ')}`);
    const startProcess = await webcontainer.spawn(startCmd.command, startCmd.args);
    startProcess.output.pipeTo(new WritableStream({
      write(data) {
        logger.debug(`Project output: ${data}`);
      },
    }));

    logger.debug('Project started successfully');
    return true;
  } catch (error) {
    logger.error('Failed to import local directory', error);
    throw error;
  }
}

// Parse .gitignore content into an array of patterns
function parseGitignore(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(pattern => {
      // Remove leading slashes for our matching purposes
      return pattern.startsWith('/') ? pattern.substring(1) : pattern;
    });
}

// Helper to determine the start command from package.json
async function determineStartCommand(webcontainer: WebContainer): Promise<{command: string, args: string[]} | null> {
  try {
    const packageJsonContent = await webcontainer.fs.readFile('/package.json', 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    
    if (packageJson.scripts && packageJson.scripts.start) {
      return { command: 'npm', args: ['run', 'start'] };
    } else if (packageJson.scripts && packageJson.scripts.dev) {
      return { command: 'npm', args: ['run', 'dev'] };
    } else if (packageJson.scripts && packageJson.scripts.serve) {
      return { command: 'npm', args: ['run', 'serve'] };
    } else {
      // Default fallback if no standard scripts are found
      logger.warn('No standard start script found in package.json.');
      return { command: 'npm', args: ['start'] };
    }
  } catch (error) {
    logger.error('Error determining start command:', error);
    return null;
  }
}

async function findPackageJson(directoryHandle: FileSystemDirectoryHandle): Promise<File | null> {
  return await findFile(directoryHandle, 'package.json');
}

async function findFile(directoryHandle: FileSystemDirectoryHandle, filename: string): Promise<File | null> {
  for await (const [name, handle] of directoryHandle.entries()) {
    if (name === filename && handle.kind === 'file') {
      return await (handle as FileSystemFileHandle).getFile();
    }
  }
  return null;
}

// Check if a file/directory should be ignored based on gitignore patterns
function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
  
  for (const pattern of ignorePatterns) {
    // Simple exact match
    if (normalizedPath === pattern) return true;
    
    // Directory wildcard (e.g., "dist/")
    if (pattern.endsWith('/') && normalizedPath.startsWith(pattern)) return true;
    
    // File extension wildcard (e.g., "*.log")
    if (pattern.startsWith('*.')) {
      const ext = pattern.substring(1); // Get ".log" from "*.log"
      if (normalizedPath.endsWith(ext)) return true;
    }
    
    // Simple wildcard prefix/suffix (e.g., "npm-debug.log*")
    if (pattern.endsWith('*')) {
      const prefix = pattern.substring(0, pattern.length - 1);
      if (normalizedPath.startsWith(prefix)) return true;
    }
  }
  
  return false;
}

async function importDirectoryContents(
  directoryHandle: FileSystemDirectoryHandle,
  webcontainer: WebContainer,
  currentPath: string,
  ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS
) {
  for await (const [name, handle] of directoryHandle.entries()) {
    const path = `${currentPath}${name}`;
    
    // Skip files/directories that match ignore patterns
    if (shouldIgnore(path, ignorePatterns)) {
      logger.debug(`Skipping ignored path: ${path}`);
      continue;
    }

    if (handle.kind === 'file') {
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const contents = await file.arrayBuffer();
        await webcontainer.fs.writeFile(path, new Uint8Array(contents));
        logger.debug(`Imported file: ${path}`);
      } catch (error) {
        logger.warn(`Error importing file ${path}:`, error);
      }
    } else if (handle.kind === 'directory') {
      await webcontainer.fs.mkdir(path, { recursive: true });
      await importDirectoryContents(handle as FileSystemDirectoryHandle, webcontainer, `${path}/`, ignorePatterns);
    }
  }
}
