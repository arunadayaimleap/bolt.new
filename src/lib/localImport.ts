import { WebContainer } from '@webcontainer/api';
import { WORK_DIR } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('LocalImport');

export async function importLocalDirectory(webcontainer: WebContainer) {
  try {
    // Show directory picker
    if (!window.showDirectoryPicker) {
      throw new Error('The showDirectoryPicker API is not supported in this environment.');
    }
    const directoryHandle = await window.showDirectoryPicker({
      mode: 'read',
    });

    // Start loading process
    const packageJsonFile = await findPackageJson(directoryHandle);
    if (!packageJsonFile) {
      throw new Error('No package.json found in the selected directory');
    }

    // Clear existing files
    await webcontainer.fs.rm(WORK_DIR, { recursive: true, force: true }).catch(() => {
      // Ignore if directory doesn't exist
    });
    await webcontainer.fs.mkdir(WORK_DIR, { recursive: true });

    // Import files
    await importDirectoryContents(directoryHandle, webcontainer, WORK_DIR);
    
    logger.debug('Files imported successfully, running npm install...');
    
    // Run npm install
    const installProcess = await webcontainer.spawn('npm', ['install'], {
      cwd: WORK_DIR,
    });
    
    const installOutput: string[] = [];
    installProcess.output.pipeTo(new WritableStream({
      write(data) {
        installOutput.push(data);
        logger.debug(`npm install: ${data}`);
      }
    }));

    // Wait for install to complete
    const installExitCode = await installProcess.exit;
    
    if (installExitCode !== 0) {
      throw new Error(`npm install failed with exit code ${installExitCode}`);
    }
    
    logger.debug('npm install completed successfully, starting project...');
    
    // Determine and run the start script from package.json
    const startCmd = await determineStartCommand(webcontainer);
    if (!startCmd) {
      throw new Error('Unable to determine how to start the project. Check package.json for a start script.');
    }
    
    // Launch the application
    const startProcess = await webcontainer.spawn(startCmd.command, startCmd.args, {
      cwd: WORK_DIR,
    });
    
    // Log the output of the start command
    startProcess.output.pipeTo(new WritableStream({
      write(data) {
        logger.debug(`npm start: ${data}`);
      }
    }));
    
    // Don't wait for this process to complete as it will keep running
    
    return true;
  } catch (error) {
    logger.error('Failed to import local directory', error);
    throw error;
  }
}

// Helper to determine the start command from package.json
async function determineStartCommand(webcontainer: WebContainer): Promise<{command: string, args: string[]} | null> {
  try {
    const packageJsonContent = await webcontainer.fs.readFile(`${WORK_DIR}/package.json`, 'utf-8');
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
  for await (const [name, handle] of directoryHandle.entries()) {
    if (name === 'package.json' && handle.kind === 'file') {
      return await (handle as FileSystemFileHandle).getFile();
    }
  }
  return null;
}

async function importDirectoryContents(
  directoryHandle: FileSystemDirectoryHandle,
  webcontainer: WebContainer,
  currentPath: string
) {
  for await (const [name, handle] of directoryHandle.entries()) {
    // Skip node_modules and .git directories
    if (name === 'node_modules' || name === '.git') {
      continue;
    }

    const path = `${currentPath}/${name}`;

    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      
      // Handle binary files
      const contents = await file.arrayBuffer();
      await webcontainer.fs.writeFile(path, new Uint8Array(contents));
      
      logger.debug(`Imported file: ${path}`);
    } else if (handle.kind === 'directory') {
      await webcontainer.fs.mkdir(path, { recursive: true });
      await importDirectoryContents(handle as FileSystemDirectoryHandle, webcontainer, path);
    }
  }
}
