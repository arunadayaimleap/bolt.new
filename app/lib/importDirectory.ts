import { WebContainer } from '@webcontainer/api';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ImportDirectory');

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

    // Clear existing files in the container
    await webcontainer.fs.rm('/', { recursive: true, force: true }).catch(() => {
      // Ignore if directory doesn't exist
    });

    // Import files into the container
    await importDirectoryContents(directoryHandle, webcontainer, '/');

    // Run npm install
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

    // Start the project
    const startProcess = await webcontainer.spawn('npm', ['start']);
    startProcess.output.pipeTo(new WritableStream({
      write(data) {
        logger.debug(`npm start: ${data}`);
      },
    }));

    logger.debug('Project started successfully');
    return true;
  } catch (error) {
    logger.error('Failed to import local directory', error);
    throw error;
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
    // Skip node_modules and .git directories to speed up import
    if (name === 'node_modules' || name === '.git') {
      continue;
    }

    const path = `${currentPath}/${name}`;

    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      const contents = await file.arrayBuffer();
      await webcontainer.fs.writeFile(path, new Uint8Array(contents));
      logger.debug(`Imported file: ${path}`);
    } else if (handle.kind === 'directory') {
      await webcontainer.fs.mkdir(path, { recursive: true });
      await importDirectoryContents(handle as FileSystemDirectoryHandle, webcontainer, path);
    }
  }
}
