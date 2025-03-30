// File System Access API types
interface Window {
  showDirectoryPicker?: (options?: { mode: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandle {
  kind: 'directory';
  entries(): AsyncIterable<[string, FileSystemHandle]>;
}

interface FileSystemFileHandle {
  kind: 'file';
  getFile(): Promise<File>;
}

type FileSystemHandle = FileSystemDirectoryHandle | FileSystemFileHandle;
