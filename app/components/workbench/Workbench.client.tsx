import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  const isProjectImport = useStore(
    computed([workbenchStore.previews], 
      function isImportMode() {
        return Boolean(
          (window as any).__PROJECT_IMPORT_MODE__ === true || 
          sessionStorage.getItem('currentMode') === 'project-import'
        );
      }
    )
  );

  const effectiveChatStarted = Boolean(chatStarted || isProjectImport);

  // Restore files from local storage on initial load
  useEffect(() => {
    try {
      const storedFilesMeta = localStorage.getItem('importedProjectMeta');
      
      if (storedFilesMeta) {
        const meta = JSON.parse(storedFilesMeta);
        console.log("Found stored project metadata:", meta);
        
        // Only attempt to restore if project has actually been processed
        if (meta.hasProcessedFiles && meta.projectRoot) {
          // Check if files already exist in the workbench
          const currentFiles = workbenchStore.files.get();
          const fileCount = Object.keys(currentFiles).length;
          
          // Only show restoration UI if we don't already have files loaded
          if (fileCount <= 1) { // Allow for possible /home/project directory
            console.log(`Project appears to need restoration, showing UI`);
            (window as any).__PROJECT_IMPORT_MODE__ = true;
            workbenchStore.showWorkbench.set(true);
            toast.info("Previous project detected. Use 'Restore Project' in the chat to reload it.");
          } else {
            console.log(`Project already has ${fileCount} files loaded, no restoration needed`);
          }
        }
      }
    } catch (err) {
      console.error("Error checking project state:", err);
    }
  }, []);

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  useEffect(() => {
    console.log('Workbench visibility:', showWorkbench);
  }, [showWorkbench]);

  useEffect(() => {
    const handleImportedFiles = (event: Event) => {
      const customEvent = event as CustomEvent<File[]>;
      const importedFiles = customEvent.detail;

      if (importedFiles && importedFiles.length > 0) {
        console.log(`Processing ${importedFiles.length} imported files`);
        
        // Explicitly force the workbench to be visible regardless of current state
        workbenchStore.showWorkbench.set(true);
        console.log("Workbench visibility explicitly set to TRUE");

        // Set import mode flag
        (window as any).__PROJECT_IMPORT_MODE__ = true;

        const processFiles = async () => {
          const processedFiles: Record<string, any> = {};
          let hasPackageJson = false;
          let packageJsonContent: Record<string, any> | null = null;
          let packageJsonPath = '';
          
          // Extract the project root folder name from the first file
          const firstFile = importedFiles[0];
          const projectFolderName = firstFile.webkitRelativePath.split('/')[0];
          
          // WebContainer ALWAYS uses Unix-style paths, so we'll stick with that format
          const projectRoot = `/home/project/${projectFolderName}`;
          
          console.log(`Using project root: ${projectRoot}`);
          
          try {
            // Store metadata about this project for persistence
            localStorage.setItem('importedProjectMeta', JSON.stringify({
              timestamp: Date.now(),
              projectRoot,
              hasPackageJson: false,
              hasProcessedFiles: false
            }));
            
            // Try to get a webcontainer instance
            const webcontainerInstance = (window as any).webcontainerInstance;
            
            // Explicitly make the base project directory
            try {
              if (webcontainerInstance && webcontainerInstance.fs) {
                await webcontainerInstance.fs.mkdir('/home/project', { recursive: true });
                console.log("Ensured base project directory exists");
              }
            } catch (e) {
              console.log("Base directory likely exists already:", e);
            }
            
            // Process all files first, prepare data structures
            const directories = new Set<string>();
            const fileContents: Record<string, string> = {};
            
            // Collect all files and directories first
            for (const file of importedFiles) {
              try {
                const content = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = (e) => resolve(e.target?.result as string);
                  reader.readAsText(file);
                });
                
                const relativePath = file.webkitRelativePath;
                const filePath = `/home/project/${relativePath}`;
                
                // Store file content for later processing
                fileContents[filePath] = content;
                
                // Collect directories
                const parts = filePath.split('/');
                parts.pop(); // Remove the filename
                
                let dirPath = '';
                for (let i = 1; i < parts.length; i++) {
                  dirPath += '/' + parts[i];
                  directories.add(dirPath);
                }
                
                // Check for package.json
                if (file.name === 'package.json') {
                  hasPackageJson = true;
                  packageJsonPath = filePath;
                  
                  try {
                    packageJsonContent = JSON.parse(content);
                    console.log("Parsed package.json:", packageJsonContent);
                  } catch (e) {
                    console.error("Error parsing package.json:", e);
                  }
                }
              } catch (error) {
                console.error(`Error reading file ${file.name}:`, error);
              }
            }
            
            // Update metadata after finding package.json
            if (hasPackageJson) {
              try {
                const meta = JSON.parse(localStorage.getItem('importedProjectMeta') || '{}');
                meta.hasPackageJson = true;
                meta.packageJsonPath = packageJsonPath;
                localStorage.setItem('importedProjectMeta', JSON.stringify(meta));
              } catch (e) {
                console.warn("Could not update project metadata:", e);
              }
            }
            
            // Create new processed files collection
            const processedFiles: Record<string, any> = {};
            
            // Create all directories in order (important for the file system)
            const sortedDirs = Array.from(directories).sort((a, b) => a.split('/').length - b.split('/').length);
            
            // Start with a clean slate - clear existing files
            workbenchStore.files.set({});
            
            // Add all directories to processed files
            for (const dir of sortedDirs) {
              processedFiles[dir] = {
                content: '',
                path: dir,
                name: dir.split('/').pop() || '',
                type: 'directory',
              };
              
              // Create actual directories if webcontainer available
              if (webcontainerInstance && webcontainerInstance.fs) {
                try {
                  await webcontainerInstance.fs.mkdir(dir, { recursive: true });
                  console.log(`Created directory: ${dir}`);
                } catch (e) {
                  console.warn(`Error creating directory ${dir}:`, e);
                }
              }
            }
            
            // Now add all files 
            for (const [filePath, content] of Object.entries(fileContents)) {
              processedFiles[filePath] = {
                content,
                path: filePath,
                name: filePath.split('/').pop() || '',
                type: 'file',
              };
              
              // Actually write to filesystem if webcontainer available
              if (webcontainerInstance && webcontainerInstance.fs) {
                try {
                  await webcontainerInstance.fs.writeFile(filePath, content);
                  console.log(`Wrote file: ${filePath}`);
                } catch (e) {
                  console.error(`Error writing file ${filePath}:`, e);
                }
              }
            }
            
            // Update the workbench with all files and directories
            console.log(`Updating workbench with ${Object.keys(processedFiles).length} items`);
            workbenchStore.files.set(processedFiles);
            
            // Mark as processed in metadata
            try {
              const meta = JSON.parse(localStorage.getItem('importedProjectMeta') || '{}');
              meta.hasProcessedFiles = true;
              meta.fileCount = Object.values(processedFiles).filter(item => item.type === 'file').length;
              localStorage.setItem('importedProjectMeta', JSON.stringify(meta));
            } catch (e) {
              console.warn("Could not update project metadata:", e);
            }
            
            // Select appropriate file
            if (hasPackageJson && packageJsonPath) {
              console.log(`Selecting file: ${packageJsonPath}`);
              workbenchStore.setSelectedFile(packageJsonPath);
            } else {
              const filesOnly = Object.values(processedFiles)
                .filter(f => f.type === 'file')
                .sort((a, b) => {
                  if (a.name.toLowerCase() === 'readme.md') return -1;
                  if (b.name.toLowerCase() === 'readme.md') return 1;
                  return a.path.localeCompare(b.path);
                });
                
              if (filesOnly.length > 0) {
                const firstFilePath = filesOnly[0].path;
                console.log(`Selecting first file: ${firstFilePath}`);
                workbenchStore.setSelectedFile(firstFilePath);
              }
            }
            
            // Terminal commands - unchanged
            setTimeout(() => {
              if (!workbenchStore.showTerminal.get()) {
                workbenchStore.toggleTerminal(true);
                console.log("Opened terminal");
              }
              
              let runScript = 'start';
              if (packageJsonContent && typeof packageJsonContent === 'object') {
                const scripts = packageJsonContent.scripts;
                if (scripts) {
                  if (scripts.dev) {
                    runScript = 'dev';
                  } else if (scripts.develop) {
                    runScript = 'develop';
                  } else if (scripts.serve) {
                    runScript = 'serve';
                  }
                }
              }
              
              const terminalProjectDir = packageJsonPath ? 
                packageJsonPath.substring(0, packageJsonPath.lastIndexOf('/')) : 
                projectRoot;
              
              const runCommands = () => {
                try {
                  const terminal = (window as any).terminal || 
                                  (workbenchStore as any).terminal || 
                                  document.querySelector('.xterm-helper-textarea');
                  
                  if (terminal) {
                    if (typeof terminal.write === 'function') {
                      terminal.write(`cd ${terminalProjectDir}\n`);
                      terminal.write(`npm install\n`);
                      terminal.write(`npm run ${runScript}\n`);
                    } else if (typeof terminal.sendText === 'function') {
                      terminal.sendText(`cd ${terminalProjectDir}`);
                      terminal.sendText(`npm install`);
                      terminal.sendText(`npm run ${runScript}`);
                    } else {
                      window.dispatchEvent(new CustomEvent('terminal:execute', {
                        detail: {
                          commands: [
                            `cd ${terminalProjectDir}`,
                            `npm install`,
                            `npm run ${runScript}`
                          ]
                        }
                      }));
                    }
                    
                    console.log(`Running npm install and npm run ${runScript} in ${terminalProjectDir}`);
                  } else {
                    console.log("Terminal not found to run commands");
                  }
                } catch (e) {
                  console.error("Error running terminal commands:", e);
                }
              };
              
              setTimeout(runCommands, 1000);
            }, 1000);
            
            toast.success(`Successfully loaded ${Object.keys(processedFiles).filter(k => processedFiles[k].type === 'file').length} files into the workbench`);
          } catch (error) {
            console.error("Error in file processing:", error);
            toast.error("Error processing project files");
          }
        };

        processFiles().catch((error) => {
          console.error('Error processing imported files:', error);
          toast.error('Failed to process imported files');
        });
      }
    };

    window.addEventListener('workbench:import-files', handleImportedFiles);

    return () => {
      window.removeEventListener('workbench:import-files', handleImportedFiles);
    };
  }, []);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const saveAllFiles = useCallback(() => {
    workbenchStore.saveAllFiles().then(() => {
      toast.success('All files saved successfully');
    }).catch(() => {
      toast.error('Failed to save some files');
    });
  }, []);

  return (
    effectiveChatStarted ? (
      <>
        <motion.div
          initial="closed"
          animate={showWorkbench ? 'open' : 'closed'}
          variants={workbenchVariants}
          className="z-workbench"
        >
          <div
            className={classNames(
              'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
              {
                'left-[var(--workbench-left)]': showWorkbench,
                'left-[100%]': !showWorkbench,
              },
            )}
          >
            <div className="absolute inset-0 px-6">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
                <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor">
                  <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                  <div className="ml-auto" />
                  
                  {/* Save All Files Button */}
                  <PanelHeaderButton
                    className="mr-1 text-sm"
                    onClick={saveAllFiles}
                  >
                    <div className="i-ph:floppy-disk" />
                    Save All
                  </PanelHeaderButton>
                  
                  {selectedView === 'code' && (
                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      onClick={() => {
                        workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                      }}
                    >
                      <div className="i-ph:terminal" />
                      Toggle Terminal
                    </PanelHeaderButton>
                  )}
                  <IconButton
                    icon="i-ph:x-circle"
                    className="-mr-1"
                    size="xl"
                    onClick={() => {
                      workbenchStore.showWorkbench.set(false);
                    }}
                  />
                </div>
                
                {/* Unsaved Files Indicator */}
                {unsavedFiles.size > 0 && (
                  <div className="bg-bolt-elements-background-depth-3 py-1 px-3 text-xs text-bolt-elements-textSecondary border-b border-bolt-elements-borderColor">
                    <span className="font-medium text-bolt-accent">{unsavedFiles.size}</span> unsaved {unsavedFiles.size === 1 ? 'file' : 'files'} - click Save All to save changes
                  </div>
                )}

                <div className="relative flex-1 overflow-hidden">
                  <View
                    initial={{ x: selectedView === 'code' ? 0 : '-100%' }}
                    animate={{ x: selectedView === 'code' ? 0 : '-100%' }}
                  >
                    <EditorPanel
                      editorDocument={currentDocument}
                      isStreaming={isStreaming}
                      selectedFile={selectedFile}
                      files={files}
                      unsavedFiles={unsavedFiles}
                      onFileSelect={onFileSelect}
                      onEditorScroll={onEditorScroll}
                      onEditorChange={onEditorChange}
                      onFileSave={onFileSave}
                      onFileReset={onFileReset}
                    />
                  </View>
                  <View
                    initial={{ x: selectedView === 'preview' ? 0 : '100%' }}
                    animate={{ x: selectedView === 'preview' ? 0 : '100%' }}
                  >
                    <Preview />
                  </View>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </>
    ) : null
  );
});

interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
